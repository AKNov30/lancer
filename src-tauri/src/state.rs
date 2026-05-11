use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Mutex, RwLock};

use crate::mock::server::MockHandle;

/// In-memory cache for OAuth 2 Client Credentials tokens. Keyed by
/// (token_url, client_id, scope). Entries expire by `expires_at` (wall clock).
#[derive(Debug, Default)]
pub struct OAuth2Cache {
    inner: RwLock<HashMap<String, OAuth2Entry>>,
}

#[derive(Debug, Clone)]
pub struct OAuth2Entry {
    pub access_token: String,
    pub expires_at: std::time::SystemTime,
}

impl OAuth2Cache {
    pub async fn get(&self, key: &str) -> Option<OAuth2Entry> {
        let guard = self.inner.read().await;
        let entry = guard.get(key)?.clone();
        if entry.expires_at <= std::time::SystemTime::now() {
            return None;
        }
        Some(entry)
    }

    pub async fn put(&self, key: String, entry: OAuth2Entry) {
        let mut guard = self.inner.write().await;
        let now = std::time::SystemTime::now();
        guard.retain(|_, e| e.expires_at > now); // evict expired
        guard.insert(key, entry);
    }
}

const REQUEST_TIMEOUT_SECS: u64 = 30;
const CONNECT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug)]
pub struct AppState {
    pub oauth2_cache: OAuth2Cache,
    pub http_client: reqwest::Client,
    /// Running mock server handle, if any.
    pub mock: Arc<Mutex<Option<MockHandle>>>,
    /// Last error from the mock server background task.
    pub mock_error: Arc<Mutex<Option<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let http_client = reqwest::Client::builder()
            .user_agent(concat!("Lancer/", env!("CARGO_PKG_VERSION")))
            .cookie_store(true)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("failed to build reqwest Client");
        Self {
            oauth2_cache: OAuth2Cache::default(),
            http_client,
            mock: Arc::new(Mutex::new(None)),
            mock_error: Arc::new(Mutex::new(None)),
        }
    }
}

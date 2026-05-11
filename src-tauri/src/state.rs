use std::collections::HashMap;

use tokio::sync::RwLock;

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
        guard.insert(key, entry);
    }
}

#[derive(Debug, Default)]
pub struct AppState {
    pub oauth2_cache: OAuth2Cache,
}

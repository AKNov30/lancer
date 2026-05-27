use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, RwLock as StdRwLock};
use std::time::Duration;

use reqwest_cookie_store::CookieStoreMutex;
use tokio::sync::{oneshot, Mutex, RwLock};

use crate::commands::stream::Connection;
use crate::commands::watcher::WatcherState;
use crate::history::store::HistoryDb;
use crate::mock::server::MockHandle;
use crate::settings::SettingsStore;

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
    /// Shared default HTTP client, swappable so a proxy settings change takes
    /// effect immediately (no app restart). Wrapped in a `std::sync::RwLock`:
    /// reads (every request) take a read lock and `clone()` out the `Client`
    /// (cheap — `reqwest::Client` is an `Arc` internally); a settings save takes
    /// the write lock to replace it. The lock is never held across an `.await`.
    pub http_client: StdRwLock<reqwest::Client>,
    /// Explicit, inspectable cookie jar shared by the default `http_client`
    /// and any per-request custom client (insecure-TLS / redirect overrides).
    /// Replaces reqwest's built-in `.cookie_store(true)` jar, which can't be
    /// listed or edited. Wrapped in a `std::sync::Mutex` (via the crate's
    /// `CookieStoreMutex`); the cookie commands lock it poison-safely.
    pub cookie_jar: Arc<CookieStoreMutex>,
    /// Running mock server handle, if any.
    pub mock: Arc<Mutex<Option<MockHandle>>>,
    /// Last error from the mock server background task.
    pub mock_error: Arc<Mutex<Option<String>>>,
    /// On-disk SQLite request history (capped at 500 entries).
    pub history: HistoryDb,
    /// Global application settings (proxy, etc.). Persisted to disk.
    pub settings: SettingsStore,
    /// Active file-system watcher for the workspace folder, if any.
    pub watcher: Arc<WatcherState>,
    /// Active streaming connections (SSE / WebSocket), keyed by connection id.
    /// A `std::sync::Mutex` (not tokio's) is fine here: we only ever hold the
    /// lock briefly to insert/remove/look-up a handle — never across an await.
    /// Poison-safe locking is used everywhere, matching `history/store.rs`.
    pub connections: Arc<StdMutex<HashMap<String, Connection>>>,
    /// In-flight HTTP requests that can be cancelled, keyed by the
    /// frontend-supplied request id. Firing the `oneshot::Sender` signals
    /// `send_request` to abort its network send. Mirrors `connections`: a
    /// poison-safe `std::sync::Mutex` held only briefly to insert/remove/take.
    /// `send_request` removes its own id on every exit path so this never leaks.
    pub cancellations: Arc<StdMutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl AppState {
    /// Clone out the current default HTTP client. Cheap — `reqwest::Client`
    /// is `Arc`-backed — and lets callers hold the client across `.await`
    /// without keeping the lock. Poison-safe.
    pub fn http_client(&self) -> reqwest::Client {
        self.http_client
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Replace the default HTTP client (e.g. after a proxy settings change).
    /// Poison-safe; the write lock is held only for the swap.
    pub fn set_http_client(&self, client: reqwest::Client) {
        *self.http_client.write().unwrap_or_else(|e| e.into_inner()) = client;
    }
}

/// Builds a reqwest Client from the current proxy config.
///
/// When proxy is disabled or fails to parse, falls back to the default
/// no-proxy client so the user can still send requests while fixing
/// their proxy settings.
pub(crate) fn build_http_client(
    proxy: &crate::settings::ProxyConfig,
    cookie_jar: &Arc<CookieStoreMutex>,
) -> reqwest::Client {
    let mut b = reqwest::Client::builder()
        .user_agent(concat!("Lancer/", env!("CARGO_PKG_VERSION")))
        // Explicit, inspectable jar instead of `.cookie_store(true)` so the
        // Cookie manager can list/edit cookies. `Arc::clone` shares the SAME
        // store with every client (default + per-request custom).
        .cookie_provider(Arc::clone(cookie_jar))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(10));

    if proxy.enabled && !proxy.url.trim().is_empty() {
        // reqwest auto-detects http://, https://, socks5:// from the URL.
        if let Ok(mut p) = reqwest::Proxy::all(proxy.url.trim()) {
            if !proxy.username.is_empty() {
                p = p.basic_auth(&proxy.username, &proxy.password);
            }
            if !proxy.no_proxy.trim().is_empty() {
                p = p.no_proxy(reqwest::NoProxy::from_string(&proxy.no_proxy));
            }
            b = b.proxy(p);
        }
    }

    b.build()
        .expect("failed to build reqwest Client; falling back is impossible at startup")
}

impl Default for AppState {
    fn default() -> Self {
        let settings = SettingsStore::default();
        let cookie_jar = Arc::new(CookieStoreMutex::default());
        let http_client = build_http_client(&settings.snapshot().proxy, &cookie_jar);
        let history_path = dirs::home_dir()
            .unwrap_or_default()
            .join(".lancer")
            .join("history.sqlite");
        let history =
            HistoryDb::open(history_path).unwrap_or_else(|_| HistoryDb::open_in_memory().unwrap());
        Self {
            oauth2_cache: OAuth2Cache::default(),
            http_client: StdRwLock::new(http_client),
            cookie_jar,
            mock: Arc::new(Mutex::new(None)),
            mock_error: Arc::new(Mutex::new(None)),
            history,
            settings,
            watcher: Arc::new(WatcherState::default()),
            connections: Arc::new(StdMutex::new(HashMap::new())),
            cancellations: Arc::new(StdMutex::new(HashMap::new())),
        }
    }
}

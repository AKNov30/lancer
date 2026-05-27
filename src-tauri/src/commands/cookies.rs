//! Tauri commands exposing the shared, inspectable cookie jar.
//!
//! The HTTP client keeps cookies in an explicit
//! [`reqwest_cookie_store::CookieStoreMutex`] (see [`crate::state::AppState`]),
//! which — unlike reqwest's built-in `.cookie_store(true)` jar — can be listed
//! and edited. These commands back the Cookie manager UI.
//!
//! The thin `#[tauri::command]` wrappers just unwrap the jar from `AppState`
//! and delegate to the `*_in` helpers, which take the `CookieStoreMutex`
//! directly so they're unit-testable without a Tauri `State`. All locking is
//! poison-safe (`unwrap_or_else(|e| e.into_inner())`), matching the rest of the
//! app's `std::sync::Mutex` usage.

use std::sync::Arc;

use cookie_store::{Cookie as StoreCookie, RawCookie};
use reqwest_cookie_store::CookieStoreMutex;
use url::Url;

use crate::state::AppState;

/// A single stored cookie, flattened for the frontend. `expires` is an RFC3339
/// UTC string for persistent cookies, or `None` for session cookies.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieInfo {
    pub domain: String,
    pub name: String,
    pub value: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub expires: Option<String>,
}

impl CookieInfo {
    fn from_store(c: &StoreCookie<'_>) -> Self {
        let domain = String::from(&c.domain);
        let path = String::from(&c.path);
        let expires = match &c.expires {
            cookie_store::CookieExpiration::AtUtc(dt) => dt
                .format(&time::format_description::well_known::Rfc3339)
                .ok(),
            cookie_store::CookieExpiration::SessionEnd => None,
        };
        CookieInfo {
            domain,
            name: c.name().to_string(),
            value: c.value().to_string(),
            path,
            // `secure()` / `http_only()` are `Option<bool>` on the raw cookie.
            secure: c.secure().unwrap_or(false),
            http_only: c.http_only().unwrap_or(false),
            expires,
        }
    }
}

/// Build a synthetic URL that a cookie with the given `domain`/`path` would
/// match, so the store can resolve its host-only/suffix and path attributes.
/// `https` is used so a `Secure` cookie isn't rejected by the store.
fn synthetic_url(domain: &str, path: &str) -> Result<Url, String> {
    let host = domain.trim().trim_start_matches('.');
    if host.is_empty() {
        return Err("domain must not be empty".to_string());
    }
    let path = if path.trim().is_empty() {
        "/"
    } else {
        path.trim()
    };
    Url::parse(&format!("https://{host}{path}"))
        .map_err(|e| format!("invalid domain/path ({host}{path}): {e}"))
}

// ── Jar-level helpers (unit-testable, no Tauri State) ─────────────────────────

pub(crate) fn list_cookies_in(jar: &Arc<CookieStoreMutex>) -> Vec<CookieInfo> {
    let store = jar.lock().unwrap_or_else(|e| e.into_inner());
    let mut cookies: Vec<CookieInfo> = store.iter_any().map(CookieInfo::from_store).collect();
    // Stable order: by domain, then name, then path — keeps the UI from
    // reshuffling rows on every refresh.
    cookies.sort_by(|a, b| {
        a.domain
            .cmp(&b.domain)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.path.cmp(&b.path))
    });
    cookies
}

pub(crate) fn set_cookie_in(
    jar: &Arc<CookieStoreMutex>,
    domain: String,
    name: String,
    value: String,
    path: String,
    secure: bool,
    http_only: bool,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("cookie name must not be empty".to_string());
    }
    let path = if path.trim().is_empty() {
        "/".to_string()
    } else {
        path.trim().to_string()
    };
    let url = synthetic_url(&domain, &path)?;

    // Build a raw cookie carrying the requested attributes. Setting an explicit
    // Domain makes it a suffix cookie (sent to sub-domains too); this matches
    // the user's intent when they type a domain into the manager.
    let mut raw = RawCookie::new(name, value);
    raw.set_domain(domain.trim().trim_start_matches('.').to_string());
    raw.set_path(path);
    raw.set_secure(secure);
    raw.set_http_only(http_only);

    let mut store = jar.lock().unwrap_or_else(|e| e.into_inner());
    store
        .insert_raw(&raw, &url)
        .map_err(|e| format!("failed to store cookie: {e}"))?;
    Ok(())
}

pub(crate) fn delete_cookie_in(jar: &Arc<CookieStoreMutex>, domain: &str, name: &str, path: &str) {
    let path = if path.trim().is_empty() {
        "/"
    } else {
        path.trim()
    };
    let domain = domain.trim().trim_start_matches('.');
    let mut store = jar.lock().unwrap_or_else(|e| e.into_inner());
    store.remove(domain, path, name);
}

pub(crate) fn clear_cookies_in(jar: &Arc<CookieStoreMutex>) {
    let mut store = jar.lock().unwrap_or_else(|e| e.into_inner());
    store.clear();
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

/// List every (unexpired) cookie currently in the jar.
#[tauri::command]
pub fn list_cookies(state: tauri::State<'_, AppState>) -> Result<Vec<CookieInfo>, String> {
    Ok(list_cookies_in(&state.cookie_jar))
}

/// Insert or update a cookie in the jar. A cookie is keyed by (domain, path,
/// name); inserting one that already exists overwrites its value/flags.
#[tauri::command]
pub fn set_cookie(
    domain: String,
    name: String,
    value: String,
    path: String,
    secure: bool,
    http_only: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    set_cookie_in(
        &state.cookie_jar,
        domain,
        name,
        value,
        path,
        secure,
        http_only,
    )
}

/// Remove a single cookie identified by (domain, name, path).
#[tauri::command]
pub fn delete_cookie(
    domain: String,
    name: String,
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    delete_cookie_in(&state.cookie_jar, &domain, &name, &path);
    Ok(())
}

/// Empty the entire jar.
#[tauri::command]
pub fn clear_cookies(state: tauri::State<'_, AppState>) -> Result<(), String> {
    clear_cookies_in(&state.cookie_jar);
    Ok(())
}

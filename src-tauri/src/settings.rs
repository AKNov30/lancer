//! Global application settings persisted to `~/.lancer/settings.json`.
//!
//! Currently holds proxy configuration; designed to grow with TLS certs,
//! custom CA bundles, and other global preferences in subsequent waves.
//!
//! Secret handling: the proxy password is **never** written to
//! `settings.json` in cleartext. Instead it lives in the OS keyring (service
//! `dev.lancer.app`, account `proxy-password`) and the JSON carries only a
//! `passwordSet: bool` flag. On load the password is rehydrated from the
//! keyring into the in-memory `ProxyConfig.password`; on save it is written to
//! the keyring and stripped from the bytes hitting disk. Keyring outages are
//! non-fatal (best-effort), matching `env/secrets.rs`.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

/// Keyring service used for global (non-workspace) app secrets.
const KEYRING_SERVICE: &str = "dev.lancer.app";
/// Keyring account holding the proxy basic-auth password.
const PROXY_PASSWORD_ACCOUNT: &str = "proxy-password";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    /// When false, all other proxy fields are ignored.
    #[serde(default)]
    pub enabled: bool,
    /// e.g. `http://proxy.corp.local:8080` or `socks5://1.2.3.4:1080`
    #[serde(default)]
    pub url: String,
    /// Optional basic-auth username for the proxy
    #[serde(default)]
    pub username: String,
    /// Optional basic-auth password for the proxy.
    ///
    /// Held in memory and exchanged with the frontend via the settings
    /// commands as usual, but **stripped before the settings are written to
    /// `settings.json`** (see `for_disk`). The on-disk truth is `password_set`;
    /// the literal lives only in the OS keyring. The keyring round-trip is
    /// transparent to the frontend.
    #[serde(default)]
    pub password: String,
    /// Whether a proxy password is stored (in the keyring). Persisted to disk
    /// in place of the literal password so load knows to fetch it.
    #[serde(default)]
    pub password_set: bool,
    /// Comma-separated host patterns to bypass (e.g. "localhost,*.local")
    #[serde(default)]
    pub no_proxy: String,
}

/// Read the proxy password from the OS keyring. Returns `None` when no entry
/// exists or the keyring is unavailable — never an error, so a missing/locked
/// keyring degrades gracefully instead of crashing settings load.
fn keyring_get_proxy_password() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, PROXY_PASSWORD_ACCOUNT).ok()?;
    entry.get_password().ok()
}

/// Persist (or clear) the proxy password in the OS keyring. Best-effort: a
/// keyring outage is logged-as-ignored rather than propagated, mirroring how
/// `env/secrets.rs` treats `Unavailable`. An empty password deletes the entry.
fn keyring_set_proxy_password(password: &str) {
    let entry = match keyring::Entry::new(KEYRING_SERVICE, PROXY_PASSWORD_ACCOUNT) {
        Ok(e) => e,
        Err(_) => return,
    };
    if password.is_empty() {
        // Remove any previously stored secret; absent entry is fine.
        let _ = entry.delete_credential();
    } else {
        let _ = entry.set_password(password);
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub proxy: ProxyConfig,
}

impl AppSettings {
    /// A clone scrubbed of secret literals, safe to write to disk. The proxy
    /// password is blanked (it lives in the OS keyring) while `password_set`
    /// records whether one exists so it can be rehydrated on the next load.
    fn for_disk(&self) -> AppSettings {
        let mut copy = self.clone();
        copy.proxy.password_set = !copy.proxy.password.is_empty();
        copy.proxy.password = String::new();
        copy
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("home directory not found")]
    NoHome,
}

impl serde::Serialize for SettingsError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Returns `~/.lancer/settings.json` — created on first write.
fn settings_path() -> Result<PathBuf, SettingsError> {
    let mut path = dirs::home_dir().ok_or(SettingsError::NoHome)?;
    path.push(".lancer");
    path.push("settings.json");
    Ok(path)
}

#[derive(Debug, Clone)]
pub struct SettingsStore {
    inner: Arc<RwLock<AppSettings>>,
}

impl Default for SettingsStore {
    fn default() -> Self {
        // Best-effort load on construction — missing file is fine.
        let settings = Self::load_from_disk().unwrap_or_default();
        Self {
            inner: Arc::new(RwLock::new(settings)),
        }
    }
}

impl SettingsStore {
    fn load_from_disk() -> Result<AppSettings, SettingsError> {
        let path = settings_path()?;
        if !path.exists() {
            return Ok(AppSettings::default());
        }
        let raw = std::fs::read_to_string(&path)?;
        if raw.trim().is_empty() {
            return Ok(AppSettings::default());
        }
        let mut parsed: AppSettings = serde_json::from_str(&raw)?;
        // Rehydrate the proxy password from the OS keyring (never on disk).
        // If the flag says a password exists but the keyring can't produce it
        // (locked/unavailable), leave it empty — requests just go unauthed.
        if parsed.proxy.password_set {
            if let Some(pw) = keyring_get_proxy_password() {
                parsed.proxy.password = pw;
            }
        }
        Ok(parsed)
    }

    pub fn snapshot(&self) -> AppSettings {
        self.inner.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn replace(&self, mut next: AppSettings) -> Result<(), SettingsError> {
        let path = settings_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Stash the proxy password in the OS keyring (best-effort), then keep
        // the in-memory copy authoritative about whether one is set.
        keyring_set_proxy_password(&next.proxy.password);
        next.proxy.password_set = !next.proxy.password.is_empty();

        // Serialize a scrubbed copy: the password literal never reaches disk,
        // only the `passwordSet` flag does.
        let serialized = serde_json::to_string_pretty(&next.for_disk())?;
        crate::fsutil::write_atomic(&path, serialized.as_bytes())?;
        // The in-memory store keeps the cleartext password so the frontend can
        // read it back via `get_settings` without a keyring fetch.
        *self.inner.write().unwrap_or_else(|e| e.into_inner()) = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with_password(pw: &str) -> AppSettings {
        AppSettings {
            proxy: ProxyConfig {
                enabled: true,
                url: "http://proxy.corp.local:8080".into(),
                username: "alice".into(),
                password: pw.into(),
                password_set: false,
                no_proxy: "localhost".into(),
            },
        }
    }

    #[test]
    fn for_disk_strips_proxy_password_literal() {
        let secret = "sup3r-s3cret-pw";
        let settings = settings_with_password(secret);

        // The on-disk form must never contain the literal password.
        let disk = settings.for_disk();
        assert_eq!(disk.proxy.password, "", "password must be blanked for disk");
        assert!(
            disk.proxy.password_set,
            "password_set flag must be recorded"
        );

        let json = serde_json::to_string_pretty(&disk).expect("serialize");
        assert!(
            !json.contains(secret),
            "serialized settings.json leaked the proxy password: {json}"
        );
        // The flag survives so a later load knows to fetch from the keyring.
        assert!(json.contains("passwordSet"), "got: {json}");
    }

    #[test]
    fn for_disk_no_password_clears_flag() {
        let settings = settings_with_password("");
        let disk = settings.for_disk();
        assert_eq!(disk.proxy.password, "");
        assert!(!disk.proxy.password_set);
    }

    #[test]
    fn in_memory_settings_keep_password_for_frontend() {
        // The struct the frontend receives via get_settings still carries the
        // cleartext password (it's the *disk* copy that is scrubbed).
        let settings = settings_with_password("keep-me");
        let json = serde_json::to_string(&settings).expect("serialize");
        assert!(json.contains("keep-me"), "frontend copy must keep password");
    }
}

//! Tauri commands that expose the global {@link crate::settings::AppSettings}.
//!
//! Writes through both the in-memory store and `~/.lancer/settings.json`,
//! so changes survive an app restart. Updating proxy settings rebuilds the
//! shared `reqwest::Client` and swaps it into `AppState` so the next request
//! uses the new proxy — no restart required.

use crate::settings::AppSettings;
use crate::state::{build_http_client, AppState};

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, AppState>) -> AppSettings {
    state.settings.snapshot()
}

#[tauri::command]
pub fn set_settings(
    settings: AppSettings,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let proxy = settings.proxy.clone();
    state
        .settings
        .replace(settings)
        .map_err(|e| e.to_string())?;
    // Rebuild the default http_client with the new proxy config and swap it
    // into AppState so the change takes effect immediately for subsequent
    // requests — no app restart needed. The rebuilt client keeps the same
    // inspectable cookie jar so cookies stay consistent across the swap.
    let new_client = build_http_client(&proxy, &state.cookie_jar);
    state.set_http_client(new_client);
    Ok(())
}

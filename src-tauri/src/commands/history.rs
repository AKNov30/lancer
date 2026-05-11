use crate::history::store::HistoryEntry;
use crate::state::AppState;

#[tauri::command]
pub fn history_list(
    limit: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<HistoryEntry>, String> {
    state
        .history
        .list(limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_clear(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.history.clear().map_err(|e| e.to_string())
}

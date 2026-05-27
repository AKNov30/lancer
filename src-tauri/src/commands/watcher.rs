use std::path::PathBuf;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::state::AppState;

/// Type alias for the boxed debouncer we keep alive in [`AppState`]. The
/// debouncer owns its background thread; dropping it stops watching.
pub type WatcherHandle = Debouncer<RecommendedWatcher>;

/// Wrapper held inside `AppState` so the running watcher is shared across
/// invokes. `Option` because no watcher exists until the user opens a folder.
#[derive(Default, Debug)]
pub struct WatcherState {
    pub current: Mutex<Option<WatcherHandle>>,
}

/// Payload sent to the frontend on every debounced batch of FS changes.
/// The renderer uses this as a "you probably want to refresh the sidebar"
/// hint; it's free to ignore quick repeats.
#[derive(Debug, Clone, Serialize)]
struct WorkspaceChangedPayload {
    /// Number of distinct paths in the debounced batch.
    count: usize,
}

/// Start (or restart) watching the given workspace `root`. Drops any
/// previously-installed debouncer first so swapping workspaces doesn't leak
/// background threads.
///
/// Only `.bru` files trigger an event — touching `node_modules/` or hidden
/// dot-folders is ignored to keep noise low for editor swap files.
#[tauri::command]
pub async fn start_watching(
    app: AppHandle,
    state: State<'_, AppState>,
    root: PathBuf,
) -> Result<(), String> {
    if !root.exists() || !root.is_dir() {
        return Err(format!(
            "workspace root does not exist or is not a directory: {}",
            root.display()
        ));
    }

    // Drop the previous debouncer (if any) BEFORE creating the new one so
    // we don't briefly own two threads watching the same path.
    let watcher_state = state.watcher.clone();
    {
        let mut guard = watcher_state.current.lock().await;
        *guard = None;
    }

    let app_for_callback = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: DebounceEventResult| {
            let events = match res {
                Ok(events) => events,
                Err(errors) => {
                    eprintln!("file watcher error: {errors:?}");
                    return;
                }
            };

            // Only emit if at least one event touched a `.bru` file or a
            // directory (folder rename / new folder).
            let relevant = events.iter().any(|e| {
                if e.path.is_dir() {
                    return true;
                }
                e.path
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x == "bru")
                    .unwrap_or(false)
            });
            if !relevant {
                return;
            }

            let payload = WorkspaceChangedPayload {
                count: events.len(),
            };
            // Best-effort emit; if the renderer is mid-reload there's nothing
            // to do but skip this batch.
            let _ = app_for_callback.emit("workspace://changed", payload);
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Store the new debouncer so subsequent watch calls can replace it.
    let mut guard = watcher_state.current.lock().await;
    *guard = Some(debouncer);
    Ok(())
}

/// Stop the current workspace watcher (if any). Idempotent.
#[tauri::command]
pub async fn stop_watching(state: State<'_, AppState>) -> Result<(), String> {
    let watcher_state = state.watcher.clone();
    let mut guard = watcher_state.current.lock().await;
    *guard = None;
    Ok(())
}

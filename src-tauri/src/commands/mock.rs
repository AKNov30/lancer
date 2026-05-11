use std::path::PathBuf;

use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::importers::openapi::load;
use crate::mock::server::MockStatus;
use crate::mock::{router, server::MockHandle};
use crate::state::AppState;

/// Start a mock server from the given OpenAPI spec on the given port.
///
/// If a server is already running it is stopped first. Returns the new status.
#[tauri::command]
pub async fn mock_start(
    spec_path: PathBuf,
    port: u16,
    state: tauri::State<'_, AppState>,
) -> Result<MockStatus, String> {
    // Stop any prior instance.
    stop_inner(&state).await;
    // Clear prior error.
    *state.mock_error.lock().await = None;

    // Load spec.
    let spec = load::load_spec(&spec_path).map_err(|e| e.to_string())?;

    // Build router.
    let mock_router = router::build(&spec);

    // Bind listener.
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("cannot bind port {port}: {e}"))?;

    // Actual bound port (may differ from requested if OS assigned one, but
    // since we pass an explicit port that won't happen in practice).
    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

    let (tx, rx) = oneshot::channel::<()>();

    let mock_error = state.mock_error.clone();
    tokio::spawn(async move {
        let result = axum::serve(listener, mock_router)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = result {
            *mock_error.lock().await = Some(e.to_string());
        }
    });

    let handle = MockHandle {
        port: bound_port,
        spec_path: spec_path.to_string_lossy().into_owned(),
        shutdown: tx,
    };
    *state.mock.lock().await = Some(handle);

    Ok(status_snapshot(&state).await)
}

/// Stop the running mock server (no-op if none is running).
#[tauri::command]
pub async fn mock_stop(state: tauri::State<'_, AppState>) -> Result<MockStatus, String> {
    stop_inner(&state).await;
    Ok(status_snapshot(&state).await)
}

/// Return the current mock server status without changing anything.
#[tauri::command]
pub async fn mock_status(state: tauri::State<'_, AppState>) -> Result<MockStatus, String> {
    Ok(status_snapshot(&state).await)
}

// ── internals ────────────────────────────────────────────────────────────────

async fn stop_inner(state: &tauri::State<'_, AppState>) {
    if let Some(handle) = state.mock.lock().await.take() {
        // Best-effort — receiver may already be gone.
        let _ = handle.shutdown.send(());
    }
}

async fn status_snapshot(state: &tauri::State<'_, AppState>) -> MockStatus {
    let guard = state.mock.lock().await;
    let error = state.mock_error.lock().await.clone();
    match &*guard {
        Some(h) => MockStatus {
            running: true,
            port: Some(h.port),
            spec_path: Some(h.spec_path.clone()),
            error,
        },
        None => MockStatus {
            running: false,
            port: None,
            spec_path: None,
            error,
        },
    }
}

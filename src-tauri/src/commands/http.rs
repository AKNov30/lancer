use std::path::PathBuf;

use crate::collection::schema::Auth;
use crate::env::substitute::{load_ctx_from_disk, substitute_auth, substitute_http_request};
use crate::http::{
    auth, client,
    types::{HttpRequest, HttpResponse},
};
use crate::state::AppState;

#[tauri::command]
pub async fn send_request(
    mut req: HttpRequest,
    mut auth: Option<Auth>,
    workspace_root: Option<PathBuf>,
    env_name: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<HttpResponse, String> {
    // 1. Build env Ctx if env selected, then substitute.
    if let (Some(root), Some(name)) = (workspace_root.as_ref(), env_name.as_ref()) {
        let ctx = load_ctx_from_disk(root, name).map_err(|e| e.to_string())?;
        substitute_http_request(&mut req, &ctx);
        if let Some(a) = auth.as_mut() {
            substitute_auth(a, &ctx);
        }
    }

    // 2. Apply auth.
    let req = match auth {
        Some(a) => auth::apply_auth(req, &a, state.inner())
            .await
            .map_err(|e| e.to_string())?,
        None => req,
    };

    // 3. Send.
    client::send(&state.inner().http_client, req)
        .await
        .map_err(|e| e.to_string())
}

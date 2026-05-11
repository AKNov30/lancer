use crate::collection::schema::Auth;
use crate::http::{
    auth, client,
    types::{HttpRequest, HttpResponse},
};
use crate::state::AppState;

#[tauri::command]
pub async fn send_request(
    req: HttpRequest,
    auth: Option<Auth>,
    state: tauri::State<'_, AppState>,
) -> Result<HttpResponse, String> {
    let req = match auth {
        Some(a) => auth::apply_auth(req, &a, state.inner())
            .await
            .map_err(|e| e.to_string())?,
        None => req,
    };
    client::send(req).await.map_err(|e| e.to_string())
}

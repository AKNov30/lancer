use crate::http::client;
use crate::http::types::{HttpRequest, HttpResponse};

#[tauri::command]
pub async fn send_request(req: HttpRequest) -> Result<HttpResponse, String> {
    client::send(req).await.map_err(|e| e.to_string())
}

use crate::http::curl;
use crate::http::types::HttpRequest;

#[tauri::command]
pub fn parse_curl(input: String) -> Result<HttpRequest, String> {
    curl::parse(&input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_curl(req: HttpRequest) -> String {
    curl::to_curl(&req)
}

#[tauri::command]
pub fn export_fetch(req: HttpRequest) -> String {
    curl::to_fetch(&req)
}

#[tauri::command]
pub fn export_axios(req: HttpRequest) -> String {
    curl::to_axios(&req)
}

#[tauri::command]
pub fn export_python(req: HttpRequest) -> String {
    curl::to_python(&req)
}

#[tauri::command]
pub fn export_go(req: HttpRequest) -> String {
    curl::to_go(&req)
}

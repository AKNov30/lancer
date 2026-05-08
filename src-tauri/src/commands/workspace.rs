use std::path::PathBuf;

use crate::collection::io::{self, WorkspaceItem};
use crate::collection::schema::Request;

#[tauri::command]
pub fn list_workspace(root: PathBuf) -> Result<Vec<WorkspaceItem>, String> {
    io::list_workspace(&root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_request(path: PathBuf) -> Result<Request, String> {
    io::read_request(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_request(path: PathBuf, req: Request) -> Result<(), String> {
    io::write_request(&path, &req).map_err(|e| e.to_string())
}

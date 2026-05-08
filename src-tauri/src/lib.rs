pub mod collection;
pub mod commands;
pub mod http;

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::workspace::list_workspace,
            commands::workspace::read_request,
            commands::workspace::write_request,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

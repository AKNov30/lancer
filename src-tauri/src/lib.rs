pub mod collection;
pub mod commands;
pub mod env;
pub mod http;
pub mod importers;
pub mod mock;
pub mod state;

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::http::send_request,
            commands::workspace::list_workspace,
            commands::workspace::read_request,
            commands::workspace::write_request,
            commands::envs::list_envs,
            commands::envs::read_env,
            commands::envs::write_env,
            commands::envs::delete_env,
            commands::envs::get_secret,
            commands::envs::set_secret,
            commands::envs::delete_secret,
            commands::importers::import_openapi,
            commands::importers::import_postman,
            commands::importers::import_postman_env,
            commands::mock::mock_start,
            commands::mock::mock_stop,
            commands::mock::mock_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

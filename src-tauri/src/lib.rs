pub mod collection;
pub mod commands;
pub mod env;
pub mod fsutil;
pub mod history;
pub mod http;
pub mod importers;
pub mod mock;
pub mod scripting;
pub mod settings;
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
            commands::http::cancel_request,
            commands::http::resolve_vars,
            commands::workspace::list_workspace,
            commands::workspace::read_request,
            commands::workspace::write_request,
            commands::workspace::rename_path,
            commands::workspace::delete_path,
            commands::workspace::create_folder,
            commands::workspace::move_item,
            commands::workspace::path_in_workspace,
            commands::workspace::default_workspace_root,
            commands::workspace::create_named_workspace,
            commands::workspace::reveal_in_file_manager,
            commands::workspace::duplicate_path,
            crate::collection::folder::read_folder_settings,
            crate::collection::folder::write_folder_settings,
            commands::watcher::start_watching,
            commands::watcher::stop_watching,
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
            commands::importers::detect_file_format,
            commands::exporters::export_workspace_zip,
            commands::exporters::list_top_level_folders,
            commands::mock::mock_start,
            commands::mock::mock_stop,
            commands::mock::mock_status,
            commands::history::history_list,
            commands::history::history_search,
            commands::history::history_pin,
            commands::history::history_clear,
            commands::fs::save_bytes,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::curl::parse_curl,
            commands::curl::export_curl,
            commands::curl::export_fetch,
            commands::curl::export_axios,
            commands::curl::export_python,
            commands::curl::export_go,
            commands::stream::sse_connect,
            commands::stream::ws_connect,
            commands::stream::ws_send,
            commands::stream::disconnect,
            commands::cookies::list_cookies,
            commands::cookies::set_cookie,
            commands::cookies::delete_cookie,
            commands::cookies::clear_cookies,
            commands::grpc::grpc_list_methods,
            commands::grpc::grpc_unary_call,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

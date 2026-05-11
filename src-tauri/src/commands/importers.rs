use std::path::PathBuf;

use crate::env::io::write_env;
use crate::importers::openapi::walk::{import_spec, ImportReport};
use crate::importers::postman::env::convert_env;
use crate::importers::postman::schema::PostmanEnv;
use crate::importers::postman::walk::{import_collection, ImportReport as PostmanImportReport};

/// Import a Postman v2.1 collection JSON into a Lancer workspace folder.
///
/// `collection_path` — absolute path to the Postman collection JSON.
/// `dest_root`       — absolute path to the destination collection folder.
#[tauri::command]
pub fn import_postman(collection_path: PathBuf, dest_root: PathBuf) -> PostmanImportReport {
    import_collection(&collection_path, &dest_root)
}

/// Import a Postman environment JSON into the workspace's `environments/` folder.
///
/// Returns the name of the environment that was written.
#[tauri::command]
pub fn import_postman_env(env_path: PathBuf, workspace_root: PathBuf) -> Result<String, String> {
    let text =
        std::fs::read_to_string(&env_path).map_err(|e| format!("cannot read env file: {e}"))?;
    let pm_env: PostmanEnv =
        serde_json::from_str(&text).map_err(|e| format!("cannot parse env JSON: {e}"))?;
    let env = convert_env(pm_env);
    let name = env.name.clone();
    write_env(&workspace_root, &env).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Import an OpenAPI 3 spec file into a Lancer collection folder.
///
/// `spec_path`  — absolute path to the `.yaml`, `.yml`, or `.json` spec file.
/// `dest_root`  — absolute path to the collection folder (will be created if needed).
///
/// Returns an [`ImportReport`] describing what was created, skipped, or errored.
#[tauri::command]
pub fn import_openapi(spec_path: PathBuf, dest_root: PathBuf) -> Result<ImportReport, String> {
    import_spec(&spec_path, &dest_root).map_err(|e| e.to_string())
}

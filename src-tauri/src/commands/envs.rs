use std::path::PathBuf;

use crate::env::io as env_io;
use crate::env::schema::Environment;
use crate::env::secrets;

// Env CRUD
#[tauri::command]
pub fn list_envs(workspace_root: PathBuf) -> Result<Vec<String>, String> {
    env_io::list_envs(&workspace_root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_env(workspace_root: PathBuf, name: String) -> Result<Environment, String> {
    env_io::read_env(&workspace_root, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_env(workspace_root: PathBuf, env: Environment) -> Result<(), String> {
    env_io::write_env(&workspace_root, &env).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_env(workspace_root: PathBuf, name: String) -> Result<(), String> {
    env_io::delete_env(&workspace_root, &name).map_err(|e| e.to_string())
}

// Secret CRUD
#[tauri::command]
pub fn get_secret(
    workspace_root: PathBuf,
    env_name: String,
    var_name: String,
) -> Result<Option<String>, String> {
    secrets::get(&workspace_root, &env_name, &var_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_secret(
    workspace_root: PathBuf,
    env_name: String,
    var_name: String,
    value: String,
) -> Result<(), String> {
    secrets::set(&workspace_root, &env_name, &var_name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_secret(
    workspace_root: PathBuf,
    env_name: String,
    var_name: String,
) -> Result<(), String> {
    secrets::delete(&workspace_root, &env_name, &var_name).map_err(|e| e.to_string())
}

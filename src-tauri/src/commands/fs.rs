//! Filesystem-touching commands (response save, etc.).
//!
//! Keeping these as explicit Tauri commands rather than going through
//! `tauri-plugin-fs` avoids capability-config friction and ensures every
//! disk write is gated through the Rust-side logic (e.g. path sanitisation
//! and error mapping) before touching the filesystem.

use std::path::{Component, PathBuf};

/// Write a byte buffer to the given path. Used by the response viewer's
/// "Save response to file" action — the renderer calls
/// `tauri-plugin-dialog`'s `save()` first to obtain a user-chosen path,
/// then hands the bytes to this command for writing.
///
/// Confinement note: this command intentionally writes to a user-chosen
/// location anywhere on disk (the native save dialog returns an arbitrary
/// absolute path), so it can't be confined to a workspace root like the
/// collection commands. As a defense-in-depth guard against a path supplied by
/// a misbehaving/compromised renderer we still require an **absolute** path and
/// reject any `..` traversal component, so the write target is always explicit
/// rather than resolved relative to the process CWD.
#[tauri::command]
pub async fn save_bytes(path: String, content: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.is_absolute() {
        return Err(format!("refusing to write non-absolute path: {path}"));
    }
    if target
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(format!(
            "refusing to write path with '..' component: {path}"
        ));
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("failed to create parent dir: {e}"))?;
        }
    }
    tokio::fs::write(&target, &content)
        .await
        .map_err(|e| format!("failed to write file {}: {e}", target.display()))
}

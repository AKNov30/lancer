use std::path::{Path, PathBuf};

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

/// Rename a workspace file or folder. Works for both `.bru` files and
/// sub-collection folders. The two paths must be on the same filesystem.
#[tauri::command]
pub fn rename_path(from: PathBuf, to: PathBuf) -> Result<(), String> {
    if !from.exists() {
        return Err(format!("source does not exist: {}", from.display()));
    }
    if to.exists() {
        return Err(format!(
            "destination already exists: {}; pick a different name",
            to.display()
        ));
    }
    // Ensure the destination parent exists (in case the user moves across folders).
    if let Some(parent) = to.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())?;

    // The sidebar tree displays a request's internal `meta.name`, not its
    // filename stem (see `io::list_workspace`). A filesystem-only rename would
    // therefore leave the displayed name stale after refresh. For `.bru` files,
    // sync the internal `meta.name` to the new filename stem so the tree shows
    // the new name. Best-effort: a failure here shouldn't undo the rename.
    if to.is_file() && to.extension().and_then(|e| e.to_str()) == Some("bru") {
        if let Some(stem) = to.file_stem().and_then(|s| s.to_str()) {
            let _ = io::set_bru_meta_name(&to, stem);
        }
    }
    Ok(())
}

/// Delete a workspace file or folder. Folders are deleted recursively
/// (matching shell `rm -rf` semantics) since users expect "delete this
/// collection" to actually delete it.
#[tauri::command]
pub fn delete_path(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// Create an empty sub-folder inside the workspace. Refuses to overwrite
/// an existing folder with the same name.
#[tauri::command]
pub fn create_folder(parent: PathBuf, name: String) -> Result<PathBuf, String> {
    let safe_name = sanitize_folder_name(&name)?;
    let target = parent.join(&safe_name);
    if target.exists() {
        return Err(format!(
            "a file or folder named '{safe_name}' already exists in this location"
        ));
    }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Return the default location where Lancer creates new named workspaces:
/// `<Documents>/Lancer/`. Used by the "New workspace" dialog to show the
/// user where their data is going BEFORE they commit to a name.
#[tauri::command]
pub fn default_workspace_root() -> Result<PathBuf, String> {
    let docs = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "cannot locate Documents folder".to_string())?;
    Ok(docs.join("Lancer"))
}

/// Create a brand-new workspace by name. Resolves to
/// `<Documents>/Lancer/<name>/` and returns the absolute path so the caller
/// can `setRootPath` to it immediately. Rejects duplicate names instead of
/// silently re-using an existing folder — that would surprise users with
/// "where did my pre-existing requests come from?".
#[tauri::command]
pub fn create_named_workspace(name: String) -> Result<PathBuf, String> {
    let safe_name = sanitize_folder_name(&name)?;
    let root = default_workspace_root()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("cannot create Lancer base folder: {e}"))?;
    let target = root.join(&safe_name);
    if target.exists() {
        return Err(format!(
            "a workspace named \"{safe_name}\" already exists at {}",
            target.display()
        ));
    }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Folder names: trim whitespace, forbid path separators and control chars.
/// Keeps the name OS-portable (no `:` `*` `?` etc. on Windows).
fn sanitize_folder_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("folder name cannot be empty".into());
    }
    if trimmed.len() > 80 {
        return Err("folder name too long (max 80 characters)".into());
    }
    if trimmed.chars().any(|c| {
        matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
    }) {
        return Err("folder name contains invalid characters".into());
    }
    Ok(trimmed.to_string())
}

/// Move a file or folder into a different parent directory. Used by the
/// sidebar drag-to-move flow: drop request `from` onto folder `to_parent`.
/// The file/folder keeps its original filename; only the parent changes.
/// Returns the new absolute path so the frontend can update open tabs.
#[tauri::command]
pub fn move_item(from: PathBuf, to_parent: PathBuf) -> Result<PathBuf, String> {
    if !from.exists() {
        return Err(format!("source does not exist: {}", from.display()));
    }
    if !to_parent.exists() {
        return Err(format!(
            "destination folder does not exist: {}",
            to_parent.display()
        ));
    }
    if !to_parent.is_dir() {
        return Err(format!(
            "destination is not a folder: {}",
            to_parent.display()
        ));
    }
    let file_name = from
        .file_name()
        .ok_or_else(|| "source has no file name".to_string())?;
    let target = to_parent.join(file_name);
    if target == from {
        // No-op: dropped on its current parent.
        return Ok(from);
    }
    if target.exists() {
        return Err(format!(
            "a file or folder named '{}' already exists in this folder",
            file_name.to_string_lossy()
        ));
    }
    // Refuse to move a folder into one of its own descendants.
    if from.is_dir() && target.starts_with(&from) {
        return Err("cannot move a folder into itself".into());
    }
    std::fs::rename(&from, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

/// Open the host OS's file manager pointed at `path`. On Windows uses
/// `explorer.exe`, on macOS `open`, on Linux `xdg-open`. Best-effort —
/// failures bubble up as Tauri errors but the UI silently swallows them.
#[tauri::command]
pub fn reveal_in_file_manager(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    #[cfg(target_os = "windows")]
    {
        // `explorer.exe` accepts a folder path directly. If the path is a
        // file, `/select,` highlights it inside its parent folder — but our
        // current callers pass folders, so just opening is enough.
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Duplicate a file or folder on disk. For folders, copies recursively.
/// The new name uses `" (copy)"` suffix to keep the original safe; the
/// caller is responsible for opening the duplicate in a tab if desired.
#[tauri::command]
pub fn duplicate_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "path has no file name".to_string())?;

    // Split stem + extension so the copy suffix lands BEFORE `.bru` rather
    // than at the end of the whole filename (`req (copy).bru` not
    // `req.bru (copy)`).
    let (stem, ext) = match file_name.rfind('.') {
        Some(i) if path.is_file() => (&file_name[..i], &file_name[i..]),
        _ => (file_name, ""),
    };

    let mut candidate = parent.join(format!("{stem} (copy){ext}"));
    let mut n = 2;
    while candidate.exists() && n < 1000 {
        candidate = parent.join(format!("{stem} (copy {n}){ext}"));
        n += 1;
    }

    if path.is_dir() {
        copy_dir_recursive(&path, &candidate).map_err(|e| e.to_string())?;
    } else {
        std::fs::copy(&path, &candidate).map_err(|e| e.to_string())?;
    }
    Ok(candidate)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Best-effort: was a given path inside a given workspace root?
/// (Used by the frontend to refresh after creating/deleting files.)
#[tauri::command]
pub fn path_in_workspace(path: PathBuf, root: PathBuf) -> bool {
    fn norm(p: &Path) -> PathBuf {
        p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
    }
    let p = norm(&path);
    let r = norm(&root);
    p.starts_with(r)
}

use std::path::PathBuf;

use crate::env::io::write_env;
use crate::importers::openapi::walk::{import_spec, ImportReport};
use crate::importers::postman::env::convert_env;
use crate::importers::postman::schema::PostmanEnv;
use crate::importers::postman::walk::{import_collection, ImportReport as PostmanImportReport};

/// Sniff the file extension + first 8KB and return one of:
///   "postman"      — Postman v2.1 collection JSON
///   "postman-env"  — Postman v2.1 environment JSON
///   "openapi"      — OpenAPI 3.x or Swagger 2.0 (JSON or YAML)
///   "unknown"      — couldn't decide; UI should ask the user
///
/// Used by the unified "Import from file…" picker so the user doesn't have
/// to remember which format they're dropping in.
#[tauri::command]
pub fn detect_file_format(path: PathBuf) -> Result<String, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("cannot read file: {e}"))?;
    // Sniff the first ~8KB. Floor the cut to a char boundary so a multibyte
    // codepoint straddling byte 8192 doesn't panic the slice.
    let head = {
        let mut cut = text.len().min(8192);
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        &text[..cut]
    };
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    // YAML path → only OpenAPI/Swagger uses YAML at this layer.
    if ext == "yaml" || ext == "yml" {
        if head.contains("openapi:") || head.contains("swagger:") {
            return Ok("openapi".to_string());
        }
        return Ok("unknown".to_string());
    }

    // JSON detection — keyword sniff is fine because each format has
    // distinctive top-level keys.
    if head.contains("\"_postman_variable_scope\"") {
        return Ok("postman-env".to_string());
    }
    if head.contains("schema.getpostman.com") || head.contains("\"_postman_id\"") {
        return Ok("postman".to_string());
    }
    if head.contains("\"openapi\"") || head.contains("\"swagger\"") {
        return Ok("openapi".to_string());
    }
    Ok("unknown".to_string())
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A file whose first 8KB ends mid-multibyte-codepoint must not panic the
    /// format sniffer's slice.
    #[test]
    fn detect_file_format_handles_multibyte_at_8k_boundary() {
        // Fill so byte 8192 lands inside a 3-byte UTF-8 char (の = E3 81 AE).
        // 8191 ASCII bytes + a multibyte char straddles the 8192 cut.
        let mut s = String::with_capacity(9000);
        for _ in 0..8191 {
            s.push('a');
        }
        s.push('の'); // bytes 8191..8194 — boundary 8192 is mid-codepoint
        s.push_str("\"openapi\"");

        let mut f = tempfile::Builder::new().suffix(".json").tempfile().unwrap();
        f.write_all(s.as_bytes()).unwrap();

        // Must return without panicking. Content has no recognised key in the
        // first 8KB (the `"openapi"` marker is past the cut), so "unknown".
        let got = detect_file_format(f.path().to_path_buf()).unwrap();
        assert_eq!(got, "unknown");
    }
}

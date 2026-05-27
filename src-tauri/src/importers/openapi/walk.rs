use std::fs;
use std::path::Path;

use openapiv3::ReferenceOr;
use serde::{Deserialize, Serialize};

use crate::collection::bru as bru_ser;
use crate::env::io as env_io;
use crate::env::schema::Environment;
use crate::importers::openapi::{convert, load};

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("load: {0}")]
    Load(#[from] load::LoadError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("env write: {0}")]
    EnvWrite(#[from] crate::env::io::EnvIoError),
}

impl serde::Serialize for ImportError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Summary returned to the caller after an import run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// Paths of `.bru` files that were written (relative to `dest_root`).
    pub created_files: Vec<String>,
    /// Paths of `.bru` files that already existed and were skipped.
    pub skipped_existing: Vec<String>,
    /// Per-operation errors that were non-fatal.
    pub errors: Vec<String>,
    /// Path of the environment file created, or `None` if no servers were present.
    pub env_created: Option<String>,
}

/// Import an OpenAPI 3 spec into a Lancer collection folder.
///
/// - Writes `<dest_root>/environments/imported.bru` with `baseUrl` from `servers[0]`.
/// - For every (path, method) combination, writes `<sanitize(name)>.bru` directly
///   into `dest_root`.
/// - Skips any file that already exists (recorded in `report.skipped_existing`).
/// - Does **not** panic on per-operation conversion errors; they go to `report.errors`.
pub fn import_spec(spec_path: &Path, dest_root: &Path) -> Result<ImportReport, ImportError> {
    let spec = load::load_spec(spec_path)?;
    fs::create_dir_all(dest_root)?;

    let mut report = ImportReport {
        created_files: Vec::new(),
        skipped_existing: Vec::new(),
        errors: Vec::new(),
        env_created: None,
    };

    // Write environment file with baseUrl from first server.
    let base_url = spec
        .servers
        .first()
        .map(|s| s.url.clone())
        .unwrap_or_default();

    if !base_url.is_empty() {
        let env = Environment {
            name: "imported".to_string(),
            vars: vec![("baseUrl".to_string(), base_url)],
            secret_names: Vec::new(),
        };
        env_io::write_env(dest_root, &env)?;
        report.env_created = Some(
            dest_root
                .join("environments")
                .join("imported.bru")
                .to_string_lossy()
                .into_owned(),
        );
    }

    // Walk every path × method.
    for (path_str, path_item_ref) in &spec.paths.paths {
        let path_item = match path_item_ref {
            ReferenceOr::Item(item) => item,
            ReferenceOr::Reference { .. } => continue,
        };

        // Collect all (method_str, operation) pairs.
        let ops: Vec<(&str, &openapiv3::Operation)> = [
            ("get", path_item.get.as_ref()),
            ("post", path_item.post.as_ref()),
            ("put", path_item.put.as_ref()),
            ("patch", path_item.patch.as_ref()),
            ("delete", path_item.delete.as_ref()),
            ("head", path_item.head.as_ref()),
            ("options", path_item.options.as_ref()),
            ("trace", path_item.trace.as_ref()),
        ]
        .into_iter()
        .filter_map(|(m, maybe)| maybe.map(|op| (m, op)))
        .collect();

        for (method, op) in ops {
            match convert::convert_operation(path_str, method, op, &spec) {
                Ok(req) => {
                    let stem = sanitize_filename(&req.name);
                    // SECURITY (defense-in-depth): `sanitize_filename` replaces
                    // separators but not `.`/`..`, so a name like `..` could
                    // produce a `..bru` write — or, combined with a malformed
                    // name, escape `dest_root`. Reject any unsafe filename stem.
                    if !crate::fsutil::is_safe_name(&stem) {
                        report
                            .errors
                            .push(format!("{method} {path_str}: unsafe filename '{stem}'"));
                        continue;
                    }
                    let filename = stem + ".bru";
                    let dest_path = dest_root.join(&filename);
                    let rel = filename.clone();

                    // Canonicalized containment check: the resolved file must
                    // stay under dest_root. Skip + record on a breach.
                    if !is_within(dest_root, &dest_path) {
                        report.errors.push(format!(
                            "{method} {path_str}: resolved path escapes dest dir"
                        ));
                        continue;
                    }

                    if dest_path.exists() {
                        report.skipped_existing.push(rel);
                        continue;
                    }

                    let text = bru_ser::serialize(&req);
                    match fs::write(&dest_path, text) {
                        Ok(_) => report.created_files.push(rel),
                        Err(e) => report
                            .errors
                            .push(format!("{method} {path_str}: write error: {e}")),
                    }
                }
                Err(e) => {
                    report.errors.push(format!("{method} {path_str}: {e}"));
                }
            }
        }
    }

    Ok(report)
}

/// True if `file` resolves to a location inside `base`. The file itself may not
/// exist yet, so we canonicalize its parent directory (which does exist) and
/// confirm it's still under the canonicalized `base`.
fn is_within(base: &Path, file: &Path) -> bool {
    let base_c = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let parent = file.parent().unwrap_or(file);
    let parent_c = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    parent_c.starts_with(&base_c)
}

/// Convert an operation name/id into a safe filename fragment.
/// Replaces characters that are invalid on common filesystems.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | ' ' => '_',
            c => c,
        })
        .collect()
}

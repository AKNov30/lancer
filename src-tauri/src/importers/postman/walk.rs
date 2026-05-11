use std::fs;
use std::path::Path;

use crate::collection::io::write_request;
use crate::importers::postman::convert::{convert_request, extract_scripts, walk_items};
use crate::importers::postman::schema::PostmanCollection;

/// Result of importing a Postman collection.
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub created: Vec<String>,
    pub skipped_existing: Vec<String>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

/// Import a Postman v2.1 collection JSON file into a Lancer workspace directory.
///
/// The directory tree mirrors the folder hierarchy in the collection.
/// Files that already exist at the target path are skipped (not overwritten).
pub fn import_collection(collection_path: &Path, dest_root: &Path) -> ImportReport {
    let mut report = ImportReport::default();

    let text = match fs::read_to_string(collection_path) {
        Ok(t) => t,
        Err(e) => {
            report
                .errors
                .push(format!("cannot read collection file: {e}"));
            return report;
        }
    };

    let collection: PostmanCollection = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => {
            report
                .errors
                .push(format!("cannot parse collection JSON: {e}"));
            return report;
        }
    };

    // Collect all leaf requests with their folder paths.
    let mut leaves: Vec<(String, &crate::importers::postman::schema::ItemOrFolder)> = Vec::new();
    walk_items(&collection.item, "", &mut leaves);

    let total = leaves.len();
    for (i, (folder_path, item)) in leaves.iter().enumerate() {
        let Some(pm_req) = &item.request else {
            continue;
        };

        let (pre, post) = extract_scripts(&item.event);
        let seq = (i + 1) as u32;

        let mut warnings: Vec<String> = Vec::new();
        let req = convert_request(&item.name, seq, pm_req, pre, post, &mut warnings);
        report.warnings.extend(warnings);

        // Build destination path: <dest_root>/<folder_path>/<sanitized_name>.bru
        let mut dest_dir = dest_root.to_path_buf();
        if !folder_path.is_empty() {
            for segment in folder_path.split('/') {
                dest_dir = dest_dir.join(sanitize_name(segment));
            }
        }
        let file_name = format!("{}.bru", sanitize_name(&item.name));
        let dest_path = dest_dir.join(&file_name);

        if dest_path.exists() {
            report
                .skipped_existing
                .push(dest_path.to_string_lossy().into_owned());
            continue;
        }

        if let Err(e) = fs::create_dir_all(&dest_dir) {
            report.errors.push(format!(
                "cannot create directory '{}': {e}",
                dest_dir.display()
            ));
            continue;
        }

        match write_request(&dest_path, &req) {
            Ok(()) => {
                report
                    .created
                    .push(dest_path.to_string_lossy().into_owned());
            }
            Err(e) => {
                report
                    .errors
                    .push(format!("cannot write '{}': {e}", dest_path.display()));
            }
        }
    }

    let _ = total; // suppress unused warning
    report
}

/// Replace characters that are invalid in file/directory names with `_`.
fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

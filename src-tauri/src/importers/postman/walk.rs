use std::fs;
use std::path::Path;

use crate::collection::io::write_request;
use crate::importers::postman::convert::{convert_request, extract_scripts, walk_items};
use crate::importers::postman::schema::{
    ItemOrFolder, PostmanBody, PostmanCollection, PostmanHeader, PostmanRequest, PostmanUrl,
    PostmanV1Collection, PostmanV1Request, RequestOrUrl,
};

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

    // Try v2.x first (the modern shape). If that fails AND the file looks
    // like a Postman v1 export (legacy `requests` field), convert v1 → v2.1
    // in memory and continue with the same walker.
    let collection: PostmanCollection = match serde_json::from_str::<PostmanCollection>(&text) {
        Ok(c) if !c.item.is_empty() || !c.info.name.is_empty() => c,
        v2_result => {
            // Either v2 parse failed OR succeeded with an empty shell — both
            // hint that this might be a v1 file. Attempt v1 parsing.
            match serde_json::from_str::<PostmanV1Collection>(&text) {
                Ok(v1)
                    if !v1.requests.is_empty()
                        || !v1.folders.is_empty()
                        || !v1.order.is_empty() =>
                {
                    report
                        .warnings
                        .push("Detected Postman v1 (legacy) — converting to v2.1.".into());
                    convert_v1_to_v2(v1)
                }
                _ => {
                    // Surface whichever error is more informative: prefer the
                    // original v2 parse error since users mostly export v2.
                    let msg = match v2_result {
                        Err(e) => format!("cannot parse collection JSON (v2 attempt): {e}"),
                        Ok(_) => "collection had no requests or folders (empty)".into(),
                    };
                    report.errors.push(msg);
                    return report;
                }
            }
        }
    };

    // Each Postman collection becomes ONE sub-folder under the workspace
    // root — `<workspace>/<Collection name>/…items`. That preserves the
    // "workspace = container of collections" model and stops the importer
    // from polluting the workspace root with loose `.bru` files. The
    // collection name is sanitised + de-duplicated so re-imports don't
    // clobber an existing folder.
    let raw_name = collection.info.name.trim();
    let collection_dir = pick_unique_collection_dir(
        dest_root,
        if raw_name.is_empty() {
            "Imported collection"
        } else {
            raw_name
        },
    );
    if let Err(e) = fs::create_dir_all(&collection_dir) {
        report
            .errors
            .push(format!("cannot create collection folder: {e}"));
        return report;
    }
    let dest_root = collection_dir.as_path();

    // Collect all leaf requests with their folder paths.
    let mut leaves: Vec<(String, &crate::importers::postman::schema::ItemOrFolder)> = Vec::new();
    walk_items(&collection.item, "", &mut leaves);

    let total = leaves.len();
    // Track every `.bru` path we assign in THIS import so same-named requests
    // (Postman collections are full of the default "New Request") get numbered
    // instead of colliding on one path and being skipped.
    let mut used_paths: std::collections::HashSet<std::path::PathBuf> =
        std::collections::HashSet::new();
    for (i, (folder_path, item)) in leaves.iter().enumerate() {
        // Resolve the (possibly URL-shorthand) request. A leaf with no usable
        // request is recorded as a warning rather than silently dropped, so
        // the import report always explains every missing item.
        let Some(pm_req) = item.resolved_request() else {
            let where_ = if folder_path.is_empty() {
                String::new()
            } else {
                format!(" (in folder '{folder_path}')")
            };
            report.warnings.push(format!(
                "skipped \"{}\"{}: item has no request and no sub-items",
                item.name, where_
            ));
            continue;
        };

        let (pre, post) = extract_scripts(&item.event);
        let seq = (i + 1) as u32;

        let mut warnings: Vec<String> = Vec::new();
        let req = convert_request(&item.name, seq, &pm_req, pre, post, &mut warnings);
        report.warnings.extend(warnings);

        // Build destination path: <dest_root>/<folder_path>/<sanitized_name>.bru
        //
        // SECURITY: `sanitize_name` does NOT strip `.`/`..`, so a folder named
        // `..` would escape the collection dir → arbitrary file write. Reject
        // any traversal segment up front (defense layer 1); a canonicalized
        // containment check after the path is built is layer 2 (below).
        let mut dest_dir = dest_root.to_path_buf();
        let mut unsafe_segment = false;
        if !folder_path.is_empty() {
            for segment in folder_path.split('/') {
                let cleaned = sanitize_name(segment);
                if !crate::fsutil::is_safe_name(&cleaned) {
                    unsafe_segment = true;
                    break;
                }
                dest_dir = dest_dir.join(cleaned);
            }
        }
        if unsafe_segment {
            report.warnings.push(format!(
                "skipped \"{}\": folder path '{folder_path}' contains an unsafe segment (e.g. '..')",
                item.name
            ));
            continue;
        }
        // De-duplicate within the import: number same-named requests
        // (New Request, New Request 2, …) rather than skipping them, so every
        // request lands on disk. Also avoids clobbering a pre-existing file.
        let base = sanitize_name(&item.name);
        let mut dest_path = dest_dir.join(format!("{base}.bru"));
        let mut n = 2;
        while used_paths.contains(&dest_path) || dest_path.exists() {
            dest_path = dest_dir.join(format!("{base} {n}.bru"));
            n += 1;
        }
        used_paths.insert(dest_path.clone());

        if let Err(e) = fs::create_dir_all(&dest_dir) {
            report.errors.push(format!(
                "cannot create directory '{}': {e}",
                dest_dir.display()
            ));
            continue;
        }

        // SECURITY layer 2 (defense-in-depth): after the directory exists,
        // canonicalize the destination dir and assert it's still under the
        // chosen collection dir. Catches any traversal that slipped past the
        // per-segment check (symlinks, odd separators). Skip + warn on a breach.
        if !is_within(dest_root, &dest_dir) {
            report.warnings.push(format!(
                "skipped \"{}\": resolved path '{}' escapes the collection directory",
                item.name,
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

/// True if `candidate` resolves to a path inside `base`. Both are canonicalized
/// when possible so symlinks / `..` / mixed separators are resolved before the
/// prefix check; falls back to the literal path when canonicalize fails (e.g.
/// the dir doesn't exist yet — callers create it first, so it normally does).
fn is_within(base: &Path, candidate: &Path) -> bool {
    let base_c = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let cand_c = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    cand_c.starts_with(&base_c)
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

/// Find an unused folder under `root` for the collection. Appends ` (2)`,
/// ` (3)`… until we get a non-existing path. Cap at 999 to avoid runaway
/// loops on a filesystem hiccup.
fn pick_unique_collection_dir(root: &Path, raw_name: &str) -> std::path::PathBuf {
    let base = sanitize_name(raw_name);
    let mut candidate = root.join(&base);
    if !candidate.exists() {
        return candidate;
    }
    for n in 2..=999 {
        candidate = root.join(format!("{base} ({n})"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // Pathological: fall back to a name with the candidate count so we
    // never write into a path we can't predict.
    root.join(format!("{base} (1000)"))
}

// ─── v1 → v2.1 in-memory conversion ─────────────────────────────────────────
//
// Build a `PostmanCollection` that the existing walker can consume, so we
// don't have to keep a second code path for the legacy format.

fn convert_v1_to_v2(v1: PostmanV1Collection) -> PostmanCollection {
    use std::collections::HashMap;

    // Index requests by id so the folder/order arrays can resolve them.
    let req_index: HashMap<String, &PostmanV1Request> =
        v1.requests.iter().map(|r| (r.id.clone(), r)).collect();

    let mut items: Vec<ItemOrFolder> = Vec::new();

    // Folders (each becomes an ItemOrFolder with its own item list).
    for folder in &v1.folders {
        let mut folder_items: Vec<ItemOrFolder> = Vec::new();
        for rid in &folder.order {
            if let Some(req) = req_index.get(rid) {
                folder_items.push(convert_v1_request(req));
            }
        }
        items.push(ItemOrFolder {
            name: if folder.name.is_empty() {
                "Untitled folder".into()
            } else {
                folder.name.clone()
            },
            request: None,
            item: folder_items,
            event: Vec::new(),
        });
    }

    // Top-level requests (referenced by collection-level `order`).
    for rid in &v1.order {
        if let Some(req) = req_index.get(rid) {
            items.push(convert_v1_request(req));
        }
    }

    // Any requests not referenced by order/folders — emit at the root so
    // they're not silently lost (older v1 exports sometimes omit `order`).
    let referenced: std::collections::HashSet<&str> = v1
        .order
        .iter()
        .chain(v1.folders.iter().flat_map(|f| f.order.iter()))
        .map(|s| s.as_str())
        .collect();
    for req in &v1.requests {
        if !referenced.contains(req.id.as_str()) {
            items.push(convert_v1_request(req));
        }
    }

    PostmanCollection {
        info: crate::importers::postman::schema::CollectionInfo {
            name: if v1.name.is_empty() {
                "Imported v1 collection".into()
            } else {
                v1.name
            },
            schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json".into(),
        },
        item: items,
        event: Vec::new(),
    }
}

fn convert_v1_request(v1: &PostmanV1Request) -> ItemOrFolder {
    // Parse the newline-separated header string into structured pairs.
    let header: Vec<PostmanHeader> = v1
        .headers
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let (k, v) = line.split_once(':')?;
            Some(PostmanHeader {
                key: k.trim().to_string(),
                value: v.trim().to_string(),
                disabled: false,
            })
        })
        .collect();

    // Body — translate dataMode to v2 PostmanBody.mode + the right field.
    let body: Option<PostmanBody> = match v1.data_mode.as_str() {
        "raw" => Some(PostmanBody {
            mode: "raw".into(),
            raw: v1.raw_mode_data.clone(),
            urlencoded: Vec::new(),
            formdata: Vec::new(),
            graphql: None,
            options: None,
        }),
        "urlencoded" | "params" => {
            let fields: Vec<crate::importers::postman::schema::FormField> = v1
                .data
                .iter()
                .map(|kv| crate::importers::postman::schema::FormField {
                    key: kv.key.clone(),
                    value: Some(kv.value.clone()),
                    disabled: !kv.enabled,
                    field_type: "text".into(),
                    src: None,
                })
                .collect();
            let is_multipart = v1.data_mode == "params";
            Some(PostmanBody {
                mode: if is_multipart {
                    "formdata"
                } else {
                    "urlencoded"
                }
                .into(),
                raw: None,
                urlencoded: if is_multipart {
                    Vec::new()
                } else {
                    fields.clone()
                },
                formdata: if is_multipart { fields } else { Vec::new() },
                graphql: None,
                options: None,
            })
        }
        _ => None,
    };

    let request = PostmanRequest {
        method: if v1.method.is_empty() {
            "GET".into()
        } else {
            v1.method.clone()
        },
        url: PostmanUrl::String(v1.url.clone()),
        header,
        body,
        auth: None,
        description: v1.description.clone(),
    };

    ItemOrFolder {
        name: if v1.name.is_empty() {
            // Char-safe truncation: slicing `&v1.id[..8]` panics if byte 8 lands
            // mid-codepoint (multibyte ids from non-ASCII exports).
            format!("Request {}", v1.id.chars().take(8).collect::<String>())
        } else {
            v1.name.clone()
        },
        request: Some(RequestOrUrl::Full(Box::new(request))),
        item: Vec::new(),
        event: Vec::new(),
    }
}

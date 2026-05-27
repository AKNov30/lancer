//! Collection-level (folder-level) variables, parsed from `folder.bru` files
//! at any depth in the workspace.
//!
//! Bruno's `folder.bru` carries a `vars { ... }` block whose entries are
//! visible to every request inside that folder (and its descendants). When a
//! request fires, we walk from the request's parent directory up to the
//! workspace root, collecting every `folder.bru` we find along the way. The
//! closer the folder is to the request, the higher its precedence — so an
//! override placed next to the request beats one at the workspace root.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::collection::lexer;
use crate::collection::schema::{Auth, KvEnabled};

/// Read a single `folder.bru` and return its `vars` map, or empty if the
/// file is missing or has no `vars` block. Malformed files yield empty
/// rather than failing — keeps the sidebar usable even when one folder
/// has a syntax error.
fn read_one(folder: &Path) -> HashMap<String, String> {
    let path = folder.join("folder.bru");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(blocks) = lexer::split_blocks(&text) else {
        return HashMap::new();
    };
    let Some(vars_text) = blocks.map.get("vars") else {
        return HashMap::new();
    };
    // Use the disabled-aware parser and skip `~`-prefixed (disabled) rows.
    // `parse_kv_block` strips the `~`, so disabled folder vars would otherwise
    // still apply on the send path — a real bug.
    parse_kv_with_disabled(vars_text)
        .into_iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key, kv.value))
        .collect()
}

/// Walk from `request_path`'s parent directory up to `workspace_root` and
/// merge every `folder.bru`'s `vars` block. Closer folders win on key
/// collisions (workspace-root → leaf precedence chain).
///
/// Returns an empty map if `request_path` lives outside `workspace_root` or
/// if no `folder.bru` exists along the chain.
pub fn collect_chain(workspace_root: &Path, request_path: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();

    // Canonicalize so prefix checks survive `..` / mixed separators on win.
    let root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let abs_req = request_path
        .canonicalize()
        .unwrap_or_else(|_| request_path.to_path_buf());

    // Build the list of folders from workspace_root down to the request's
    // parent. We walk them root-first so deeper folders overwrite shallower
    // entries on the same key — exactly the precedence we want.
    let Some(start) = abs_req.parent() else {
        return out;
    };
    if !start.starts_with(&root) {
        return out;
    }

    let mut chain: Vec<&Path> = Vec::new();
    let mut cursor = Some(start);
    while let Some(p) = cursor {
        chain.push(p);
        if p == root {
            break;
        }
        cursor = p.parent();
    }
    // Reverse → root first, leaf last.
    chain.reverse();

    for folder in chain {
        let vars = read_one(folder);
        for (k, v) in vars {
            out.insert(k, v);
        }
    }
    out
}

/// Walk from `request_path`'s parent directory up to `workspace_root` and
/// return the **nearest** ancestor folder's default Authorization, if any.
///
/// Unlike [`collect_chain`] (which merges every folder's vars with leaf-wins
/// precedence), auth does not merge: the closest folder that defines a
/// concrete (non-`None`) auth wins outright, and the walk stops there. This
/// is the standard Postman/Bruno "inherit auth from parent" behaviour — a
/// sub-folder's auth fully overrides a parent's rather than blending.
///
/// Returns `None` if `request_path` lives outside `workspace_root`, or if no
/// `folder.bru` along the chain defines a default auth.
pub fn collect_auth_chain(workspace_root: &Path, request_path: &Path) -> Option<Auth> {
    // Canonicalize so prefix checks survive `..` / mixed separators on win.
    let root = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    let abs_req = request_path
        .canonicalize()
        .unwrap_or_else(|_| request_path.to_path_buf());

    let start = abs_req.parent()?;
    if !start.starts_with(&root) {
        return None;
    }

    // Walk leaf → root, returning the first folder that defines a concrete
    // default auth. (read_one_full already filters out `Auth::None`.)
    let mut cursor = Some(start);
    while let Some(p) = cursor {
        if let Some(auth) = read_one_full(p).auth {
            if !matches!(auth, Auth::None) {
                return Some(auth);
            }
        }
        if p == root {
            break;
        }
        cursor = p.parent();
    }
    None
}

/// Editable settings for a single folder. Right now this is just `vars` plus
/// an optional `description`, but it's the natural growing place for any
/// future collection-level UI (auth defaults, pre-request scripts, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSettings {
    /// `vars { ... }` block — KV pairs with per-row enable toggle. Disabled
    /// rows are serialised with the Bruno `~` prefix.
    pub vars: Vec<KvEnabled>,
    /// `meta { name: ... }` field — folder name override (rarely used; on
    /// disk Bruno usually leaves this blank and relies on the directory
    /// name). We pass it through so the UI can show it.
    pub name: String,
    /// `docs { ... }` block — free-text/markdown description for the
    /// collection. Makes a collection more than a bare folder (Postman's
    /// "Overview" docs). Defaulted so older files without it still load.
    #[serde(default)]
    pub description: String,
    /// Default Authorization for the collection. Requests inside the folder
    /// that have no explicit auth (`Auth::None`) inherit the nearest ancestor
    /// folder's auth — the standard Postman/Bruno "inherit from parent"
    /// behaviour. Stored on disk as an `auth { mode: … }` marker block plus an
    /// `auth:<mode> { … }` block (mirroring how requests store auth). `None`
    /// means the folder defines no default; older files without it still load.
    #[serde(default)]
    pub auth: Option<Auth>,
}

fn read_one_full(folder: &Path) -> FolderSettings {
    let path = folder.join("folder.bru");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return FolderSettings::default();
    };
    let Ok(blocks) = lexer::split_blocks(&text) else {
        return FolderSettings::default();
    };

    let mut settings = FolderSettings::default();

    // Vars block — read all rows including disabled ones (those have keys
    // that start with `~` in the lexer output? Actually parse_kv_block
    // strips the `~`; we lose enabled state. Re-parse manually below).
    if let Some(vars_text) = blocks.map.get("vars") {
        settings.vars = parse_kv_with_disabled(vars_text);
    }

    // Meta → name (optional)
    if let Some(meta_text) = blocks.map.get("meta") {
        let kv = lexer::parse_kv_block(meta_text).unwrap_or_default();
        if let Some(name) = kv.get("name") {
            settings.name = name.clone();
        }
    }

    // Docs → description (free-text/markdown)
    if let Some(docs_text) = blocks.map.get("docs") {
        settings.description = docs_text.trim().to_string();
    }

    // Auth → default Authorization for the collection. The mode lives in an
    // `auth { mode: … }` block; the fields in the matching `auth:<mode>`
    // block, parsed by the shared `bru::parse_auth`. A mode of `none` (or a
    // missing/malformed marker) leaves `auth` as `None` so the folder is
    // treated as defining no default.
    if let Some(auth_text) = blocks.map.get("auth") {
        let kv = lexer::parse_kv_block(auth_text).unwrap_or_default();
        let mode = kv.get("mode").map(String::as_str);
        if !matches!(mode, None | Some("none")) {
            match crate::collection::bru::parse_auth(&blocks, mode) {
                Ok(parsed) => settings.auth = parsed.filter(|a| !matches!(a, Auth::None)),
                // Don't silently drop a configured-but-malformed folder auth —
                // surface it so a broken `auth:<mode>` block is debuggable.
                Err(e) => eprintln!(
                    "folder.bru auth parse failed for {}: {e}",
                    folder.join("folder.bru").display()
                ),
            }
        }
    }

    settings
}

/// Lightweight KV parser that preserves Bruno's `~`-prefix disabled marker
/// (which `parse_kv_block` collapses). Format: one `key: value` per line,
/// lines beginning with `~` are present-but-disabled.
fn parse_kv_with_disabled(text: &str) -> Vec<KvEnabled> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (disabled, body) = if let Some(stripped) = line.strip_prefix('~') {
            (true, stripped.trim_start())
        } else {
            (false, line)
        };
        if let Some((k, v)) = body.split_once(':') {
            out.push(KvEnabled {
                key: k.trim().to_string(),
                value: v.trim().to_string(),
                enabled: !disabled,
            });
        }
    }
    out
}

/// Read the `folder.bru` for one folder. Empty struct if the file doesn't
/// exist (or is malformed) so the UI shows blank rows the user can fill in.
#[tauri::command]
pub fn read_folder_settings(folder_path: std::path::PathBuf) -> Result<FolderSettings, String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("folder does not exist: {}", folder_path.display()));
    }
    Ok(read_one_full(&folder_path))
}

/// Persist the `folder.bru` for one folder. Replaces the entire file with a
/// canonical layout: `meta` block first, then `vars`. Any blocks in the
/// previous file that weren't `meta` or `vars` (e.g. future `auth` defaults)
/// are preserved verbatim so a hand-edited file doesn't lose data.
#[tauri::command]
pub fn write_folder_settings(
    folder_path: std::path::PathBuf,
    settings: FolderSettings,
) -> Result<(), String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err(format!("folder does not exist: {}", folder_path.display()));
    }

    // Preserve unknown blocks from the previous file (anything other than
    // `meta` + `vars`). This means hand-edited extras survive a UI save.
    let target = folder_path.join("folder.bru");
    let mut extras: Vec<(String, String)> = Vec::new();
    if let Ok(text) = std::fs::read_to_string(&target) {
        if let Ok(blocks) = lexer::split_blocks(&text) {
            for (h, body) in blocks.map {
                // Exclude blocks we own and rewrite ourselves: meta, vars,
                // docs, the `auth` mode marker, and any `auth:<mode>` block.
                // Otherwise stale auth blocks would be double-written.
                let owned = h == "meta"
                    || h == "vars"
                    || h == "docs"
                    || h == "auth"
                    || h.starts_with("auth:");
                if !owned {
                    extras.push((h, body));
                }
            }
        }
    }
    // `blocks.map` is a HashMap, so iteration order is non-deterministic —
    // sort preserved extras by header for a stable, diff-friendly file.
    extras.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = String::new();

    // meta — always emit, with `type: folder` so Bruno recognises it.
    out.push_str("meta {\n  type: folder\n");
    if !settings.name.trim().is_empty() {
        out.push_str(&format!("  name: {}\n", settings.name.trim()));
    }
    out.push_str("}\n\n");

    // vars
    if !settings.vars.is_empty() {
        out.push_str("vars {\n");
        for v in &settings.vars {
            let prefix = if v.enabled { "" } else { "~" };
            out.push_str(&format!("  {prefix}{}: {}\n", v.key, v.value));
        }
        out.push_str("}\n");
    }

    // docs — free-text/markdown collection description
    if !settings.description.trim().is_empty() {
        out.push_str(&format!("\ndocs {{\n{}\n}}\n", settings.description.trim()));
    }

    // auth — collection default Authorization. Write the `auth { mode: … }`
    // marker plus the shared `auth:<mode>` block. Skip entirely when there's
    // no default or the default is `Auth::None` (nothing to inherit).
    if let Some(auth) = settings.auth.as_ref().filter(|a| !matches!(a, Auth::None)) {
        let mode = crate::collection::bru::auth_mode_marker(auth);
        out.push_str(&format!("\nauth {{\n  mode: {mode}\n}}\n\n"));
        crate::collection::bru::serialize_auth(auth, &mut out);
    }

    // Preserved extras
    for (header, body) in extras {
        out.push_str(&format!("\n{header} {{\n{body}\n}}\n"));
    }

    crate::fsutil::write_atomic(&target, out.as_bytes()).map_err(|e| e.to_string())
}

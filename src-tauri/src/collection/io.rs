use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::collection::bru;
use crate::collection::schema::Request;

/// Lightweight summary of a `.bru` file or folder for sidebar listing. Heavy
/// fields like headers/body/auth are not included — those are loaded via
/// [`read_request`] when the user opens the request.
///
/// Folder entries (`kind: "folder"`) carry only `path`/`rel_path`/`name`; their
/// `method` is empty and `seq` is `None`. They exist so empty folders still
/// render in the sidebar tree.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    /// `"file"` for `.bru` requests, `"folder"` for directories.
    pub kind: &'static str,
    pub path: PathBuf,
    pub rel_path: String,
    pub name: String,
    /// Uppercase method label, e.g. `"GET"`, `"POST"`. Empty for folders.
    pub method: String,
    pub seq: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum IoError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(#[from] crate::collection::bru::BruError),
}

impl serde::Serialize for IoError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Walk `root` recursively and return a `WorkspaceItem` for every parseable
/// `.bru` file. Files that fail to parse are silently skipped (a broken
/// collection should not break the sidebar — the user can fix the file in
/// their editor).
pub fn list_workspace(root: &Path) -> Result<Vec<WorkspaceItem>, IoError> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();

        // ── Folders: include every sub-directory (skip root itself) so the
        // sidebar tree can show empty folders the user just created. The
        // `environments/` directory is reserved for env files and not shown
        // in the requests tree.
        if path.is_dir() {
            if path == root {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(path)
                .to_string_lossy()
                .into_owned();
            if rel.is_empty() {
                continue;
            }
            // Filter reserved/hidden dirs (Bruno keeps env files here).
            let first_segment = rel.split(['/', '\\']).next().unwrap_or("");
            if first_segment == "environments"
                || first_segment.starts_with('.')
                || first_segment == "node_modules"
            {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            out.push(WorkspaceItem {
                kind: "folder",
                path: path.to_path_buf(),
                rel_path: rel,
                name,
                method: String::new(),
                seq: None,
            });
            continue;
        }

        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("bru") {
            continue;
        }
        // `folder.bru` is collection-level metadata (vars block), not a
        // request — exclude it from the request listing so it doesn't
        // appear as a clickable row in the sidebar tree.
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case("folder.bru"))
            .unwrap_or(false)
        {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(req) = bru::parse(&text) else {
            continue;
        };
        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        out.push(WorkspaceItem {
            kind: "file",
            path: path.to_path_buf(),
            rel_path,
            name: req.name,
            method: format_method(req.method),
            seq: req.seq,
        });
    }
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(out)
}

pub fn read_request(path: &Path) -> Result<Request, IoError> {
    let text = fs::read_to_string(path)?;
    Ok(bru::parse(&text)?)
}

/// Rewrite the `name:` line inside a `.bru` file's `meta { … }` block to
/// `new_name`, preserving the rest of the file byte-for-byte.
///
/// The sidebar tree shows a request's `meta.name` (see [`list_workspace`] —
/// `name: req.name`), NOT the filename stem. So a filesystem-only rename
/// leaves the displayed name stale after refresh. This brings the internal
/// name in sync with the new filename stem.
///
/// We do a targeted line edit rather than `bru::parse` + `bru::serialize`
/// because the serializer only round-trips blocks Lancer knows about — any
/// `docs`/`tags`/`assert`/`tests` blocks would be silently dropped. Editing
/// just the `name:` line in-place keeps the file otherwise untouched. If the
/// meta block has no `name:` line we insert one at its top; if the file has no
/// parseable meta block at all we leave it unchanged (best-effort).
pub fn rewrite_bru_meta_name(text: &str, new_name: &str) -> String {
    // Find the `meta` block header followed by `{`.
    let Some(meta_idx) = find_meta_block(text) else {
        return text.to_string();
    };
    // `meta_idx` points at the byte just after the opening `{` of the meta block.
    // Find the matching closing `}` so we only touch lines inside this block.
    let bytes = text.as_bytes();
    let mut i = meta_idx;
    let mut depth = 1usize;
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        if depth > 0 {
            i += 1;
        }
    }
    let block_end = i; // index of the closing `}` (or end of input)
    let head = &text[..meta_idx];
    let block_body = &text[meta_idx..block_end];
    let tail = &text[block_end..];

    // Replace the first `name:` line within the block body, preserving its
    // indentation. If none exists, insert one as the first line of the block.
    let mut replaced = false;
    let mut new_body = String::with_capacity(block_body.len() + new_name.len());
    for line in block_body.split_inclusive('\n') {
        if !replaced {
            let trimmed = line.trim_start();
            if let Some(rest) = trimmed.strip_prefix("name:") {
                let _ = rest;
                let indent_len = line.len() - trimmed.len();
                let indent = &line[..indent_len];
                let newline = if line.ends_with('\n') { "\n" } else { "" };
                new_body.push_str(indent);
                new_body.push_str("name: ");
                new_body.push_str(new_name);
                new_body.push_str(newline);
                replaced = true;
                continue;
            }
        }
        new_body.push_str(line);
    }
    if !replaced {
        // No name line found — prepend one after the opening brace's newline.
        let insertion = format!("\n  name: {new_name}");
        new_body = format!("{insertion}{new_body}");
    }

    format!("{head}{new_body}{tail}")
}

/// Return the byte index immediately AFTER the opening `{` of the top-level
/// `meta` block, or `None` if there's no such block.
fn find_meta_block(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    let len = bytes.len();
    while i < len {
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            break;
        }
        let header_start = i;
        while i < len && bytes[i] != b'{' && bytes[i] != b'\n' {
            i += 1;
        }
        let header = text[header_start..i].trim();
        if i >= len || bytes[i] != b'{' {
            // Malformed header line; bail out rather than risk corruption.
            return None;
        }
        i += 1; // skip `{`
        if header == "meta" {
            return Some(i);
        }
        // Skip this block's body to the matching `}`.
        let mut depth = 1usize;
        while i < len && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
    }
    None
}

/// Rewrite a `.bru` file on disk so its internal `meta.name` matches
/// `new_name`. No-op (Ok) if the file can't be read or has no meta block.
pub fn set_bru_meta_name(path: &Path, new_name: &str) -> Result<(), IoError> {
    let text = fs::read_to_string(path)?;
    let updated = rewrite_bru_meta_name(&text, new_name);
    if updated != text {
        crate::fsutil::write_atomic(path, updated.as_bytes())?;
    }
    Ok(())
}

pub fn write_request(path: &Path, req: &Request) -> Result<(), IoError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let text = bru::serialize(req);
    crate::fsutil::write_atomic(path, text.as_bytes())?;
    Ok(())
}

fn format_method(m: crate::http::types::Method) -> String {
    use crate::http::types::Method::*;
    match m {
        Get => "GET",
        Post => "POST",
        Put => "PUT",
        Patch => "PATCH",
        Delete => "DELETE",
        Head => "HEAD",
        Options => "OPTIONS",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_meta_name_replaces_existing_line() {
        let input =
            "meta {\n  name: Old Name\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://x\n}\n";
        let out = rewrite_bru_meta_name(input, "New Name");
        assert!(out.contains("name: New Name"));
        assert!(!out.contains("Old Name"));
        // Other meta fields and blocks are untouched.
        assert!(out.contains("type: http"));
        assert!(out.contains("seq: 1"));
        assert!(out.contains("url: https://x"));
    }

    #[test]
    fn rewrite_meta_name_preserves_unknown_blocks() {
        // `docs` is not a block Lancer's serializer round-trips; a parse +
        // re-serialize would drop it. The targeted rewrite must keep it.
        let input = "meta {\n  name: A\n}\n\nget {\n  url: https://x\n}\n\ndocs {\n# Hello\n}\n";
        let out = rewrite_bru_meta_name(input, "B");
        assert!(out.contains("name: B"));
        assert!(out.contains("docs {"));
        assert!(out.contains("# Hello"));
    }

    #[test]
    fn rewrite_meta_name_inserts_when_missing() {
        let input = "meta {\n  type: http\n}\n\nget {\n  url: https://x\n}\n";
        let out = rewrite_bru_meta_name(input, "Created");
        assert!(out.contains("name: Created"));
        // Re-parsing yields the new name.
        let req = bru::parse(&out).expect("parses");
        assert_eq!(req.name, "Created");
    }

    #[test]
    fn rewrite_meta_name_no_meta_block_is_noop() {
        let input = "get {\n  url: https://x\n}\n";
        let out = rewrite_bru_meta_name(input, "Whatever");
        assert_eq!(out, input);
    }

    #[test]
    fn rewrite_meta_name_round_trips_through_parser() {
        let input = "meta {\n  name: login\n  type: http\n  seq: 3\n}\n\npost {\n  url: https://api/login\n  body: json\n  auth: none\n}\n\nbody:json {\n{\"a\":1}\n}\n";
        let out = rewrite_bru_meta_name(input, "sign-in");
        let req = bru::parse(&out).expect("parses");
        assert_eq!(req.name, "sign-in");
        assert_eq!(req.seq, Some(3));
        assert_eq!(req.url, "https://api/login");
    }
}

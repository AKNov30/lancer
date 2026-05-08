use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::collection::bru;
use crate::collection::schema::Request;

/// Lightweight summary of a `.bru` file for sidebar listing. Heavy fields like
/// headers/body/auth are not included — those are loaded via [`read_request`]
/// when the user opens the request.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceItem {
    pub path: PathBuf,
    pub rel_path: String,
    pub name: String,
    /// Uppercase method label, e.g. `"GET"`, `"POST"`.
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
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("bru") {
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

pub fn write_request(path: &Path, req: &Request) -> Result<(), IoError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let text = bru::serialize(req);
    fs::write(path, text)?;
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

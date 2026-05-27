//! Small filesystem safety helpers shared across modules.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Monotonic counter making each temp filename unique within this process,
/// combined with the pid for cross-process uniqueness.
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `contents` to `path` **atomically**: write to a sibling temp file
/// first, then rename it over the destination. `fs::rename` is atomic on the
/// same filesystem (and replaces the destination on Windows), so a crash or
/// power loss mid-write can never leave a truncated / zero-length `.bru`/env
/// file — the reader sees either the old contents or the complete new ones.
///
/// The caller is responsible for ensuring `path`'s parent directory exists.
pub fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    // Make the temp name unique per (process, write) so two concurrent writers
    // targeting the same destination don't clobber each other's temp file
    // (which would corrupt one of the writes). pid handles cross-process,
    // the atomic counter handles same-process concurrency.
    let pid = std::process::id();
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let suffix = format!("tmp.{pid}.{n}");
    let tmp = match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => path.with_extension(format!("{ext}.{suffix}")),
        None => path.with_extension(&suffix),
    };
    fs::write(&tmp, contents)?;
    if let Err(e) = fs::rename(&tmp, path) {
        // Best-effort cleanup so a failed rename doesn't litter .tmp files.
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// True if `name` is a safe single path segment — no separators, no `..`, no
/// NUL, not empty. Used to reject frontend-supplied names (env names, selected
/// export folders) that could otherwise traverse out of the workspace via
/// `join("../../etc/passwd")`.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != ".."
        && name != "."
        && !name.contains("..")
}

/// Assert that `path` resolves to a location inside `root` (after
/// canonicalizing both so symlinks / `..` / mixed separators are resolved).
/// Returns the canonicalized path on success, or an `Err` describing the
/// confinement breach. The path's nearest existing ancestor is canonicalized
/// when the leaf doesn't exist yet (e.g. a file about to be written), so this
/// works for both existing and to-be-created paths.
///
/// Shared confinement helper for commands that take a caller-supplied path plus
/// a known workspace root. Callers that don't have a root (e.g. a native
/// save-dialog target) can't use this — see `commands::fs::save_bytes`.
pub fn assert_under_root(root: &Path, path: &Path) -> Result<std::path::PathBuf, String> {
    let root_c = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve workspace root {}: {e}", root.display()))?;

    // Canonicalize the path itself if it exists; otherwise canonicalize the
    // nearest existing ancestor and re-append the remaining components, so a
    // not-yet-created file is still confinement-checked.
    let resolved = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            let mut ancestor = path;
            let mut tail: Vec<std::ffi::OsString> = Vec::new();
            loop {
                match ancestor.canonicalize() {
                    Ok(base) => {
                        let mut full = base;
                        for comp in tail.iter().rev() {
                            full.push(comp);
                        }
                        break full;
                    }
                    Err(_) => match ancestor.parent() {
                        Some(parent) => {
                            if let Some(name) = ancestor.file_name() {
                                tail.push(name.to_os_string());
                            }
                            ancestor = parent;
                        }
                        None => return Err(format!("cannot resolve path {}", path.display())),
                    },
                }
            }
        }
    };

    if resolved.starts_with(&root_c) {
        Ok(resolved)
    } else {
        Err(format!(
            "path {} escapes the workspace root {}",
            path.display(),
            root.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_names() {
        assert!(is_safe_name("staging"));
        assert!(is_safe_name("My Env 1"));
        assert!(!is_safe_name("../secret"));
        assert!(!is_safe_name("..\\secret"));
        assert!(!is_safe_name("a/b"));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name(""));
    }

    #[test]
    fn assert_under_root_accepts_inside_and_rejects_outside() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let sub = root.join("collection");
        std::fs::create_dir_all(&sub).unwrap();

        // Existing path inside root → ok.
        assert!(assert_under_root(root, &sub).is_ok());
        // Not-yet-created file inside root → ok (ancestor resolves).
        let new_file = sub.join("new.bru");
        assert!(assert_under_root(root, &new_file).is_ok());
        // Traversal escaping the root → err.
        let escaped = sub.join("..").join("..").join("etc");
        assert!(assert_under_root(root, &escaped).is_err());
    }

    #[test]
    fn write_atomic_temp_names_are_unique() {
        // Two temp names generated back-to-back must differ (atomic counter).
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("a.bru");
        write_atomic(&target, b"first").unwrap();
        write_atomic(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        // No stray .tmp.* leftovers after successful renames.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains("tmp"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    }
}

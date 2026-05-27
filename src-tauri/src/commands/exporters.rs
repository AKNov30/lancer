//! Workspace export commands. The frontend prepares a list of relative paths
//! to include (top-level folder names, optionally `environments/`) and a
//! destination archive path; we zip up the selected files preserving the
//! original directory layout so the archive can be unzipped onto another
//! machine and opened as a Lancer workspace with no editing.
//!
//! Secret hygiene: `.bru` files can embed literal auth secrets (a Bearer
//! token, Basic password, etc.). Sharing a zip of such files would leak them,
//! so on export we redact literal secret VALUES from each `.bru`'s bytes
//! (the on-disk originals are never touched). A value that is exactly a
//! `{{var}}` reference is left intact — it points at a per-machine env/keyring
//! secret, so it carries nothing sensitive.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

/// The redaction placeholder substituted for a leaked literal secret value.
const REDACTED_PLACEHOLDER: &str = "{{REDACTED}}";

/// Secret field keys, grouped by the `auth:<mode>` block they appear in. Only
/// these values are sensitive; other auth fields (username, client_id, region,
/// urls…) are not secret and are left untouched.
fn secret_keys_for_block(block_header: &str) -> &'static [&'static str] {
    match block_header {
        "auth:bearer" => &["token"],
        "auth:basic" => &["password"],
        "auth:apikey" => &["value"],
        "auth:oauth2" => &["client_secret"],
        "auth:awsv4" => &["secret_access_key", "session_token"],
        _ => &[],
    }
}

/// True when `value` is exactly a single `{{var}}` template reference (no
/// surrounding literal text). Such values are safe to export as-is — the real
/// secret is resolved at send time from an environment / the keyring.
fn is_var_reference(value: &str) -> bool {
    let v = value.trim();
    v.starts_with("{{") && v.ends_with("}}") && v.len() > 4 && !v[2..v.len() - 2].contains("{{")
}

/// True when a `headers { … }` row key looks sensitive (Authorization, an
/// API-key header, a Cookie, etc.). Mirrors the sensitive-substring approach in
/// `history/store.rs` so secrets in plain header rows — not just `auth:<mode>`
/// blocks — are redacted on export. A leading `~` (disabled-row marker) is
/// stripped before matching.
fn is_sensitive_header_key(key: &str) -> bool {
    let lk = key
        .trim()
        .trim_start_matches('~')
        .trim()
        .to_ascii_lowercase();
    lk.contains("auth")
        || lk.contains("cookie")
        || lk.contains("token")
        || lk.contains("key")
        || lk.contains("secret")
        || lk.contains("password")
}

/// Redact literal auth-secret values inside a `.bru` document, returning the
/// rewritten text and whether anything was changed. Operates on a line basis
/// within `auth:<mode> { … }` blocks so non-auth content and formatting are
/// preserved. Values that are `{{var}}` references or already empty are left
/// alone.
fn redact_bru_secrets(input: &str) -> (String, bool) {
    let mut out = String::with_capacity(input.len());
    let mut changed = false;
    // Track which `auth:<mode>` block (if any) we're inside. The `.bru` block
    // format is `header {` … `}` with key/value lines indented inside.
    let mut current_secret_keys: &[&str] = &[];
    // Track whether we're inside a `headers { … }` block, where any row with a
    // sensitive key (Authorization, X-Api-Key, …) has its literal value redacted.
    let mut in_headers_block = false;

    let total_lines = input.lines().count();
    let ends_with_newline = input.ends_with('\n');
    // Re-add a newline for every line except a possible last line that the
    // original input left unterminated (`.lines()` strips terminators).
    let push_nl = |out: &mut String, idx: usize| {
        if idx + 1 < total_lines || ends_with_newline {
            out.push('\n');
        }
    };

    for (idx, line) in input.lines().enumerate() {
        let trimmed = line.trim();

        // Entering a block? Header line looks like `auth:bearer {` or `headers {`.
        if let Some(header) = trimmed.strip_suffix('{') {
            let header = header.trim();
            let keys = secret_keys_for_block(header);
            if !keys.is_empty() {
                current_secret_keys = keys;
                out.push_str(line);
                push_nl(&mut out, idx);
                continue;
            }
            if header == "headers" {
                in_headers_block = true;
                out.push_str(line);
                push_nl(&mut out, idx);
                continue;
            }
        }

        // Leaving the current block.
        if trimmed == "}" {
            current_secret_keys = &[];
            in_headers_block = false;
            out.push_str(line);
            push_nl(&mut out, idx);
            continue;
        }

        // Inside a `headers` block: redact sensitive header-row literals.
        // Keeps the row key (and any `~` disable marker) intact, swaps only the
        // value, and leaves `{{var}}` references untouched.
        if in_headers_block {
            if let Some((key, value)) = trimmed.split_once(':') {
                let value_t = value.trim();
                if is_sensitive_header_key(key) && !value_t.is_empty() && !is_var_reference(value_t)
                {
                    let indent = &line[..line.len() - line.trim_start().len()];
                    out.push_str(indent);
                    out.push_str(key.trim_end());
                    out.push_str(": ");
                    out.push_str(REDACTED_PLACEHOLDER);
                    push_nl(&mut out, idx);
                    changed = true;
                    continue;
                }
            }
        }

        // Inside a tracked auth block: redact secret-field literals.
        if !current_secret_keys.is_empty() {
            if let Some((key, value)) = trimmed.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                if current_secret_keys.contains(&key)
                    && !value.is_empty()
                    && !is_var_reference(value)
                {
                    // Preserve the line's leading indentation, swap the value.
                    let indent = &line[..line.len() - line.trim_start().len()];
                    out.push_str(indent);
                    out.push_str(key);
                    out.push_str(": ");
                    out.push_str(REDACTED_PLACEHOLDER);
                    push_nl(&mut out, idx);
                    changed = true;
                    continue;
                }
            }
        }

        out.push_str(line);
        push_nl(&mut out, idx);
    }

    (out, changed)
}

/// Result of a workspace zip export: how many files were written and how many
/// of them had a literal auth secret redacted on the way into the archive.
#[derive(Debug, Clone, Default, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// Total file entries written to the archive.
    pub file_count: usize,
    /// `.bru` files in which at least one literal secret value was redacted.
    pub redacted_files: usize,
}

/// Zip up the selected pieces of a workspace into a single archive.
///
/// - `workspace_root` — absolute path to the workspace folder.
/// - `selected_folders` — folder names (relative to `workspace_root`) to
///   include. Subdirectories under each are walked recursively.
/// - `include_environments` — when true, the `environments/` directory is
///   also archived (env files, no secrets — those live in the OS keyring).
/// - `dest` — absolute path for the new `.zip` file.
///
/// `.bru` files are scanned and any literal auth-secret values are redacted in
/// the archived bytes (the on-disk originals are untouched). Returns counts of
/// files written and files redacted.
#[tauri::command]
pub fn export_workspace_zip(
    workspace_root: PathBuf,
    selected_folders: Vec<String>,
    include_environments: bool,
    dest: PathBuf,
) -> Result<ExportReport, String> {
    if !workspace_root.exists() || !workspace_root.is_dir() {
        return Err(format!(
            "workspace does not exist: {}",
            workspace_root.display()
        ));
    }

    let file = fs::File::create(&dest).map_err(|e| format!("cannot create zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut count = 0usize;
    let mut redacted_files = 0usize;

    // Walk each selected top-level folder + optionally environments/.
    let mut targets: Vec<PathBuf> = Vec::new();
    for name in &selected_folders {
        // Reject traversal: a crafted name like "../../secret" must not escape
        // the workspace and get zipped up.
        if !crate::fsutil::is_safe_name(name) {
            return Err(format!("invalid folder name: {name}"));
        }
        let p = workspace_root.join(name);
        if p.exists() {
            targets.push(p);
        }
    }
    if include_environments {
        let env_dir = workspace_root.join("environments");
        if env_dir.exists() {
            targets.push(env_dir);
        }
    }

    for target in &targets {
        for entry in WalkDir::new(target).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            // Compute the zip path relative to workspace_root so the archive
            // structure mirrors the source workspace.
            let rel = match path.strip_prefix(&workspace_root) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let rel_str = rel.to_string_lossy().replace('\\', "/");

            zip.start_file(&rel_str, options)
                .map_err(|e| format!("zip write header: {e}"))?;

            let mut buf = Vec::new();
            fs::File::open(path)
                .and_then(|mut f| f.read_to_end(&mut buf))
                .map_err(|e| format!("read {}: {e}", path.display()))?;

            // Redact literal auth secrets from `.bru` files before archiving.
            // Only valid UTF-8 `.bru` content is rewritten; anything else is
            // copied verbatim. Originals on disk are never modified.
            let is_bru = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("bru"))
                .unwrap_or(false);
            if is_bru {
                if let Ok(text) = std::str::from_utf8(&buf) {
                    let (redacted, changed) = redact_bru_secrets(text);
                    if changed {
                        redacted_files += 1;
                        buf = redacted.into_bytes();
                    }
                }
            }

            zip.write_all(&buf)
                .map_err(|e| format!("zip write body: {e}"))?;
            count += 1;
        }
    }

    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(ExportReport {
        file_count: count,
        redacted_files,
    })
}

/// List the immediate sub-directories of `workspace_root` so the export
/// dialog can show a checkbox per collection. Skips `environments/` and
/// hidden dot-folders.
#[tauri::command]
pub fn list_top_level_folders(workspace_root: PathBuf) -> Result<Vec<String>, String> {
    if !workspace_root.is_dir() {
        return Err(format!("not a directory: {}", workspace_root.display()));
    }
    let mut out = Vec::new();
    let entries = fs::read_dir(&workspace_root).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') || name == "environments" || name == "node_modules" {
            continue;
        }
        out.push(name);
    }
    out.sort();
    Ok(out)
}

// Helper for callers that want to check archive size before writing.
#[allow(dead_code)]
pub(crate) fn estimate_workspace_size(root: &Path, folders: &[String]) -> u64 {
    let mut total = 0u64;
    for name in folders {
        let p = root.join(name);
        for entry in WalkDir::new(&p).into_iter().filter_map(Result::ok) {
            if entry.path().is_file() {
                if let Ok(meta) = entry.metadata() {
                    total += meta.len();
                }
            }
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_literal_bearer_token_but_keeps_var_reference() {
        let literal = "\
meta {
  name: Get user
  type: http
}

get {
  url: {{baseUrl}}/users
  body: none
  auth: bearer
}

auth:bearer {
  token: sk-live-abcdef1234567890
}
";
        let (out, changed) = redact_bru_secrets(literal);
        assert!(changed, "a literal token should be redacted");
        assert!(
            !out.contains("sk-live-abcdef1234567890"),
            "literal token leaked: {out}"
        );
        assert!(out.contains("token: {{REDACTED}}"), "got: {out}");
        // Non-secret fields and structure are preserved.
        assert!(out.contains("url: {{baseUrl}}/users"), "got: {out}");

        // A {{var}} reference is NOT a leak and must be left untouched.
        let reference = literal.replace("sk-live-abcdef1234567890", "{{token}}");
        let (out2, changed2) = redact_bru_secrets(&reference);
        assert!(!changed2, "a {{var}} reference must not be redacted");
        assert!(out2.contains("token: {{token}}"), "got: {out2}");
    }

    #[test]
    fn redacts_basic_password_apikey_oauth_aws_but_not_nonsecret_fields() {
        let bru = "\
post {
  url: {{baseUrl}}/x
  body: none
  auth: basic
}

auth:basic {
  username: alice
  password: hunter2
}

auth:apikey {
  key: X-Api-Key
  value: literal-api-key
  in: header
}

auth:oauth2 {
  grant_type: client_credentials
  access_token_url: https://auth.example.com/token
  client_id: my-client
  client_secret: literal-oauth-secret
  scope: read
  audience: api
}

auth:awsv4 {
  access_key_id: AKIAEXAMPLE
  secret_access_key: literal-aws-secret
  session_token: literal-session-token
  region: us-east-1
  service: execute-api
}
";
        let (out, changed) = redact_bru_secrets(bru);
        assert!(changed);
        // Secrets gone.
        assert!(!out.contains("hunter2"), "{out}");
        assert!(!out.contains("literal-api-key"), "{out}");
        assert!(!out.contains("literal-oauth-secret"), "{out}");
        assert!(!out.contains("literal-aws-secret"), "{out}");
        assert!(!out.contains("literal-session-token"), "{out}");
        // Non-secret fields preserved (username, key name, client_id, region…).
        assert!(out.contains("username: alice"), "{out}");
        assert!(out.contains("key: X-Api-Key"), "{out}");
        assert!(out.contains("client_id: my-client"), "{out}");
        assert!(out.contains("access_key_id: AKIAEXAMPLE"), "{out}");
        assert!(out.contains("region: us-east-1"), "{out}");
    }

    #[test]
    fn no_change_when_no_auth_block() {
        let bru = "\
get {
  url: https://example.com
  body: none
  auth: none
}
";
        let (out, changed) = redact_bru_secrets(bru);
        assert!(!changed);
        assert_eq!(out, bru);
    }

    #[test]
    fn redacts_authorization_header_row_but_keeps_var_reference() {
        let bru = "\
get {
  url: {{baseUrl}}/users
  body: none
  auth: none
}

headers {
  Accept: application/json
  Authorization: Bearer sk-live-literal-token
  X-Api-Key: literal-key-value
  ~Cookie: session=abc123
  X-Trace-Id: 12345
}
";
        let (out, changed) = redact_bru_secrets(bru);
        assert!(changed, "sensitive header rows should be redacted");
        assert!(
            !out.contains("sk-live-literal-token"),
            "auth header leaked: {out}"
        );
        assert!(!out.contains("literal-key-value"), "api key leaked: {out}");
        assert!(!out.contains("session=abc123"), "cookie leaked: {out}");
        // Disabled marker preserved on the redacted Cookie row.
        assert!(out.contains("~Cookie: {{REDACTED}}"), "got: {out}");
        assert!(out.contains("Authorization: {{REDACTED}}"), "got: {out}");
        // Non-sensitive rows untouched.
        assert!(out.contains("Accept: application/json"), "got: {out}");
        assert!(out.contains("X-Trace-Id: 12345"), "got: {out}");
    }

    #[test]
    fn keeps_pure_var_reference_in_authorization_header() {
        // A value that is exactly a `{{var}}` reference carries no literal
        // secret (resolved per-machine at send time) and must be left intact.
        let bru = "\
headers {
  Authorization: {{authHeader}}
}
";
        let (out, changed) = redact_bru_secrets(bru);
        assert!(
            !changed,
            "a pure {{var}} header value must not be redacted: {out}"
        );
        assert!(out.contains("Authorization: {{authHeader}}"), "got: {out}");
    }

    #[test]
    fn is_var_reference_detection() {
        assert!(is_var_reference("{{token}}"));
        assert!(is_var_reference("  {{ token }}  "));
        assert!(!is_var_reference("literal"));
        assert!(!is_var_reference("prefix{{token}}"));
        assert!(!is_var_reference("{{a}}{{b}}"));
        assert!(!is_var_reference("{{}}"));
    }
}

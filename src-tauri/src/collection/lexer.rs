use std::collections::HashMap;

use crate::collection::schema::KvEnabled;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum LexError {
    #[error("invalid block header: {0}")]
    InvalidBlockHeader(String),
    #[error("unterminated block: {0}")]
    UnterminatedBlock(String),
    #[error("malformed line: {0}")]
    MalformedLine(String),
}

#[derive(Debug, Default)]
pub struct Blocks {
    /// Insertion-order is not preserved; we look up by header name.
    pub map: HashMap<String, String>,
}

/// Split a `.bru` document into blocks keyed by header (e.g. `meta`, `get`,
/// `auth:bearer`, `body:json`). Body bytes inside braces may themselves contain
/// braces, so we depth-count.
pub(crate) fn split_blocks(input: &str) -> Result<Blocks, LexError> {
    let mut blocks = Blocks::default();
    let bytes = input.as_bytes();
    let mut i = 0usize;
    let len = bytes.len();

    while i < len {
        // Skip whitespace and blank lines between blocks.
        while i < len && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= len {
            break;
        }

        // Read header (non-whitespace, non-`{` run).
        let header_start = i;
        while i < len && bytes[i] != b'{' && bytes[i] != b'\n' {
            i += 1;
        }
        let header = input[header_start..i].trim().to_string();
        if header.is_empty() {
            return Err(LexError::InvalidBlockHeader(String::new()));
        }
        if i >= len || bytes[i] != b'{' {
            return Err(LexError::InvalidBlockHeader(header));
        }
        // Skip the opening `{`.
        i += 1;

        // Read body until the matching closing `}`. Brace counting is
        // string-aware: braces inside a `"…"` string literal (with `\` escapes)
        // don't change depth, so a JSON body like `{"msg":"a}b"}` isn't
        // truncated at the inner `}`.
        let body_start = i;
        let mut depth = 1usize;
        let mut in_string = false;
        let mut escaped = false;
        while i < len && depth > 0 {
            let b = bytes[i];
            if in_string {
                if escaped {
                    escaped = false;
                } else if b == b'\\' {
                    escaped = true;
                } else if b == b'"' {
                    in_string = false;
                }
            } else {
                match b {
                    b'"' => in_string = true,
                    b'{' => depth += 1,
                    b'}' => depth -= 1,
                    _ => {}
                }
            }
            if depth > 0 {
                i += 1;
            }
        }
        if depth != 0 {
            return Err(LexError::UnterminatedBlock(header));
        }
        let body_end = i;
        // Skip the closing `}`.
        i += 1;

        let body = input[body_start..body_end].trim_matches('\n').to_string();
        blocks.map.insert(header, body);
    }

    Ok(blocks)
}

/// Parse a key-value block: each non-empty line is `key: value`. Returns a
/// hashmap; insertion order isn't preserved (acceptable for unique-key blocks
/// like `meta` or `auth:bearer`). For ordered/duplicate-key situations use
/// [`parse_kv_list`] instead.
pub(crate) fn parse_kv_block(text: &str) -> Result<HashMap<String, String>, LexError> {
    let mut out = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (k, v) = line
            .split_once(':')
            .ok_or_else(|| LexError::MalformedLine(line.to_string()))?;
        out.insert(k.trim().to_string(), v.trim().to_string());
    }
    Ok(out)
}

/// Parse a key-value list (preserving order, supporting `~`-prefix to disable).
pub(crate) fn parse_kv_list(text: &str) -> Result<Vec<KvEnabled>, LexError> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (effective, enabled) = match line.strip_prefix('~') {
            Some(stripped) => (stripped.trim(), false),
            None => (line, true),
        };
        let (k, v) = effective
            .split_once(':')
            .ok_or_else(|| LexError::MalformedLine(line.to_string()))?;
        out.push(KvEnabled {
            key: k.trim().to_string(),
            value: v.trim().to_string(),
            enabled,
        });
    }
    Ok(out)
}

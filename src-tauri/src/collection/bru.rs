use std::collections::HashMap;

use crate::collection::schema::{Auth, KvEnabled, Request, RequestBody};
use crate::http::types::Method;

#[derive(Debug, thiserror::Error)]
pub enum BruError {
    #[error("missing block: {0}")]
    MissingBlock(&'static str),
    #[error("unknown method block; expected one of get/post/put/patch/delete/head/options")]
    NoMethodBlock,
    #[error("invalid block header: {0}")]
    InvalidBlockHeader(String),
    #[error("unterminated block: {0}")]
    UnterminatedBlock(String),
    #[error("malformed line: {0}")]
    MalformedLine(String),
    #[error("unknown auth kind: {0}")]
    UnknownAuth(String),
}

#[derive(Debug, Default)]
struct Blocks {
    /// Insertion-order is not preserved; we look up by header name.
    map: HashMap<String, String>,
}

/// Split a `.bru` document into blocks keyed by header (e.g. `meta`, `get`,
/// `auth:bearer`, `body:json`). Body bytes inside braces may themselves contain
/// braces, so we depth-count.
fn split_blocks(input: &str) -> Result<Blocks, BruError> {
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
            return Err(BruError::InvalidBlockHeader(String::new()));
        }
        if i >= len || bytes[i] != b'{' {
            return Err(BruError::InvalidBlockHeader(header));
        }
        // Skip the opening `{`.
        i += 1;

        // Read body until the matching closing `}`.
        let body_start = i;
        let mut depth = 1usize;
        while i < len && depth > 0 {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
            if depth > 0 {
                i += 1;
            }
        }
        if depth != 0 {
            return Err(BruError::UnterminatedBlock(header));
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
fn parse_kv_block(text: &str) -> Result<HashMap<String, String>, BruError> {
    let mut out = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let (k, v) = line
            .split_once(':')
            .ok_or_else(|| BruError::MalformedLine(line.to_string()))?;
        out.insert(k.trim().to_string(), v.trim().to_string());
    }
    Ok(out)
}

/// Parse a key-value list (preserving order, supporting `~`-prefix to disable).
fn parse_kv_list(text: &str) -> Result<Vec<KvEnabled>, BruError> {
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
            .ok_or_else(|| BruError::MalformedLine(line.to_string()))?;
        out.push(KvEnabled {
            key: k.trim().to_string(),
            value: v.trim().to_string(),
            enabled,
        });
    }
    Ok(out)
}

/// Parse a complete `.bru` document into a [`Request`].
pub fn parse(input: &str) -> Result<Request, BruError> {
    let blocks = split_blocks(input)?;

    let meta_text = blocks
        .map
        .get("meta")
        .ok_or(BruError::MissingBlock("meta"))?;
    let meta = parse_kv_block(meta_text)?;
    let name = meta.get("name").cloned().unwrap_or_default();
    let seq = meta.get("seq").and_then(|s| s.parse().ok());

    // Method block — find the first one that exists.
    const METHODS: &[(&str, Method)] = &[
        ("get", Method::Get),
        ("post", Method::Post),
        ("put", Method::Put),
        ("patch", Method::Patch),
        ("delete", Method::Delete),
        ("head", Method::Head),
        ("options", Method::Options),
    ];
    let (method_text, method) = METHODS
        .iter()
        .find_map(|(name, m)| blocks.map.get(*name).map(|t| (t.clone(), *m)))
        .ok_or(BruError::NoMethodBlock)?;
    let method_kv = parse_kv_block(&method_text)?;
    let url = method_kv.get("url").cloned().unwrap_or_default();
    let body_marker = method_kv.get("body").cloned();
    let auth_marker = method_kv.get("auth").cloned();

    let headers = blocks
        .map
        .get("headers")
        .map(|s| parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();
    let params = blocks
        .map
        .get("params:query")
        .map(|s| parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();
    let vars = blocks
        .map
        .get("vars:pre-request")
        .map(|s| parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();

    let auth = match auth_marker.as_deref() {
        None | Some("none") => Some(Auth::None),
        Some("bearer") => {
            let kv = parse_kv_block(
                blocks
                    .map
                    .get("auth:bearer")
                    .ok_or(BruError::MissingBlock("auth:bearer"))?,
            )?;
            Some(Auth::Bearer {
                token: kv.get("token").cloned().unwrap_or_default(),
            })
        }
        Some("basic") => {
            let kv = parse_kv_block(
                blocks
                    .map
                    .get("auth:basic")
                    .ok_or(BruError::MissingBlock("auth:basic"))?,
            )?;
            Some(Auth::Basic {
                username: kv.get("username").cloned().unwrap_or_default(),
                password: kv.get("password").cloned().unwrap_or_default(),
            })
        }
        Some("apikey") => {
            let kv = parse_kv_block(
                blocks
                    .map
                    .get("auth:apikey")
                    .ok_or(BruError::MissingBlock("auth:apikey"))?,
            )?;
            Some(Auth::ApiKey {
                key: kv.get("key").cloned().unwrap_or_default(),
                value: kv.get("value").cloned().unwrap_or_default(),
                location: kv.get("in").cloned().unwrap_or_else(|| "header".into()),
            })
        }
        Some(other) => return Err(BruError::UnknownAuth(other.to_string())),
    };

    let body = match body_marker.as_deref() {
        Some("json") => blocks.map.get("body:json").map(|s| RequestBody::Json {
            value: s.trim().to_string(),
        }),
        Some("text") => blocks.map.get("body:text").map(|s| RequestBody::Text {
            value: s.trim().to_string(),
            content_type: "text/plain".into(),
        }),
        Some("form-urlencoded") => blocks
            .map
            .get("body:form-urlencoded")
            .map(|s| parse_kv_list(s))
            .transpose()?
            .map(|fields| RequestBody::FormUrlencoded { fields }),
        Some("multipart-form") => blocks
            .map
            .get("body:multipart-form")
            .map(|s| parse_kv_list(s))
            .transpose()?
            .map(|fields| RequestBody::MultipartForm { fields }),
        Some("graphql") => {
            let block = blocks
                .map
                .get("body:graphql")
                .map(String::as_str)
                .unwrap_or("");
            let variables = blocks
                .map
                .get("body:graphql:vars")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            Some(RequestBody::GraphQl {
                query: block.trim().to_string(),
                variables,
            })
        }
        _ => None,
    };

    Ok(Request {
        name,
        seq,
        method,
        url,
        headers,
        params,
        body,
        auth,
        vars,
    })
}

pub fn serialize(req: &Request) -> String {
    let mut out = String::new();

    // meta block
    out.push_str("meta {\n");
    out.push_str(&format!("  name: {}\n", req.name));
    out.push_str("  type: http\n");
    if let Some(seq) = req.seq {
        out.push_str(&format!("  seq: {seq}\n"));
    }
    out.push_str("}\n\n");

    // method block — controls the body and auth markers
    let method_str = match req.method {
        Method::Get => "get",
        Method::Post => "post",
        Method::Put => "put",
        Method::Patch => "patch",
        Method::Delete => "delete",
        Method::Head => "head",
        Method::Options => "options",
    };
    out.push_str(&format!("{method_str} {{\n"));
    out.push_str(&format!("  url: {}\n", req.url));
    let body_marker = match &req.body {
        Some(RequestBody::Json { .. }) => "json",
        Some(RequestBody::Text { .. }) => "text",
        Some(RequestBody::FormUrlencoded { .. }) => "form-urlencoded",
        Some(RequestBody::MultipartForm { .. }) => "multipart-form",
        Some(RequestBody::GraphQl { .. }) => "graphql",
        None => "none",
    };
    out.push_str(&format!("  body: {body_marker}\n"));
    let auth_marker = match &req.auth {
        Some(Auth::None) | None => "none",
        Some(Auth::Bearer { .. }) => "bearer",
        Some(Auth::Basic { .. }) => "basic",
        Some(Auth::ApiKey { .. }) => "apikey",
    };
    out.push_str(&format!("  auth: {auth_marker}\n"));
    out.push_str("}\n\n");

    if !req.headers.is_empty() {
        out.push_str("headers {\n");
        write_kv_list(&mut out, &req.headers);
        out.push_str("}\n\n");
    }

    if !req.params.is_empty() {
        out.push_str("params:query {\n");
        write_kv_list(&mut out, &req.params);
        out.push_str("}\n\n");
    }

    match &req.auth {
        Some(Auth::Bearer { token }) => {
            out.push_str("auth:bearer {\n");
            out.push_str(&format!("  token: {token}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::Basic { username, password }) => {
            out.push_str("auth:basic {\n");
            out.push_str(&format!("  username: {username}\n"));
            out.push_str(&format!("  password: {password}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::ApiKey {
            key,
            value,
            location,
        }) => {
            out.push_str("auth:apikey {\n");
            out.push_str(&format!("  key: {key}\n"));
            out.push_str(&format!("  value: {value}\n"));
            out.push_str(&format!("  in: {location}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::None) | None => {}
    }

    match &req.body {
        Some(RequestBody::Json { value }) => {
            out.push_str("body:json {\n");
            out.push_str(value.trim());
            out.push_str("\n}\n\n");
        }
        Some(RequestBody::Text { value, .. }) => {
            out.push_str("body:text {\n");
            out.push_str(value.trim());
            out.push_str("\n}\n\n");
        }
        Some(RequestBody::FormUrlencoded { fields }) => {
            out.push_str("body:form-urlencoded {\n");
            write_kv_list(&mut out, fields);
            out.push_str("}\n\n");
        }
        Some(RequestBody::MultipartForm { fields }) => {
            out.push_str("body:multipart-form {\n");
            write_kv_list(&mut out, fields);
            out.push_str("}\n\n");
        }
        Some(RequestBody::GraphQl { query, variables }) => {
            out.push_str("body:graphql {\n");
            out.push_str(query.trim());
            out.push_str("\n}\n\n");
            if !variables.trim().is_empty() {
                out.push_str("body:graphql:vars {\n");
                out.push_str(variables.trim());
                out.push_str("\n}\n\n");
            }
        }
        None => {}
    }

    if !req.vars.is_empty() {
        out.push_str("vars:pre-request {\n");
        write_kv_list(&mut out, &req.vars);
        out.push_str("}\n");
    }

    out
}

fn write_kv_list(out: &mut String, list: &[KvEnabled]) {
    for kv in list {
        let prefix = if kv.enabled { "" } else { "~" };
        out.push_str(&format!("  {prefix}{}: {}\n", kv.key, kv.value));
    }
}

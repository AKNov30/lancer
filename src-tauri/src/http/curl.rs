//! cURL command parser + request → multiple-language generators.
//!
//! Parses `curl ...` strings (single-line OR multi-line with backslash
//! continuations) and converts them to `http::types::HttpRequest`.
//! Generators produce cURL, fetch (JS), axios, Python requests, and Go stubs.

use crate::http::types::{HttpRequest, Method, RequestBody};

// ─── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum CurlError {
    #[error("no URL found in curl command")]
    NoUrl,
    #[error("malformed curl: {0}")]
    Malformed(String),
}

impl serde::Serialize for CurlError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/// Tokenize a curl command. Handles single quotes, double quotes, and
/// backslash-newline continuations. Dollar-sign variable expansion is NOT
/// performed — `$VAR` is treated as a literal.
fn tokenize(input: &str) -> Vec<String> {
    // Collapse backslash-newline continuations before splitting on whitespace.
    let mut cleaned = String::with_capacity(input.len());
    for line in input.lines() {
        let trimmed = line.trim_end();
        if let Some(stripped) = trimmed.strip_suffix('\\') {
            cleaned.push_str(stripped.trim_end());
            cleaned.push(' ');
        } else {
            cleaned.push_str(trimmed);
            cleaned.push(' ');
        }
    }

    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = cleaned.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            '\'' => {
                // Single-quoted: read verbatim until the next unescaped `'`.
                loop {
                    match chars.next() {
                        None | Some('\'') => break,
                        Some(nc) => current.push(nc),
                    }
                }
            }
            '"' => {
                // Double-quoted: honour `\"` and `\\` escapes.
                loop {
                    match chars.next() {
                        None | Some('"') => break,
                        Some('\\') => {
                            if let Some(esc) = chars.next() {
                                current.push(esc);
                            }
                        }
                        Some(nc) => current.push(nc),
                    }
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

// ─── Parser ──────────────────────────────────────────────────────────────────

pub fn parse(input: &str) -> Result<HttpRequest, CurlError> {
    let tokens = tokenize(input);
    if tokens.is_empty() || tokens[0] != "curl" {
        return Err(CurlError::Malformed(
            "expected 'curl' as first token".into(),
        ));
    }

    let mut method: Option<Method> = None;
    let mut url: Option<String> = None;
    let mut headers: Vec<(String, String)> = Vec::new();
    let mut data: Option<String> = None;
    let mut form: Vec<(String, String)> = Vec::new();
    let mut basic_auth: Option<(String, String)> = None;
    let mut bearer: Option<String> = None;

    let mut i = 1usize;
    while i < tokens.len() {
        let t = &tokens[i];
        match t.as_str() {
            // ── Method ──────────────────────────────────────────────────────
            "-X" | "--request" => {
                if let Some(m) = tokens.get(i + 1) {
                    method = Some(parse_method(m)?);
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Headers ─────────────────────────────────────────────────────
            "-H" | "--header" => {
                if let Some(h) = tokens.get(i + 1) {
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push((k.trim().to_string(), v.trim().to_string()));
                    }
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Data body ───────────────────────────────────────────────────
            "-d" | "--data" | "--data-raw" | "--data-binary" => {
                if let Some(d) = tokens.get(i + 1) {
                    data = Some(d.clone());
                    if method.is_none() {
                        method = Some(Method::Post);
                    }
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Form fields ─────────────────────────────────────────────────
            "-F" | "--form" => {
                if let Some(f) = tokens.get(i + 1) {
                    if let Some((k, v)) = f.split_once('=') {
                        form.push((k.to_string(), v.to_string()));
                    }
                    if method.is_none() {
                        method = Some(Method::Post);
                    }
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Basic auth ──────────────────────────────────────────────────
            "-u" | "--user" => {
                if let Some(u) = tokens.get(i + 1) {
                    if let Some((user, pass)) = u.split_once(':') {
                        basic_auth = Some((user.to_string(), pass.to_string()));
                    }
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Bearer token ────────────────────────────────────────────────
            "--oauth2-bearer" => {
                if let Some(b) = tokens.get(i + 1) {
                    bearer = Some(b.clone());
                    i += 2;
                    continue;
                }
                i += 1;
            }
            // ── Flags that consume a value but we skip ───────────────────────
            "-A" | "--user-agent" | "-e" | "--referer" | "--max-time" | "-m"
            | "--connect-timeout" | "--retry" | "--limit-rate" | "-x" | "--proxy" | "--cacert"
            | "--cert" | "--key" | "-b" | "--cookie" | "-c" | "--cookie-jar" | "--output"
            | "-o" | "--range" | "-r" | "--upload-file" | "-T" | "--url" => {
                // Consume the flag + its value argument.
                i += 2;
                continue;
            }
            // ── Boolean flags (no value) ─────────────────────────────────────
            "-k" | "--insecure" | "-L" | "--location" | "-s" | "--silent" | "-v" | "--verbose"
            | "--compressed" | "-i" | "--include" | "-O" | "--remote-name" | "-g" | "--globoff"
            | "-n" | "--netrc" | "--netrc-optional" | "--http1.1" | "--http2" | "--ipv4"
            | "--ipv6" => {
                i += 1;
                continue;
            }
            // ── Unknown flags (best-effort skip) ─────────────────────────────
            arg if arg.starts_with("--") => {
                // If the next token looks like another flag or nothing, don't consume it.
                let next_is_flag = tokens
                    .get(i + 1)
                    .map(|n| n.starts_with('-'))
                    .unwrap_or(true);
                if next_is_flag {
                    i += 1;
                } else {
                    i += 2;
                }
                continue;
            }
            arg if arg.starts_with('-') && arg.len() > 1 => {
                // Short flag cluster — skip without consuming a value.
                i += 1;
                continue;
            }
            // ── Positional: URL ──────────────────────────────────────────────
            _ => {
                if url.is_none() {
                    url = Some(t.clone());
                }
                i += 1;
            }
        }
    }

    let url = url.ok_or(CurlError::NoUrl)?;
    let method = method.unwrap_or(Method::Get);

    // Build body — form takes precedence over -d data.
    let body = if !form.is_empty() {
        Some(RequestBody::Form { fields: form })
    } else if let Some(d) = data {
        // Heuristic: if the data parses as JSON, represent it as Json body.
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&d) {
            Some(RequestBody::Json { value: v })
        } else {
            Some(RequestBody::Text {
                value: d,
                content_type: "text/plain".into(),
            })
        }
    } else {
        None
    };

    // Convert auth flags to Authorization headers.
    if let Some((user, pass)) = basic_auth {
        use base64::Engine as _;
        let raw = format!("{user}:{pass}");
        let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
        headers.push(("Authorization".into(), format!("Basic {b64}")));
    }
    if let Some(token) = bearer {
        headers.push(("Authorization".into(), format!("Bearer {token}")));
    }

    Ok(HttpRequest {
        url,
        method,
        headers,
        query: vec![],
        body,
    })
}

fn parse_method(s: &str) -> Result<Method, CurlError> {
    match s.to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::Get),
        "POST" => Ok(Method::Post),
        "PUT" => Ok(Method::Put),
        "PATCH" => Ok(Method::Patch),
        "DELETE" => Ok(Method::Delete),
        "HEAD" => Ok(Method::Head),
        "OPTIONS" => Ok(Method::Options),
        other => Err(CurlError::Malformed(format!("unknown method: {other}"))),
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn method_str(m: Method) -> &'static str {
    match m {
        Method::Get => "GET",
        Method::Post => "POST",
        Method::Put => "PUT",
        Method::Patch => "PATCH",
        Method::Delete => "DELETE",
        Method::Head => "HEAD",
        Method::Options => "OPTIONS",
    }
}

/// Escape single-quotes for use inside single-quoted shell arguments.
fn sh_escape_sq(s: &str) -> String {
    s.replace('\'', "'\\''")
}

// ─── Generators ──────────────────────────────────────────────────────────────

pub fn to_curl(req: &HttpRequest) -> String {
    let mut out = format!("curl -X {} '{}'", method_str(req.method), req.url);

    for (k, v) in &req.headers {
        out.push_str(&format!(
            " \\\n  -H '{}: {}'",
            sh_escape_sq(k),
            sh_escape_sq(v)
        ));
    }

    if !req.query.is_empty() {
        out.push_str(" \\\n  -G");
        for (k, v) in &req.query {
            out.push_str(&format!(
                " \\\n  --data-urlencode '{}={}'",
                sh_escape_sq(k),
                sh_escape_sq(v)
            ));
        }
    }

    match &req.body {
        Some(RequestBody::Json { value }) => {
            let s = serde_json::to_string(value).unwrap_or_default();
            out.push_str(&format!(
                " \\\n  -H 'content-type: application/json' \\\n  -d '{}'",
                sh_escape_sq(&s)
            ));
        }
        Some(RequestBody::Text {
            value,
            content_type,
        }) => {
            out.push_str(&format!(
                " \\\n  -H 'content-type: {}' \\\n  -d '{}'",
                sh_escape_sq(content_type),
                sh_escape_sq(value)
            ));
        }
        Some(RequestBody::Form { fields }) => {
            for (k, v) in fields {
                out.push_str(&format!(
                    " \\\n  -F '{}={}'",
                    sh_escape_sq(k),
                    sh_escape_sq(v)
                ));
            }
        }
        Some(RequestBody::Binary { path, content_type }) => {
            out.push_str(&format!(
                " \\\n  -H 'content-type: {}' \\\n  --data-binary @{}",
                sh_escape_sq(content_type),
                path.display()
            ));
        }
        Some(RequestBody::None) | None => {}
    }

    out
}

pub fn to_fetch(req: &HttpRequest) -> String {
    let mut header_entries: Vec<String> = req
        .headers
        .iter()
        .map(|(k, v)| {
            format!(
                "    {}: {}",
                serde_json::to_string(k).unwrap_or_default(),
                serde_json::to_string(v).unwrap_or_default()
            )
        })
        .collect();

    let body_line = match &req.body {
        Some(RequestBody::Json { value }) => {
            header_entries.push("    \"content-type\": \"application/json\"".into());
            Some(format!(
                "  body: JSON.stringify({}),",
                serde_json::to_string(value).unwrap_or_default()
            ))
        }
        Some(RequestBody::Text {
            value,
            content_type,
        }) => {
            header_entries.push(format!(
                "    \"content-type\": {}",
                serde_json::to_string(content_type).unwrap_or_default()
            ));
            Some(format!(
                "  body: {},",
                serde_json::to_string(value).unwrap_or_default()
            ))
        }
        Some(RequestBody::Form { fields }) => {
            let params: Vec<String> = fields
                .iter()
                .map(|(k, v)| {
                    format!(
                        "  fd.append({}, {});",
                        serde_json::to_string(k).unwrap_or_default(),
                        serde_json::to_string(v).unwrap_or_default()
                    )
                })
                .collect();
            // We emit FormData usage as a comment block then use fd as body.
            let fd_setup = params.join("\n");
            return format!(
                "const fd = new FormData();\n{fd_setup}\n\nawait fetch({}, {{\n  method: {},\n  body: fd,\n}});",
                serde_json::to_string(&req.url).unwrap_or_default(),
                serde_json::to_string(method_str(req.method)).unwrap_or_default()
            );
        }
        _ => None,
    };

    let headers_block = if header_entries.is_empty() {
        "{}".to_string()
    } else {
        format!("{{\n{}\n  }}", header_entries.join(",\n"))
    };

    let mut out = format!(
        "await fetch({}, {{\n  method: {},\n  headers: {},",
        serde_json::to_string(&req.url).unwrap_or_default(),
        serde_json::to_string(method_str(req.method)).unwrap_or_default(),
        headers_block
    );
    if let Some(b) = body_line {
        out.push('\n');
        out.push_str(&b);
    }
    out.push_str("\n});");
    out
}

pub fn to_axios(req: &HttpRequest) -> String {
    let headers_map: std::collections::HashMap<&str, &str> = req
        .headers
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let headers_json = serde_json::to_string(&headers_map).unwrap_or_else(|_| "{}".into());

    let data_expr = match &req.body {
        Some(RequestBody::Json { value }) => serde_json::to_string(value).unwrap_or_default(),
        Some(RequestBody::Text { value, .. }) => serde_json::to_string(value).unwrap_or_default(),
        Some(RequestBody::Form { fields }) => {
            let entries: Vec<String> = fields
                .iter()
                .map(|(k, v)| {
                    format!(
                        "{}: {}",
                        serde_json::to_string(k).unwrap_or_default(),
                        serde_json::to_string(v).unwrap_or_default()
                    )
                })
                .collect();
            format!("{{ {} }}", entries.join(", "))
        }
        _ => "undefined".to_string(),
    };

    format!(
        "await axios({{\n  method: {},\n  url: {},\n  headers: {},\n  data: {},\n}});",
        serde_json::to_string(method_str(req.method).to_lowercase().as_str()).unwrap_or_default(),
        serde_json::to_string(&req.url).unwrap_or_default(),
        headers_json,
        data_expr
    )
}

pub fn to_python(req: &HttpRequest) -> String {
    let mut out = String::from("import requests\n\n");

    let method_lower = method_str(req.method).to_lowercase();
    out.push_str(&format!(
        "resp = requests.{}(\n    {},",
        method_lower,
        serde_json::to_string(&req.url).unwrap_or_default()
    ));

    if !req.headers.is_empty() {
        let pairs: Vec<String> = req
            .headers
            .iter()
            .map(|(k, v)| {
                format!(
                    "        {}: {}",
                    serde_json::to_string(k).unwrap_or_default(),
                    serde_json::to_string(v).unwrap_or_default()
                )
            })
            .collect();
        out.push_str(&format!("\n    headers={{\n{}\n    }},", pairs.join(",\n")));
    }

    match &req.body {
        Some(RequestBody::Json { value }) => {
            out.push_str(&format!(
                "\n    json={},",
                serde_json::to_string(value).unwrap_or_default()
            ));
        }
        Some(RequestBody::Text { value, .. }) => {
            out.push_str(&format!(
                "\n    data={},",
                serde_json::to_string(value).unwrap_or_default()
            ));
        }
        Some(RequestBody::Form { fields }) => {
            let pairs: Vec<String> = fields
                .iter()
                .map(|(k, v)| {
                    format!(
                        "        {}: {}",
                        serde_json::to_string(k).unwrap_or_default(),
                        serde_json::to_string(v).unwrap_or_default()
                    )
                })
                .collect();
            out.push_str(&format!("\n    data={{\n{}\n    }},", pairs.join(",\n")));
        }
        Some(RequestBody::Binary { path, .. }) => {
            out.push_str(&format!(
                "\n    data=open({}, 'rb'),",
                serde_json::to_string(&path.to_string_lossy()).unwrap_or_default()
            ));
        }
        Some(RequestBody::None) | None => {}
    }

    out.push_str("\n)\nprint(resp.status_code, resp.text)");
    out
}

pub fn to_go(req: &HttpRequest) -> String {
    let method = method_str(req.method);
    let url = &req.url;

    let body_setup = match &req.body {
        Some(RequestBody::Json { value }) => {
            let json_str = serde_json::to_string(value).unwrap_or_default();
            format!(
                "\tbody, _ := json.Marshal({})\n\tbody_reader := bytes.NewReader(body)\n",
                json_str
            )
        }
        Some(RequestBody::Text { value, .. }) => {
            format!("\tbody_reader := strings.NewReader({:?})\n", value)
        }
        _ => "\tvar body_reader io.Reader\n".to_string(),
    };

    let has_json_body = matches!(req.body, Some(RequestBody::Json { .. }));
    let has_text_body = matches!(req.body, Some(RequestBody::Text { .. }));

    let mut imports = vec!["\"fmt\"", "\"io\"", "\"net/http\""];
    if has_json_body {
        imports.push("\"bytes\"");
        imports.push("\"encoding/json\"");
    }
    if has_text_body {
        imports.push("\"strings\"");
    }
    let imports_str = imports.join("\n\t");

    let header_lines: Vec<String> = req
        .headers
        .iter()
        .map(|(k, v)| format!("\treq.Header.Set({:?}, {:?})", k, v))
        .collect();
    let headers_block = if header_lines.is_empty() {
        String::new()
    } else {
        format!("\n{}", header_lines.join("\n"))
    };

    format!(
        "package main\n\nimport (\n\t{imports_str}\n)\n\nfunc main() {{\n{body_setup}\treq, _ := http.NewRequest({method:?}, {url:?}, body_reader){headers_block}\n\tresp, _ := http.DefaultClient.Do(req)\n\tdefer resp.Body.Close()\n\tb, _ := io.ReadAll(resp.Body)\n\tfmt.Println(resp.StatusCode, string(b))\n}}"
    )
}

use crate::collection::schema::{Auth, KvEnabled, Request, RequestBody};
use crate::http::types::Method;
use crate::importers::postman::auth::convert_auth;
use crate::importers::postman::schema::{ItemOrFolder, PostmanRequest};

/// Convert a Postman request item into a Lancer [`Request`].
///
/// `name` is passed separately because it lives on the parent `ItemOrFolder`.
/// `warnings` accumulates non-fatal issues (e.g. unsupported auth types).
pub fn convert_request(
    name: &str,
    seq: u32,
    pm: &PostmanRequest,
    pre_request_script: Option<String>,
    post_response_script: Option<String>,
    warnings: &mut Vec<String>,
) -> Request {
    let method = parse_method(&pm.method);

    // URL — use raw string; strip query params already encoded there because
    // we extract them separately from the structured `query` array.
    let url = pm.url.raw().to_string();

    // Headers
    let headers: Vec<KvEnabled> = pm
        .header
        .iter()
        .map(|h| KvEnabled {
            key: h.key.clone(),
            value: h.value.clone(),
            enabled: !h.disabled,
        })
        .collect();

    // Query params from structured object (may duplicate what's in raw URL,
    // but we preserve them as the authoritative editable list).
    let params: Vec<KvEnabled> = pm
        .url
        .query_params()
        .iter()
        .map(|q| KvEnabled {
            key: q.key.clone(),
            value: q.value.clone().unwrap_or_default(),
            enabled: !q.disabled,
        })
        .collect();

    // Body
    let body = pm.body.as_ref().and_then(|b| convert_body(b, warnings));

    // Auth
    let auth = match &pm.auth {
        Some(pm_auth) => match convert_auth(pm_auth) {
            Some(a) => Some(a),
            None => {
                warnings.push(format!(
                    "request '{}': unsupported auth type '{}' — skipped",
                    name, pm_auth.kind
                ));
                Some(Auth::None)
            }
        },
        None => Some(Auth::None),
    };

    Request {
        name: name.to_string(),
        seq: Some(seq),
        method,
        url,
        headers,
        params,
        body,
        auth,
        vars: vec![],
        pre_request_script,
        post_response_script,
    }
}

fn parse_method(s: &str) -> Method {
    match s.to_ascii_uppercase().as_str() {
        "GET" => Method::Get,
        "POST" => Method::Post,
        "PUT" => Method::Put,
        "PATCH" => Method::Patch,
        "DELETE" => Method::Delete,
        "HEAD" => Method::Head,
        "OPTIONS" => Method::Options,
        _ => Method::Get, // fallback
    }
}

fn convert_body(
    b: &crate::importers::postman::schema::PostmanBody,
    warnings: &mut Vec<String>,
) -> Option<RequestBody> {
    match b.mode.as_str() {
        "raw" => {
            let value = b.raw.clone().unwrap_or_default();
            // Detect JSON by language hint or content heuristic
            let language = b
                .options
                .as_ref()
                .and_then(|o| o.raw.as_ref())
                .and_then(|r| r.language.as_deref())
                .unwrap_or("");
            let is_json = language == "json"
                || value.trim_start().starts_with('{')
                || value.trim_start().starts_with('[');
            if is_json {
                Some(RequestBody::Json { value })
            } else {
                Some(RequestBody::Text {
                    value,
                    content_type: "text/plain".into(),
                })
            }
        }
        "urlencoded" => {
            let fields = b
                .urlencoded
                .iter()
                .map(|f| KvEnabled {
                    key: f.key.clone(),
                    value: f.value.clone().unwrap_or_default(),
                    enabled: !f.disabled,
                })
                .collect();
            Some(RequestBody::FormUrlencoded { fields })
        }
        "formdata" => {
            let fields = b
                .formdata
                .iter()
                .map(|f| KvEnabled {
                    key: f.key.clone(),
                    value: f.value.clone().unwrap_or_default(),
                    enabled: !f.disabled,
                })
                .collect();
            Some(RequestBody::MultipartForm { fields })
        }
        "graphql" => {
            if let Some(gql) = &b.graphql {
                let query = gql
                    .get("query")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let variables = gql
                    .get("variables")
                    .map(|v| {
                        if v.is_string() {
                            v.as_str().unwrap_or("").to_string()
                        } else {
                            serde_json::to_string_pretty(v).unwrap_or_default()
                        }
                    })
                    .unwrap_or_default();
                Some(RequestBody::GraphQl { query, variables })
            } else {
                None
            }
        }
        "file" | "binary" => {
            warnings.push(format!("body mode '{}' is not supported — skipped", b.mode));
            None
        }
        _ => None,
    }
}

/// Extract pre-request and test script bodies from an event list.
pub fn extract_scripts(
    events: &[crate::importers::postman::schema::Event],
) -> (Option<String>, Option<String>) {
    let mut pre: Option<String> = None;
    let mut post: Option<String> = None;

    for ev in events {
        if let Some(script) = &ev.script {
            if script.exec.is_empty() {
                continue;
            }
            let body = script.exec.join("\n");
            if body.trim().is_empty() {
                continue;
            }
            match ev.listen.as_str() {
                "prerequest" => pre = Some(body),
                "test" => post = Some(body),
                _ => {}
            }
        }
    }

    (pre, post)
}

/// Recursively walk a folder tree, collecting `(folder_path, ItemOrFolder)`
/// pairs for every *leaf* node — i.e. anything that is not a folder.
///
/// A node is treated as a FOLDER (recursed into) only when it has child
/// `item`s. Everything else is a leaf and is emitted, including malformed
/// nodes that carry neither a `request` nor any children. Surfacing those
/// leaves lets the caller emit a "skipped …" warning instead of silently
/// losing them (which is what happened when an empty node was mistaken for a
/// folder and recursion produced nothing).
///
/// Recursion is unbounded in depth, so deeply nested folders are walked in
/// full.
pub fn walk_items<'a>(
    items: &'a [ItemOrFolder],
    folder_path: &str,
    out: &mut Vec<(String, &'a ItemOrFolder)>,
) {
    for item in items {
        // A folder is any node that has children. A node with children is
        // never also a request in valid Postman, but if both are present we
        // still recurse AND emit the request below, losing nothing.
        let is_folder = !item.item.is_empty();

        if item.request.is_some() || !is_folder {
            // Leaf: a request, OR a childless node (possibly malformed —
            // the caller will warn about a missing request).
            out.push((folder_path.to_string(), item));
        }

        if is_folder {
            let child_path = if folder_path.is_empty() {
                item.name.clone()
            } else {
                format!("{}/{}", folder_path, item.name)
            };
            walk_items(&item.item, &child_path, out);
        }
    }
}

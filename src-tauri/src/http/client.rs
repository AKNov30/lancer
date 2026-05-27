use crate::http::types::{HttpRequest, HttpResponse, Method, RequestBody, RequestOptions};
use reqwest_cookie_store::CookieStoreMutex;
use std::io::Read as _;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

/// Upper bound on a binary request body we read into memory before sending.
/// Prevents a 4 GB file from OOM-ing the process. 100 MiB is generous for an
/// API client.
const MAX_BINARY_BODY_BYTES: u64 = 100 * 1024 * 1024;
/// Upper bound on a buffered HTTP response body. A multi-GB streaming download
/// would otherwise allocate without limit. Body is capped at this size.
const MAX_RESPONSE_BYTES: usize = 100 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid header value: {0}")]
    InvalidHeader(String),
    #[error("binary body io error: {0}")]
    BinaryIo(String),
    #[error("client build error: {0}")]
    ClientBuild(String),
}

impl serde::Serialize for HttpError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Returns true if any field on the options struct is set to a non-default
/// value that requires a fresh per-request `reqwest::Client` (because the
/// option can't be applied at the RequestBuilder level — e.g. redirect
/// policy and TLS verification are Client-level in reqwest).
fn needs_custom_client(opts: &RequestOptions) -> bool {
    opts.follow_redirects.is_some()
        || opts.max_redirects.is_some()
        || opts.insecure_skip_verify.is_some()
}

fn build_custom_client(
    opts: &RequestOptions,
    cookie_jar: &Arc<CookieStoreMutex>,
) -> Result<reqwest::Client, HttpError> {
    let mut b = reqwest::Client::builder();
    // Share the SAME inspectable cookie jar as the default client so cookies
    // set/sent through an insecure-TLS or redirect-override request stay
    // consistent with the rest of the app (and show up in the Cookie manager).
    b = b.cookie_provider(Arc::clone(cookie_jar));
    if let Some(false) = opts.follow_redirects {
        b = b.redirect(reqwest::redirect::Policy::none());
    } else if let Some(max) = opts.max_redirects {
        b = b.redirect(reqwest::redirect::Policy::limited(max as usize));
    } else {
        // explicit follow=true with no max → use library default
        b = b.redirect(reqwest::redirect::Policy::limited(10));
    }
    if let Some(true) = opts.insecure_skip_verify {
        b = b.danger_accept_invalid_certs(true);
    }
    b.build().map_err(|e| HttpError::ClientBuild(e.to_string()))
}

pub async fn send(
    client: &reqwest::Client,
    cookie_jar: &Arc<CookieStoreMutex>,
    req: HttpRequest,
) -> Result<HttpResponse, HttpError> {
    let method = match req.method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
        Method::Put => reqwest::Method::PUT,
        Method::Patch => reqwest::Method::PATCH,
        Method::Delete => reqwest::Method::DELETE,
        Method::Head => reqwest::Method::HEAD,
        Method::Options => reqwest::Method::OPTIONS,
    };

    // Per-request overrides: most options apply via RequestBuilder, but
    // redirect policy and TLS verification are Client-level — build a
    // fresh client for those requests. Falls through to the shared `client`
    // when no Client-level options are set (fast path).
    let owned_client;
    let active_client: &reqwest::Client = match &req.options {
        Some(opts) if needs_custom_client(opts) => {
            owned_client = build_custom_client(opts, cookie_jar)?;
            &owned_client
        }
        _ => client,
    };

    let mut builder = active_client.request(method, &req.url);

    // Timeout is RequestBuilder-level — apply here regardless of which client.
    if let Some(opts) = &req.options {
        if let Some(ms) = opts.timeout_ms {
            builder = builder.timeout(Duration::from_millis(ms));
        }
    }

    // Track headers the user explicitly set so we don't override their
    // Content-Type via body-derived defaults. This matters when the user
    // disables an auto-added Content-Type in the Headers tab and expects
    // the row's absence (or override) to win over body type.
    let user_set_headers: std::collections::HashSet<String> = req
        .headers
        .iter()
        .map(|(k, _)| k.to_ascii_lowercase())
        .collect();
    let user_set_content_type = user_set_headers.contains("content-type");

    for (k, v) in &req.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    if !req.query.is_empty() {
        builder = builder.query(&req.query);
    }

    builder = match req.body {
        Some(RequestBody::Json { value }) => {
            // `reqwest::RequestBuilder::json` always sets Content-Type;
            // if the user explicitly set it in Headers, write the body
            // manually so their header wins.
            if user_set_content_type {
                let bytes = serde_json::to_vec(&value)
                    .map_err(|e| HttpError::BinaryIo(format!("json serialize: {e}")))?;
                builder.body(bytes)
            } else {
                builder.json(&value)
            }
        }
        Some(RequestBody::Text {
            value,
            content_type,
        }) => {
            if user_set_content_type {
                builder.body(value)
            } else {
                builder
                    .header("content-type", content_type.as_str())
                    .body(value)
            }
        }
        Some(RequestBody::Form { fields }) => {
            // `.form()` sets Content-Type — same override rule.
            if user_set_content_type {
                let encoded = serde_urlencoded::to_string(&fields)
                    .map_err(|e| HttpError::BinaryIo(format!("form encode: {e}")))?;
                builder.body(encoded)
            } else {
                builder.form(&fields)
            }
        }
        Some(RequestBody::Binary { path, content_type }) => {
            let meta = std::fs::metadata(&path).map_err(|e| HttpError::BinaryIo(e.to_string()))?;
            if meta.len() > MAX_BINARY_BODY_BYTES {
                return Err(HttpError::BinaryIo(format!(
                    "binary body too large: {} bytes (max {} MiB)",
                    meta.len(),
                    MAX_BINARY_BODY_BYTES / (1024 * 1024)
                )));
            }
            let mut file =
                std::fs::File::open(&path).map_err(|e| HttpError::BinaryIo(e.to_string()))?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| HttpError::BinaryIo(e.to_string()))?;
            if user_set_content_type {
                builder.body(bytes)
            } else {
                builder
                    .header("content-type", content_type.as_str())
                    .body(bytes)
            }
        }
        Some(RequestBody::None) | None => builder,
    };

    let start = Instant::now();
    let mut resp = builder.send().await?;
    // After `.send().await` returns, reqwest has received the response head
    // (DNS + TCP + TLS handshake + initial server response). Capture this as
    // a TTFB approximation — accurate to within the time it takes to read
    // the headers map below.
    let ttfb_ms = start.elapsed().as_millis();
    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        // `to_str()` blanks any header value with non-ASCII bytes (e.g. a
        // Latin-1 `Content-Disposition` filename). Decode lossily instead so
        // the value is preserved (with U+FFFD for truly invalid bytes) rather
        // than silently dropped.
        .map(|(k, v)| {
            (
                k.to_string(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();
    // Stream the body with a hard cap instead of buffering unboundedly — a
    // multi-GB response must not OOM the process. Body is truncated at the cap.
    let mut body_bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if body_bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            let remaining = MAX_RESPONSE_BYTES.saturating_sub(body_bytes.len());
            body_bytes.extend_from_slice(&chunk[..remaining]);
            break;
        }
        body_bytes.extend_from_slice(&chunk);
    }
    let elapsed_ms = start.elapsed().as_millis();
    let download_ms = elapsed_ms.saturating_sub(ttfb_ms);
    let size_bytes = body_bytes.len();
    let body_text = std::str::from_utf8(&body_bytes).ok().map(String::from);

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body: body_bytes,
        body_text,
        elapsed_ms,
        size_bytes,
        ttfb_ms,
        download_ms,
        // Script results are filled in by the `send_request` command after the
        // post-response script runs; the raw client never executes scripts.
        tests: Vec::new(),
        script_logs: Vec::new(),
        script_error: None,
    })
}

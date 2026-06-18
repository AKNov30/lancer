use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

/// Per-request HTTP-level overrides. All fields optional → use server default.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequestOptions {
    /// Per-request timeout in milliseconds. None → default (30s).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    /// Whether to follow HTTP redirects automatically. None → default true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_redirects: Option<bool>,
    /// Max redirects to follow. None → default 10.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_redirects: Option<u32>,
    /// Skip TLS certificate verification (DANGEROUS — opt-in per request).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub insecure_skip_verify: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub url: String,
    pub method: Method,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub query: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<RequestBody>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<RequestOptions>,
}

impl HttpRequest {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            method: Method::Get,
            headers: Vec::new(),
            query: Vec::new(),
            body: None,
            options: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestBody {
    Json {
        value: serde_json::Value,
    },
    Text {
        value: String,
        #[serde(rename = "contentType")]
        content_type: String,
    },
    Form {
        fields: Vec<(String, String)>,
    },
    /// A `multipart/form-data` body. Each part is either an inline text field
    /// or a file read from disk. reqwest assembles the boundary itself, so the
    /// client must NOT set a `Content-Type` header manually for this body.
    Multipart {
        parts: Vec<MultipartPart>,
    },
    Binary {
        path: std::path::PathBuf,
        #[serde(rename = "contentType")]
        content_type: String,
    },
    None,
}

/// One field of a `multipart/form-data` body. Mirrors the frontend
/// `MultipartField` wire shape (camelCase, internally tagged on `kind`):
/// a `text` part carries an inline `value`; a `file` part carries a `path`
/// to read from disk and an optional `contentType` override.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MultipartPart {
    Text {
        name: String,
        value: String,
    },
    File {
        name: String,
        path: std::path::PathBuf,
        /// Optional MIME override. When empty/absent the client sniffs from
        /// the file extension, falling back to `application/octet-stream`.
        #[serde(default, rename = "contentType")]
        content_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub body_text: Option<String>,
    pub elapsed_ms: u128,
    pub size_bytes: usize,
    /// Time until headers were received — covers DNS + connect + TLS + first
    /// server response. Approximates "Time to First Byte" since reqwest's
    /// `.send()` returns after the response head arrives but before the body.
    #[serde(default)]
    pub ttfb_ms: u128,
    /// Time spent downloading the response body, after headers landed.
    #[serde(default)]
    pub download_ms: u128,
    /// Assertion results from the post-response script's `lancer.test(...)`
    /// blocks. Empty when no post-response script ran (or it had no tests).
    #[serde(default)]
    pub tests: Vec<crate::scripting::TestResult>,
    /// `console.log` / `lancer.log` output from pre- and post-response scripts,
    /// concatenated in run order. Empty when no scripts logged anything.
    #[serde(default)]
    pub script_logs: Vec<String>,
    /// A hard error from either script (syntax error, uncaught exception). The
    /// HTTP request itself still succeeded; this surfaces script problems
    /// without failing the whole send.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_error: Option<String>,
}

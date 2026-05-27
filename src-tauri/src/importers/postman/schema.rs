/// Postman Collection v2.1 subset types used for deserialization.
/// Fields not needed by the importer are ignored via `#[serde(default)]`.
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Top-level collection ───────────────────────────────────────────────────
//
// Schema is deliberately PERMISSIVE — Postman exports vary across versions
// (v2.0 vs v2.1) and tools (Postman desktop, Postman API, Newman, third-party
// generators). Every field has `#[serde(default)]` so a stripped-down or
// non-standard collection still imports rather than erroring out at parse
// time. The walk step downstream just skips obviously incomplete items.

#[derive(Debug, Deserialize, Default)]
pub struct PostmanCollection {
    #[serde(default)]
    pub info: CollectionInfo,
    #[serde(default)]
    pub item: Vec<ItemOrFolder>,
    #[serde(default)]
    pub event: Vec<Event>,
}

#[derive(Debug, Deserialize, Default)]
pub struct CollectionInfo {
    #[serde(default)]
    pub name: String,
    /// Schema URL, e.g. `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`
    #[serde(default)]
    pub schema: String,
}

// ─── Items / folders ────────────────────────────────────────────────────────

/// A node in the collection tree. Folders have `item`; requests have `request`.
#[derive(Debug, Deserialize)]
pub struct ItemOrFolder {
    #[serde(default = "default_item_name")]
    pub name: String,
    /// Present for requests, absent for folders.
    ///
    /// Postman v2.1 allows `request` to be EITHER a full request object OR a
    /// bare URL string (shorthand, e.g. `"request": "https://api/x"`). We
    /// accept both via [`RequestOrUrl`]; a bare string becomes a GET to that
    /// URL. We keep this `Option<RequestOrUrl>` so absent/folders deserialize
    /// to `None` rather than erroring the whole parse.
    #[serde(default)]
    pub request: Option<RequestOrUrl>,
    /// Present for folders/collection roots.
    #[serde(default)]
    pub item: Vec<ItemOrFolder>,
    /// Scripts attached to this item.
    #[serde(default)]
    pub event: Vec<Event>,
}

impl ItemOrFolder {
    /// Resolve the (possibly shorthand) request into a full [`PostmanRequest`].
    /// Returns `None` for folders (no `request` field at all).
    pub fn resolved_request(&self) -> Option<PostmanRequest> {
        self.request.as_ref().map(RequestOrUrl::to_request)
    }
}

/// Postman's `item.request` is either a full object or a bare URL string.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum RequestOrUrl {
    /// Full request object (the common form). Boxed because it is far larger
    /// than the `Url` variant — keeps the enum small (clippy::large_enum_variant).
    Full(Box<PostmanRequest>),
    /// Bare URL shorthand: `"request": "https://api.example.com/x"`.
    Url(String),
}

impl RequestOrUrl {
    /// Normalise to a full [`PostmanRequest`]. The bare-string shorthand
    /// becomes a `GET` to that URL with no headers/body/auth.
    pub fn to_request(&self) -> PostmanRequest {
        match self {
            RequestOrUrl::Full(r) => (**r).clone(),
            RequestOrUrl::Url(u) => PostmanRequest {
                method: default_method(),
                url: PostmanUrl::String(u.clone()),
                header: Vec::new(),
                body: None,
                auth: None,
                description: None,
            },
        }
    }
}

fn default_item_name() -> String {
    "Untitled".to_string()
}

// ─── Request ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanRequest {
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: PostmanUrl,
    #[serde(default)]
    pub header: Vec<PostmanHeader>,
    #[serde(default)]
    pub body: Option<PostmanBody>,
    #[serde(default)]
    pub auth: Option<PostmanAuth>,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

/// URL can be a plain string or an object with `raw` + `query` etc.
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum PostmanUrl {
    String(String),
    Object(PostmanUrlObject),
}

impl Default for PostmanUrl {
    fn default() -> Self {
        PostmanUrl::String(String::new())
    }
}

impl PostmanUrl {
    pub fn raw(&self) -> &str {
        match self {
            PostmanUrl::String(s) => s.as_str(),
            PostmanUrl::Object(o) => o.raw.as_deref().unwrap_or(""),
        }
    }

    pub fn query_params(&self) -> &[QueryParam] {
        match self {
            PostmanUrl::String(_) => &[],
            PostmanUrl::Object(o) => &o.query,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanUrlObject {
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub query: Vec<QueryParam>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct QueryParam {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanHeader {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

// ─── Body ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanBody {
    /// "raw", "urlencoded", "formdata", "graphql", "file", "binary"
    #[serde(default)]
    pub mode: String,
    /// Used when mode == "raw"
    #[serde(default)]
    pub raw: Option<String>,
    /// Used when mode == "urlencoded"
    #[serde(default)]
    pub urlencoded: Vec<FormField>,
    /// Used when mode == "formdata"
    #[serde(default)]
    pub formdata: Vec<FormField>,
    /// Used when mode == "graphql"
    #[serde(default)]
    pub graphql: Option<Value>,
    /// Language hint stored in options.raw.language
    #[serde(default)]
    pub options: Option<BodyOptions>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FormField {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: bool,
    /// "text" or "file"
    #[serde(rename = "type", default)]
    pub field_type: String,
    #[serde(default)]
    pub src: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BodyOptions {
    #[serde(default)]
    pub raw: Option<RawOptions>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RawOptions {
    #[serde(default)]
    pub language: Option<String>,
}

// ─── Auth ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct PostmanAuth {
    /// "noauth", "bearer", "basic", "apikey", "oauth2", "awsv4"
    #[serde(rename = "type")]
    pub kind: String,
    /// Key-value list for the auth type. Present for all types except "noauth".
    #[serde(default)]
    pub bearer: Vec<AuthKv>,
    #[serde(default)]
    pub basic: Vec<AuthKv>,
    #[serde(default)]
    pub apikey: Vec<AuthKv>,
    #[serde(default)]
    pub oauth2: Vec<AuthKv>,
    #[serde(default)]
    pub awsv4: Vec<AuthKv>,
}

/// Postman stores auth values as `[{"key":"token","value":"..."}]` arrays.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AuthKv {
    pub key: String,
    #[serde(default)]
    pub value: Value,
    #[serde(rename = "type", default)]
    pub value_type: String,
}

impl PostmanAuth {
    /// Look up a value by key in the appropriate auth field list.
    pub fn get(&self, field_list: &[AuthKv], key: &str) -> String {
        field_list
            .iter()
            .find(|kv| kv.key == key)
            .map(|kv| match &kv.value {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default()
    }
}

// ─── Events / scripts ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct Event {
    /// "prerequest" or "test"
    #[serde(default)]
    pub listen: String,
    #[serde(default)]
    pub script: Option<Script>,
}

#[derive(Debug, Deserialize)]
pub struct Script {
    /// "text/javascript"
    #[serde(rename = "type", default)]
    pub script_type: String,
    /// Source lines — joined with "\n".
    #[serde(default)]
    pub exec: Vec<String>,
}

// ─── Environment file ────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PostmanEnv {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub values: Vec<EnvValue>,
}

#[derive(Debug, Deserialize)]
pub struct EnvValue {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// "secret" or "default"
    #[serde(rename = "type", default)]
    pub value_type: String,
}

fn default_true() -> bool {
    true
}

// ─── v1 legacy schema (pre-2014) ────────────────────────────────────────────
//
// Postman v1 is deprecated but still shows up when users export from very
// old saved sessions or third-party tools that target the legacy shape.
// Structure is RADICALLY different from v2.x:
//   - top-level `requests: [Request]` (flat list, no nesting)
//   - top-level `folders: [Folder]` with `order: [request-id]` references
//   - headers are a single `\n`-separated string, not an array
//   - body is in `rawModeData` / `data` depending on `dataMode`
//
// We deserialise into a parallel shape and the importer converts it to a
// v2.1-equivalent in-memory `PostmanCollection` before walking. That way
// the rest of the codebase only ever speaks v2.1.

#[derive(Debug, Deserialize)]
pub struct PostmanV1Collection {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub requests: Vec<PostmanV1Request>,
    #[serde(default)]
    pub folders: Vec<PostmanV1Folder>,
    /// Top-level request id order; folders carry their own `order`.
    #[serde(default)]
    pub order: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanV1Folder {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub order: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PostmanV1Request {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: String,
    /// Newline-separated `"Name: Value"` lines. Optional.
    #[serde(default)]
    pub headers: String,
    /// "raw" | "urlencoded" | "params" | "binary"
    #[serde(default)]
    #[serde(rename = "dataMode")]
    pub data_mode: String,
    /// Used when dataMode == "raw"
    #[serde(default)]
    #[serde(rename = "rawModeData")]
    pub raw_mode_data: Option<String>,
    /// Used when dataMode == "urlencoded"/"params" — `[{key, value, type, enabled}]`
    #[serde(default)]
    pub data: Vec<PostmanV1KvPair>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct PostmanV1KvPair {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

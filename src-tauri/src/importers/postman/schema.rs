/// Postman Collection v2.1 subset types used for deserialization.
/// Fields not needed by the importer are ignored via `#[serde(default)]`.
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ─── Top-level collection ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PostmanCollection {
    pub info: CollectionInfo,
    pub item: Vec<ItemOrFolder>,
    #[serde(default)]
    pub event: Vec<Event>,
}

#[derive(Debug, Deserialize)]
pub struct CollectionInfo {
    pub name: String,
    /// Schema URL, e.g. `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`
    #[serde(default)]
    pub schema: String,
}

// ─── Items / folders ────────────────────────────────────────────────────────

/// A node in the collection tree. Folders have `item`; requests have `request`.
#[derive(Debug, Deserialize)]
pub struct ItemOrFolder {
    pub name: String,
    /// Present for requests, absent for folders.
    #[serde(default)]
    pub request: Option<PostmanRequest>,
    /// Present for folders/collection roots.
    #[serde(default)]
    pub item: Vec<ItemOrFolder>,
    /// Scripts attached to this item.
    #[serde(default)]
    pub event: Vec<Event>,
}

// ─── Request ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PostmanRequest {
    pub method: String,
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

/// URL can be a plain string or an object with `raw` + `query` etc.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum PostmanUrl {
    String(String),
    Object(PostmanUrlObject),
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

#[derive(Debug, Deserialize)]
pub struct PostmanUrlObject {
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub query: Vec<QueryParam>,
}

#[derive(Debug, Deserialize)]
pub struct QueryParam {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct PostmanHeader {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

// ─── Body ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
pub struct FormField {
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

#[derive(Debug, Deserialize)]
pub struct BodyOptions {
    #[serde(default)]
    pub raw: Option<RawOptions>,
}

#[derive(Debug, Deserialize)]
pub struct RawOptions {
    #[serde(default)]
    pub language: Option<String>,
}

// ─── Auth ───────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize, Serialize)]
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
    pub name: String,
    #[serde(default)]
    pub values: Vec<EnvValue>,
}

#[derive(Debug, Deserialize)]
pub struct EnvValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub enabled: bool,
    /// "secret" or "default"
    #[serde(rename = "type", default)]
    pub value_type: String,
}

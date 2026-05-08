use crate::http::types::Method;
use serde::{Deserialize, Serialize};

/// A request as stored on disk in a `.bru` file. Contains template strings
/// (e.g. `"{{baseUrl}}/users"`) and per-row enable toggles. Different from
/// `http::types::HttpRequest`, which is the materialized form sent on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub name: String,
    pub seq: Option<u32>,
    pub method: Method,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<KvEnabled>,
    #[serde(default)]
    pub params: Vec<KvEnabled>,
    pub body: Option<RequestBody>,
    pub auth: Option<Auth>,
    #[serde(default)]
    pub vars: Vec<KvEnabled>,
}

/// A key-value pair with an enabled toggle. Disabled rows are kept on disk
/// but skipped at request build time. This mirrors Bruno's `~`-prefixed
/// disable syntax.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvEnabled {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Body shapes supported by a Bruno-format collection. The on-disk
/// representation may include template strings in any of the value fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RequestBody {
    Json {
        value: String,
    },
    Text {
        value: String,
        #[serde(rename = "contentType")]
        content_type: String,
    },
    FormUrlencoded {
        fields: Vec<KvEnabled>,
    },
    MultipartForm {
        fields: Vec<KvEnabled>,
    },
    GraphQl {
        query: String,
        variables: String,
    },
}

/// Authentication strategies as expressed in `.bru` auth:* blocks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Auth {
    None,
    Bearer {
        token: String,
    },
    Basic {
        username: String,
        password: String,
    },
    ApiKey {
        key: String,
        value: String,
        #[serde(rename = "in")]
        location: String, // "header" or "query"
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kv_enabled_defaults_to_true_when_field_omitted() {
        let json = r#"{"key":"x","value":"y"}"#;
        let kv: KvEnabled = serde_json::from_str(json).unwrap();
        assert!(kv.enabled);
    }

    #[test]
    fn kv_enabled_round_trips_with_disabled_flag() {
        let kv = KvEnabled {
            key: "k".into(),
            value: "v".into(),
            enabled: false,
        };
        let json = serde_json::to_string(&kv).unwrap();
        let back: KvEnabled = serde_json::from_str(&json).unwrap();
        assert_eq!(kv, back);
    }

    #[test]
    fn request_serializes_method_uppercase() {
        let req = Request {
            name: "Get user".into(),
            seq: Some(1),
            method: Method::Get,
            url: "{{baseUrl}}/users/42".into(),
            headers: vec![],
            params: vec![],
            body: None,
            auth: Some(Auth::Bearer {
                token: "{{token}}".into(),
            }),
            vars: vec![KvEnabled {
                key: "baseUrl".into(),
                value: "https://api.example.com".into(),
                enabled: true,
            }],
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"method\":\"GET\""), "got: {json}");
        assert!(json.contains("\"kind\":\"bearer\""), "got: {json}");
        assert!(json.contains("\"baseUrl\""), "got: {json}");
    }

    #[test]
    fn auth_apikey_serializes_in_field() {
        let a = Auth::ApiKey {
            key: "X-Api-Key".into(),
            value: "abc".into(),
            location: "header".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"in\":\"header\""), "got: {json}");
        let back: Auth = serde_json::from_str(&json).unwrap();
        assert_eq!(a, back);
    }

    #[test]
    fn body_form_urlencoded_round_trip() {
        let b = RequestBody::FormUrlencoded {
            fields: vec![
                KvEnabled {
                    key: "user".into(),
                    value: "alice".into(),
                    enabled: true,
                },
                KvEnabled {
                    key: "active".into(),
                    value: "true".into(),
                    enabled: false,
                },
            ],
        };
        let json = serde_json::to_string(&b).unwrap();
        let back: RequestBody = serde_json::from_str(&json).unwrap();
        assert_eq!(b, back);
    }
}

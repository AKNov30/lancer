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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_request_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_response_script: Option<String>,
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
        location: String,
    },
    /// OAuth 2 Client Credentials grant. The runtime fetches a token from
    /// `token_url` and caches it until expiry. `audience` is optional in spec
    /// but represented as a (possibly empty) string for serde stability.
    OAuth2Cc {
        #[serde(rename = "tokenUrl")]
        token_url: String,
        #[serde(rename = "clientId")]
        client_id: String,
        #[serde(rename = "clientSecret")]
        client_secret: String,
        scope: String,
        audience: String,
    },
    /// AWS Signature V4. `session_token` is required when using temporary STS
    /// credentials, absent otherwise — modelled as `Option<String>`.
    AwsSigV4 {
        #[serde(rename = "accessKeyId")]
        access_key_id: String,
        #[serde(rename = "secretAccessKey")]
        secret_access_key: String,
        #[serde(rename = "sessionToken", skip_serializing_if = "Option::is_none")]
        session_token: Option<String>,
        region: String,
        service: String,
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
            pre_request_script: None,
            post_response_script: None,
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

    #[test]
    fn auth_oauth2_cc_serializes_with_camel_case_fields() {
        let a = Auth::OAuth2Cc {
            token_url: "https://auth.example.com/oauth/token".into(),
            client_id: "abc".into(),
            client_secret: "shh".into(),
            scope: "read:users write:users".into(),
            audience: "https://api.example.com".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"kind\":\"oAuth2Cc\""), "got: {json}");
        assert!(json.contains("\"tokenUrl\""), "got: {json}");
        assert!(json.contains("\"clientId\""), "got: {json}");
        let back: Auth = serde_json::from_str(&json).unwrap();
        assert_eq!(a, back);
    }

    #[test]
    fn auth_aws_sigv4_serializes_with_camel_case_fields() {
        let a = Auth::AwsSigV4 {
            access_key_id: "AKIA…".into(),
            secret_access_key: "secret".into(),
            session_token: Some("temp".into()),
            region: "us-east-1".into(),
            service: "execute-api".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"kind\":\"awsSigV4\""), "got: {json}");
        assert!(json.contains("\"accessKeyId\""), "got: {json}");
        assert!(json.contains("\"sessionToken\":\"temp\""), "got: {json}");
        let back: Auth = serde_json::from_str(&json).unwrap();
        assert_eq!(a, back);
    }

    #[test]
    fn auth_aws_sigv4_session_token_optional() {
        let a = Auth::AwsSigV4 {
            access_key_id: "AKIA…".into(),
            secret_access_key: "secret".into(),
            session_token: None,
            region: "us-east-1".into(),
            service: "execute-api".into(),
        };
        let json = serde_json::to_string(&a).unwrap();
        let back: Auth = serde_json::from_str(&json).unwrap();
        assert_eq!(a, back);
    }
}

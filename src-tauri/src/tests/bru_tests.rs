use crate::collection::bru;
use crate::collection::schema::{Auth, KvEnabled};
use crate::http::types::Method;

const FIXTURE: &str = include_str!("fixtures/simple.bru");

#[test]
fn parses_simple_get_request() {
    let req = bru::parse(FIXTURE).expect("parse");

    assert_eq!(req.name, "Get user");
    assert_eq!(req.seq, Some(1));
    assert_eq!(req.method, Method::Get);
    assert_eq!(req.url, "{{baseUrl}}/users/42");

    // Headers should preserve order, with the ~accept-language disabled.
    assert_eq!(
        req.headers,
        vec![
            KvEnabled {
                key: "accept".into(),
                value: "application/json".into(),
                enabled: true,
            },
            KvEnabled {
                key: "accept-language".into(),
                value: "en".into(),
                enabled: false,
            },
        ]
    );

    match &req.auth {
        Some(Auth::Bearer { token }) => assert_eq!(token, "{{token}}"),
        other => panic!("expected bearer auth, got {other:?}"),
    }

    // body: none → no body
    assert!(req.body.is_none());

    // vars:pre-request preserved
    assert_eq!(
        req.vars,
        vec![KvEnabled {
            key: "baseUrl".into(),
            value: "https://api.example.com".into(),
            enabled: true,
        }]
    );
}

#[test]
fn round_trip_preserves_all_fields() {
    let original = bru::parse(FIXTURE).expect("initial parse");
    let serialized = bru::serialize(&original);
    let reparsed = bru::parse(&serialized).expect("reparse after serialize");
    assert_eq!(
        original, reparsed,
        "round-trip mismatch.\nserialized was:\n{serialized}"
    );
}

#[test]
fn serialize_includes_required_blocks() {
    let original = bru::parse(FIXTURE).expect("parse");
    let serialized = bru::serialize(&original);

    // Top-level structure: meta, get, headers, auth:bearer, vars:pre-request.
    assert!(
        serialized.contains("meta {"),
        "missing meta block:\n{serialized}"
    );
    assert!(
        serialized.contains("get {"),
        "missing get block:\n{serialized}"
    );
    assert!(
        serialized.contains("headers {"),
        "missing headers block:\n{serialized}"
    );
    assert!(
        serialized.contains("auth:bearer {"),
        "missing auth:bearer block:\n{serialized}"
    );
    assert!(
        serialized.contains("vars:pre-request {"),
        "missing vars:pre-request block:\n{serialized}"
    );
    assert!(
        serialized.contains("name: Get user"),
        "missing meta name line:\n{serialized}"
    );
    assert!(
        serialized.contains("token: {{token}}"),
        "missing bearer token line:\n{serialized}"
    );
    // Disabled headers must use the ~ prefix.
    assert!(
        serialized.contains("~accept-language: en"),
        "disabled header should be ~-prefixed:\n{serialized}"
    );
}

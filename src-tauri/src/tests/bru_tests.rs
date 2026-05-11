use crate::collection::bru;
use crate::collection::schema::{Auth, KvEnabled};
use crate::http::types::Method;

const FIXTURE: &str = include_str!("fixtures/simple.bru");
const OAUTH2_FIXTURE: &str = include_str!("fixtures/auth-oauth2.bru");
const AWS_FIXTURE: &str = include_str!("fixtures/auth-aws.bru");

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

#[test]
fn workspace_round_trip_through_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("login.bru");
    let original = bru::parse(FIXTURE).expect("parse fixture");

    // Use the public IO surface — write, then read back.
    crate::collection::io::write_request(&path, &original).expect("write");
    let back = crate::collection::io::read_request(&path).expect("read");

    assert_eq!(original, back, "round-trip through disk lost data");
}

#[test]
fn list_workspace_finds_bru_files_recursively() {
    use std::fs;
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    // Create a small directory tree:
    //   root/
    //     login.bru
    //     users/
    //       get.bru
    //     notes.txt           (must NOT be listed)
    //     broken.bru          (parse failure → must NOT panic)
    fs::create_dir_all(root.join("users")).unwrap();
    let original = bru::parse(FIXTURE).unwrap();
    crate::collection::io::write_request(&root.join("login.bru"), &original).unwrap();
    crate::collection::io::write_request(&root.join("users").join("get.bru"), &original).unwrap();
    fs::write(root.join("notes.txt"), "not a bru file").unwrap();
    fs::write(root.join("broken.bru"), "this is not a bru file").unwrap();

    let items = crate::collection::io::list_workspace(root).expect("list");

    // Should have at least the two valid .bru files. Broken one is skipped silently.
    let rels: Vec<&str> = items.iter().map(|i| i.rel_path.as_str()).collect();
    assert!(
        rels.iter().any(|r| r.ends_with("login.bru")),
        "missing login.bru in {rels:?}"
    );
    assert!(
        rels.iter().any(|r| r.ends_with("get.bru")),
        "missing nested get.bru in {rels:?}"
    );
    // notes.txt must not be listed
    assert!(
        !rels.iter().any(|r| r.ends_with("notes.txt")),
        "notes.txt should not appear in {rels:?}"
    );

    // Each item exposes name and method
    for item in &items {
        assert_eq!(item.name, "Get user");
        assert_eq!(item.method, "GET");
        assert_eq!(item.seq, Some(1));
    }
}

#[test]
fn parses_oauth2_cc_auth() {
    let req = bru::parse(OAUTH2_FIXTURE).expect("parse");
    match req.auth {
        Some(Auth::OAuth2Cc {
            token_url,
            client_id,
            client_secret,
            scope,
            audience,
        }) => {
            assert_eq!(token_url, "https://auth.example.com/oauth/token");
            assert_eq!(client_id, "my-app");
            assert_eq!(client_secret, "{{oauthSecret}}");
            assert_eq!(scope, "read:users");
            assert_eq!(audience, "https://api.example.com");
        }
        other => panic!("expected OAuth2Cc, got {other:?}"),
    }
}

#[test]
fn parses_aws_sigv4_auth() {
    let req = bru::parse(AWS_FIXTURE).expect("parse");
    match req.auth {
        Some(Auth::AwsSigV4 {
            access_key_id,
            secret_access_key,
            session_token,
            region,
            service,
        }) => {
            assert_eq!(access_key_id, "{{awsAccessKey}}");
            assert_eq!(secret_access_key, "{{awsSecret}}");
            assert_eq!(session_token, Some("{{awsSession}}".into()));
            assert_eq!(region, "us-east-1");
            assert_eq!(service, "lambda");
        }
        other => panic!("expected AwsSigV4, got {other:?}"),
    }
}

#[test]
fn oauth2_round_trips_through_serialize() {
    let req = bru::parse(OAUTH2_FIXTURE).unwrap();
    let serialized = bru::serialize(&req);
    let back = bru::parse(&serialized).expect("reparse");
    assert_eq!(req, back, "OAuth2 round-trip failed:\n{serialized}");
}

#[test]
fn aws_round_trips_through_serialize() {
    let req = bru::parse(AWS_FIXTURE).unwrap();
    let serialized = bru::serialize(&req);
    let back = bru::parse(&serialized).expect("reparse");
    assert_eq!(req, back, "AWS round-trip failed:\n{serialized}");
}

#[test]
fn parse_empty_string_returns_err() {
    let result = bru::parse("");
    assert!(matches!(result, Err(bru::BruError::MissingBlock("meta"))));
}

#[test]
fn parse_no_method_block_returns_err() {
    let input = "meta {\n  name: x\n  type: http\n}\n";
    let result = bru::parse(input);
    assert!(matches!(result, Err(bru::BruError::NoMethodBlock)));
}

#[test]
fn parse_unterminated_block_returns_err() {
    let input = "meta {\n  name: x\n"; // missing closing brace
    let result = bru::parse(input);
    assert!(
        matches!(result, Err(bru::BruError::Lex(_))),
        "expected lex error, got {result:?}"
    );
}

#[test]
fn parse_unknown_auth_returns_err() {
    let input =
        "meta {\n  name: x\n  type: http\n}\n\nget {\n  url: https://x\n  auth: martian\n}\n";
    let result = bru::parse(input);
    assert!(matches!(result, Err(bru::BruError::UnknownAuth(_))));
}

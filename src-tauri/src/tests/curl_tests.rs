use crate::http::curl;
use crate::http::types::{HttpRequest, Method, RequestBody};

#[test]
fn parses_simple_get() {
    let r = curl::parse("curl https://api.example.com/users").unwrap();
    assert_eq!(r.method, Method::Get);
    assert_eq!(r.url, "https://api.example.com/users");
    assert!(r.body.is_none());
}

#[test]
fn parses_post_with_json_body() {
    let r =
        curl::parse(r#"curl -X POST https://x -H 'content-type: application/json' -d '{"a":1}'"#)
            .unwrap();
    assert_eq!(r.method, Method::Post);
    match r.body {
        Some(RequestBody::Json { value }) => assert_eq!(value, serde_json::json!({"a": 1})),
        other => panic!("expected Json body, got: {other:?}"),
    }
}

#[test]
fn parses_multiline_with_backslash_continuations() {
    let input =
        "curl -X POST https://x \\\n  -H 'x-key: v1' \\\n  -H 'x-key2: v2' \\\n  -d 'hello'";
    let r = curl::parse(input).unwrap();
    assert_eq!(r.method, Method::Post);
    assert!(
        r.headers.iter().any(|(k, _)| k == "x-key"),
        "missing x-key header"
    );
    assert!(
        r.headers.iter().any(|(k, _)| k == "x-key2"),
        "missing x-key2 header"
    );
}

#[test]
fn parses_basic_auth_to_authorization_header() {
    let r = curl::parse("curl -u alice:secret https://x").unwrap();
    let auth = r
        .headers
        .iter()
        .find(|(k, _)| k == "Authorization")
        .expect("Authorization header missing");
    // base64("alice:secret") == "YWxpY2U6c2VjcmV0"
    assert_eq!(auth.1, "Basic YWxpY2U6c2VjcmV0");
}

#[test]
fn to_curl_round_trips_basics() {
    let req = HttpRequest {
        url: "https://x.example.com/api".into(),
        method: Method::Post,
        headers: vec![("X-Test".into(), "1".into())],
        query: vec![],
        body: Some(RequestBody::Json {
            value: serde_json::json!({"k": "v"}),
        }),
        options: None,
    };
    let curl_str = curl::to_curl(&req);
    assert!(
        curl_str.contains("curl -X POST"),
        "missing method: {curl_str}"
    );
    assert!(
        curl_str.contains("https://x.example.com/api"),
        "missing url: {curl_str}"
    );
    assert!(curl_str.contains("X-Test: 1"), "missing header: {curl_str}");
    assert!(
        curl_str.contains(r#"{"k":"v"}"#),
        "missing json body: {curl_str}"
    );
}

#[test]
fn missing_url_errors() {
    let result = curl::parse("curl -X GET");
    assert!(result.is_err(), "expected error for missing URL");
}

#[test]
fn parses_delete_method() {
    let r = curl::parse("curl -X DELETE https://api.example.com/users/1").unwrap();
    assert_eq!(r.method, Method::Delete);
    assert_eq!(r.url, "https://api.example.com/users/1");
}

#[test]
fn parses_form_fields() {
    let r = curl::parse("curl -F 'name=alice' -F 'age=30' https://api.example.com/form").unwrap();
    assert_eq!(r.method, Method::Post);
    match r.body {
        Some(RequestBody::Form { fields }) => {
            assert_eq!(fields.len(), 2);
            assert!(fields.iter().any(|(k, v)| k == "name" && v == "alice"));
            assert!(fields.iter().any(|(k, v)| k == "age" && v == "30"));
        }
        other => panic!("expected Form body, got: {other:?}"),
    }
}

#[test]
fn infers_post_from_data_flag() {
    let r = curl::parse("curl https://api.example.com/items -d 'hello'").unwrap();
    assert_eq!(r.method, Method::Post);
}

#[test]
fn to_fetch_produces_valid_js() {
    let req = HttpRequest {
        url: "https://api.example.com/test".into(),
        method: Method::Get,
        headers: vec![("Accept".into(), "application/json".into())],
        query: vec![],
        body: None,
        options: None,
    };
    let fetch_str = curl::to_fetch(&req);
    assert!(
        fetch_str.contains("await fetch("),
        "missing fetch call: {fetch_str}"
    );
    assert!(fetch_str.contains("Accept"), "missing header: {fetch_str}");
}

#[test]
fn to_python_produces_requests_call() {
    let req = HttpRequest {
        url: "https://api.example.com/test".into(),
        method: Method::Post,
        headers: vec![],
        query: vec![],
        body: Some(RequestBody::Json {
            value: serde_json::json!({"key": "value"}),
        }),
        options: None,
    };
    let py = curl::to_python(&req);
    assert!(py.contains("import requests"), "missing import: {py}");
    assert!(py.contains("requests.post("), "missing method call: {py}");
    assert!(py.contains("json="), "missing json kwarg: {py}");
}

#[test]
fn to_go_produces_compilable_stub() {
    let req = HttpRequest {
        url: "https://api.example.com/test".into(),
        method: Method::Get,
        headers: vec![],
        query: vec![],
        body: None,
        options: None,
    };
    let go = curl::to_go(&req);
    assert!(go.contains("package main"), "missing package: {go}");
    assert!(go.contains("http.NewRequest("), "missing NewRequest: {go}");
}

#[test]
fn skips_unknown_flags_gracefully() {
    // --max-time and --retry are in the skip list; url should still be parsed.
    let r = curl::parse("curl --max-time 30 --retry 3 https://api.example.com/").unwrap();
    assert_eq!(r.url, "https://api.example.com/");
}

use crate::http::types::{HttpRequest, HttpResponse, Method};

#[test]
fn http_request_default_method_is_get() {
    let req = HttpRequest::new("https://example.com/api");
    assert_eq!(req.method, Method::Get);
    assert_eq!(req.url, "https://example.com/api");
    assert!(req.headers.is_empty());
    assert!(req.query.is_empty());
}

#[test]
fn method_serializes_uppercase() {
    let json = serde_json::to_string(&Method::Post).unwrap();
    assert_eq!(json, "\"POST\"");
}

#[test]
fn http_response_serializes_to_json_with_camel_case() {
    let resp = HttpResponse {
        status: 200,
        status_text: "OK".to_string(),
        headers: vec![("content-type".to_string(), "application/json".to_string())],
        body: br#"{"ok":true}"#.to_vec(),
        body_text: Some(r#"{"ok":true}"#.to_string()),
        elapsed_ms: 124,
        size_bytes: 11,
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(
        json.contains("\"statusText\":\"OK\""),
        "expected camelCase statusText, got: {json}"
    );
    assert!(
        json.contains("\"elapsedMs\":124"),
        "expected camelCase elapsedMs, got: {json}"
    );
    assert!(
        json.contains("\"sizeBytes\":11"),
        "expected camelCase sizeBytes, got: {json}"
    );
    assert!(
        json.contains("\"bodyText\":"),
        "expected camelCase bodyText, got: {json}"
    );
}

#[test]
fn request_body_json_round_trip() {
    let body = serde_json::json!({
        "kind": "json",
        "value": { "username": "alice", "active": true }
    });
    let parsed: crate::http::types::RequestBody = serde_json::from_value(body.clone()).unwrap();
    let reserialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(reserialized, body);
}

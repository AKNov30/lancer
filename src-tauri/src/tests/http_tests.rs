use crate::http::client::send;
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

#[tokio::test]
async fn send_get_returns_2xx_for_httpbin() {
    let req = HttpRequest::new("https://httpbin.org/get");
    let resp = send(req).await.expect("request should succeed");
    assert_eq!(
        resp.status / 100,
        2,
        "expected 2xx, got {} {}",
        resp.status,
        resp.status_text
    );
    assert!(resp.size_bytes > 0, "expected non-empty body");
    assert!(
        resp.elapsed_ms < 30_000,
        "request took longer than 30s: {}ms",
        resp.elapsed_ms
    );
    assert!(
        resp.body_text.is_some(),
        "httpbin returns JSON, body_text should decode"
    );
    let text = resp.body_text.unwrap();
    assert!(
        text.contains("\"url\""),
        "body should be JSON with url field"
    );
}

#[tokio::test]
async fn send_post_with_json_body_echoes() {
    use crate::http::types::{Method, RequestBody};
    let mut req = HttpRequest::new("https://httpbin.org/post");
    req.method = Method::Post;
    req.body = Some(RequestBody::Json {
        value: serde_json::json!({ "hello": "lancer", "n": 42 }),
    });
    let resp = send(req).await.expect("request should succeed");
    assert_eq!(resp.status, 200);
    let text = resp.body_text.unwrap();
    // httpbin echoes the json field
    assert!(
        text.contains("\"hello\""),
        "expected echoed key 'hello' in: {text}"
    );
    assert!(
        text.contains("\"lancer\""),
        "expected echoed value 'lancer' in: {text}"
    );
}

#[tokio::test]
async fn send_with_query_params_appears_in_url() {
    let mut req = HttpRequest::new("https://httpbin.org/get");
    req.query = vec![
        ("foo".to_string(), "bar baz".to_string()),
        ("n".to_string(), "1".to_string()),
    ];
    let resp = send(req).await.expect("request should succeed");
    assert_eq!(resp.status, 200);
    let text = resp.body_text.unwrap();
    // httpbin echoes args
    assert!(text.contains("\"foo\""), "expected foo arg in: {text}");
    assert!(
        text.contains("bar baz") || text.contains("bar%20baz") || text.contains("bar+baz"),
        "expected url-encoded value in: {text}"
    );
}

#[tokio::test]
async fn send_with_headers_passes_through() {
    let mut req = HttpRequest::new("https://httpbin.org/headers");
    req.headers = vec![("X-Lancer-Test".to_string(), "ok".to_string())];
    let resp = send(req).await.expect("request should succeed");
    assert_eq!(resp.status, 200);
    let text = resp.body_text.unwrap();
    // httpbin echoes headers (case-insensitive on its side)
    assert!(
        text.contains("X-Lancer-Test") || text.contains("x-lancer-test"),
        "expected echoed header in: {text}"
    );
}

use crate::http::client::send;
use crate::http::types::{HttpRequest, HttpResponse, Method};
use crate::state::AppState;

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
        ttfb_ms: 60,
        download_ms: 64,
        tests: Vec::new(),
        script_logs: Vec::new(),
        script_error: None,
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

/// The multipart wire shape must deserialize from the exact JSON the frontend
/// `bodyToWire` produces: an internally-tagged `parts` array with `text` and
/// `file` variants in camelCase (`contentType`).
#[test]
fn request_body_multipart_round_trip() {
    use crate::http::types::{MultipartPart, RequestBody};
    let body = serde_json::json!({
        "kind": "multipart",
        "parts": [
            { "kind": "text", "name": "caption", "value": "hi" },
            { "kind": "file", "name": "avatar", "path": "/tmp/a.png", "contentType": "image/png" }
        ]
    });
    let parsed: RequestBody = serde_json::from_value(body.clone()).unwrap();
    match &parsed {
        RequestBody::Multipart { parts } => {
            assert_eq!(parts.len(), 2);
            assert!(matches!(&parts[0], MultipartPart::Text { name, value }
                if name == "caption" && value == "hi"));
            assert!(
                matches!(&parts[1], MultipartPart::File { name, content_type, .. }
                if name == "avatar" && content_type == "image/png")
            );
        }
        other => panic!("expected multipart, got {other:?}"),
    }
    let reserialized = serde_json::to_value(&parsed).unwrap();
    assert_eq!(reserialized, body, "multipart wire shape changed");
}

/// A `file` part with no `contentType` field must still deserialize (the
/// frontend always sends one, but `#[serde(default)]` keeps us robust).
#[test]
fn request_body_multipart_file_content_type_defaults() {
    use crate::http::types::{MultipartPart, RequestBody};
    let body = serde_json::json!({
        "kind": "multipart",
        "parts": [ { "kind": "file", "name": "f", "path": "/tmp/x.bin" } ]
    });
    let parsed: RequestBody = serde_json::from_value(body).unwrap();
    match parsed {
        RequestBody::Multipart { parts } => {
            assert!(matches!(&parts[0], MultipartPart::File { content_type, .. }
                if content_type.is_empty()));
        }
        other => panic!("expected multipart, got {other:?}"),
    }
}

/// Live end-to-end check that a `multipart` body with a real on-disk file
/// uploads and is echoed back by httpbin. `#[ignore]`d by default because it
/// depends on an external echo server (httpbin frequently returns 503); run
/// explicitly with `cargo test --lib -- --ignored send_multipart_uploads`.
#[tokio::test]
#[ignore = "live network upload to httpbin; flaky, run on demand"]
async fn send_multipart_uploads_text_and_file() {
    use crate::http::types::{Method, MultipartPart, RequestBody};
    use std::io::Write as _;

    // Write a tiny temp file to attach.
    let dir = tempfile::tempdir().expect("tempdir");
    let file_path = dir.path().join("note.txt");
    let mut f = std::fs::File::create(&file_path).expect("create temp file");
    f.write_all(b"lancer-multipart-payload")
        .expect("write temp file");
    drop(f);

    let state = AppState::default();
    let mut req = HttpRequest::new("https://httpbin.org/post");
    req.method = Method::Post;
    req.body = Some(RequestBody::Multipart {
        parts: vec![
            MultipartPart::Text {
                name: "caption".into(),
                value: "hello-lancer".into(),
            },
            MultipartPart::File {
                name: "upload".into(),
                path: file_path.clone(),
                content_type: String::new(), // sniffed → text/plain
            },
        ],
    });
    let resp = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect("request should succeed");
    assert_eq!(resp.status, 200);
    let text = resp.body_text.unwrap();
    // httpbin echoes form fields under "form" and files under "files".
    assert!(
        text.contains("hello-lancer"),
        "form text missing in: {text}"
    );
    assert!(
        text.contains("lancer-multipart-payload"),
        "file contents missing in: {text}"
    );
}

/// A `file` part pointing at a missing path fails with a clear multipart error
/// (no network needed — the error is raised while building the form).
#[tokio::test]
async fn send_multipart_missing_file_errors_clearly() {
    use crate::http::types::{Method, MultipartPart, RequestBody};
    let state = AppState::default();
    let mut req = HttpRequest::new("https://httpbin.org/post");
    req.method = Method::Post;
    req.body = Some(RequestBody::Multipart {
        parts: vec![MultipartPart::File {
            name: "upload".into(),
            path: "/definitely/not/a/real/path/xyz.bin".into(),
            content_type: String::new(),
        }],
    });
    let err = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect_err("missing file should error before sending");
    let msg = err.to_string();
    assert!(
        msg.contains("multipart body error") && msg.contains("upload"),
        "expected a clear multipart error naming the part, got: {msg}"
    );
}

#[tokio::test]
async fn send_get_returns_2xx_for_httpbin() {
    let state = AppState::default();
    let req = HttpRequest::new("https://httpbin.org/get");
    let resp = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect("request should succeed");
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
    let state = AppState::default();
    let mut req = HttpRequest::new("https://httpbin.org/post");
    req.method = Method::Post;
    req.body = Some(RequestBody::Json {
        value: serde_json::json!({ "hello": "lancer", "n": 42 }),
    });
    let resp = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect("request should succeed");
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
    let state = AppState::default();
    let mut req = HttpRequest::new("https://httpbin.org/get");
    req.query = vec![
        ("foo".to_string(), "bar baz".to_string()),
        ("n".to_string(), "1".to_string()),
    ];
    let resp = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect("request should succeed");
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
    let state = AppState::default();
    let mut req = HttpRequest::new("https://httpbin.org/headers");
    req.headers = vec![("X-Lancer-Test".to_string(), "ok".to_string())];
    let resp = send(&state.http_client(), &state.cookie_jar, req)
        .await
        .expect("request should succeed");
    assert_eq!(resp.status, 200);
    let text = resp.body_text.unwrap();
    // httpbin echoes headers (case-insensitive on its side)
    assert!(
        text.contains("X-Lancer-Test") || text.contains("x-lancer-test"),
        "expected echoed header in: {text}"
    );
}

#[test]
fn send_request_command_function_exists() {
    let _ = crate::commands::http::send_request;
}

// ── apply_auth tests ─────────────────────────────────────────────────────────

use crate::collection::schema::Auth;
use crate::http::auth::apply_auth;

#[tokio::test]
async fn bearer_auth_adds_authorization_header() {
    let state = AppState::default();
    let req = HttpRequest::new("https://httpbin.org/headers");
    let req = apply_auth(
        req,
        &Auth::Bearer {
            token: "test-token".into(),
        },
        &state,
    )
    .await
    .unwrap();
    let auth_header = req
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"));
    assert_eq!(
        auth_header.map(|(_, v)| v.as_str()),
        Some("Bearer test-token")
    );
}

#[tokio::test]
async fn basic_auth_encodes_username_password() {
    let state = AppState::default();
    let req = HttpRequest::new("https://httpbin.org/basic-auth/alice/secret");
    let req = apply_auth(
        req,
        &Auth::Basic {
            username: "alice".into(),
            password: "secret".into(),
        },
        &state,
    )
    .await
    .unwrap();
    let auth = req
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
        .unwrap();
    // base64("alice:secret") = YWxpY2U6c2VjcmV0
    assert_eq!(auth.1, "Basic YWxpY2U6c2VjcmV0");
}

#[tokio::test]
async fn api_key_in_header_appended() {
    let state = AppState::default();
    let req = HttpRequest::new("https://httpbin.org/get");
    let req = apply_auth(
        req,
        &Auth::ApiKey {
            key: "X-Api-Key".into(),
            value: "abc123".into(),
            location: "header".into(),
        },
        &state,
    )
    .await
    .unwrap();
    let h = req.headers.iter().find(|(k, _)| k == "X-Api-Key").unwrap();
    assert_eq!(h.1, "abc123");
}

#[tokio::test]
async fn api_key_in_query_appended() {
    let state = AppState::default();
    let req = HttpRequest::new("https://httpbin.org/get");
    let req = apply_auth(
        req,
        &Auth::ApiKey {
            key: "api_key".into(),
            value: "abc123".into(),
            location: "query".into(),
        },
        &state,
    )
    .await
    .unwrap();
    let q = req.query.iter().find(|(k, _)| k == "api_key").unwrap();
    assert_eq!(q.1, "abc123");
}

#[tokio::test]
async fn api_key_rejects_invalid_location() {
    let state = AppState::default();
    let req = HttpRequest::new("https://example.com");
    let result = apply_auth(
        req,
        &Auth::ApiKey {
            key: "k".into(),
            value: "v".into(),
            location: "body".into(),
        },
        &state,
    )
    .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn oauth2_cc_fetches_token_and_adds_bearer_header() {
    use axum::{routing::post, Json, Router};
    use std::net::SocketAddr;
    use tokio::net::TcpListener;

    async fn token_endpoint() -> Json<serde_json::Value> {
        Json(serde_json::json!({
            "access_token": "issued-by-mock-token-123",
            "token_type": "Bearer",
            "expires_in": 3600
        }))
    }

    let app = Router::new().route("/oauth/token", post(token_endpoint));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let state = AppState::default();
    let req = HttpRequest::new("https://example.com/api");
    let req = apply_auth(
        req,
        &Auth::OAuth2Cc {
            token_url: format!("http://{addr}/oauth/token"),
            client_id: "client-x".into(),
            client_secret: "secret-y".into(),
            scope: "read".into(),
            audience: "".into(),
        },
        &state,
    )
    .await
    .expect("apply_auth");

    let auth_header = req
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
        .expect("Authorization header should be set");
    assert_eq!(auth_header.1, "Bearer issued-by-mock-token-123");

    server.abort();
}

#[tokio::test]
async fn oauth2_cc_reuses_cached_token_until_expiry() {
    use axum::{routing::post, Json, Router};
    use std::net::SocketAddr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::net::TcpListener;

    let hits = Arc::new(AtomicUsize::new(0));
    let hits_clone = hits.clone();

    let app = Router::new().route(
        "/oauth/token",
        post(move || {
            let hits = hits_clone.clone();
            async move {
                let n = hits.fetch_add(1, Ordering::SeqCst) + 1;
                Json(serde_json::json!({
                    "access_token": format!("token-{n}"),
                    "expires_in": 3600
                }))
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let state = AppState::default();
    let auth_cfg = Auth::OAuth2Cc {
        token_url: format!("http://{addr}/oauth/token"),
        client_id: "c".into(),
        client_secret: "s".into(),
        scope: "read".into(),
        audience: "".into(),
    };

    let req1 = apply_auth(HttpRequest::new("https://x.example"), &auth_cfg, &state)
        .await
        .unwrap();
    let req2 = apply_auth(HttpRequest::new("https://y.example"), &auth_cfg, &state)
        .await
        .unwrap();

    let t1 = &req1
        .headers
        .iter()
        .find(|(k, _)| k == "Authorization")
        .unwrap()
        .1;
    let t2 = &req2
        .headers
        .iter()
        .find(|(k, _)| k == "Authorization")
        .unwrap()
        .1;
    assert_eq!(t1, t2, "expected cached reuse");
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "token endpoint hit more than once"
    );

    server.abort();
}

#[tokio::test]
async fn aws_sigv4_adds_required_headers() {
    let state = AppState::default();
    let req = HttpRequest::new(
        "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/foo/invocations",
    );
    let req = apply_auth(
        req,
        &Auth::AwsSigV4 {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            session_token: None,
            region: "us-east-1".into(),
            service: "lambda".into(),
        },
        &state,
    )
    .await
    .expect("apply_auth");

    let auth = req
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("Authorization"))
        .expect("Authorization header must be present");
    assert!(auth.1.starts_with("AWS4-HMAC-SHA256 "), "got: {}", auth.1);
    assert!(
        auth.1.contains("Credential=AKIDEXAMPLE/"),
        "got: {}",
        auth.1
    );
    assert!(auth.1.contains("Signature="), "got: {}", auth.1);

    assert!(
        req.headers
            .iter()
            .any(|(k, _)| k.eq_ignore_ascii_case("x-amz-date")),
        "expected x-amz-date header"
    );
}

#[tokio::test]
async fn aws_sigv4_includes_session_token_header_when_provided() {
    let state = AppState::default();
    let req = HttpRequest::new(
        "https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/foo/invocations",
    );
    let req = apply_auth(
        req,
        &Auth::AwsSigV4 {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            session_token: Some("session-token-xyz".into()),
            region: "us-east-1".into(),
            service: "lambda".into(),
        },
        &state,
    )
    .await
    .unwrap();
    let t = req
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("x-amz-security-token"));
    assert_eq!(t.map(|(_, v)| v.as_str()), Some("session-token-xyz"));
}

// ── A5: new hardening tests ───────────────────────────────────────────────────

#[tokio::test]
async fn bearer_rejects_token_with_newline() {
    let state = AppState::default();
    let req = HttpRequest::new("https://example.com");
    let result = apply_auth(
        req,
        &Auth::Bearer {
            token: "abc\r\nX-Inject: yes".into(),
        },
        &state,
    )
    .await;
    assert!(result.is_err(), "expected validation rejection");
}

#[tokio::test]
async fn oauth2_cache_evicts_expired_on_put() {
    use crate::state::{OAuth2Cache, OAuth2Entry};
    use std::time::{Duration, SystemTime};

    let cache = OAuth2Cache::default();
    // Insert an expired entry
    cache
        .put(
            "expired".into(),
            OAuth2Entry {
                access_token: "old".into(),
                expires_at: SystemTime::now() - Duration::from_secs(1),
            },
        )
        .await;
    // Insert a fresh entry — should evict the expired one
    cache
        .put(
            "fresh".into(),
            OAuth2Entry {
                access_token: "new".into(),
                expires_at: SystemTime::now() + Duration::from_secs(3600),
            },
        )
        .await;
    // Both `get` calls — expired returns None, fresh returns Some
    assert!(cache.get("expired").await.is_none());
    assert!(cache.get("fresh").await.is_some());
}

#[test]
fn oauth2_cache_key_includes_client_secret() {
    use crate::http::auth::oauth2_cache_key;
    let k1 = oauth2_cache_key("https://t", "id", "secret-A", "scope", "");
    let k2 = oauth2_cache_key("https://t", "id", "secret-B", "scope", "");
    assert_ne!(
        k1, k2,
        "different client_secret must produce different keys"
    );
}

// ── M6.3.1: wire-form substitution tests ─────────────────────────────────────

#[test]
fn substitute_http_request_walks_wire_form() {
    use crate::env::substitute::{substitute_http_request, Ctx};
    use crate::http::types::HttpRequest;

    let mut ctx = Ctx::default();
    ctx.vars
        .insert("base".into(), "https://api.example.com".into());
    ctx.vars.insert("tok".into(), "abc-token".into());

    let mut req = HttpRequest::new("{{base}}/users");
    req.headers
        .push(("Authorization".into(), "Bearer {{tok}}".into()));
    req.query.push(("v".into(), "{{ver}}".into())); // unknown — stays

    substitute_http_request(&mut req, &ctx);

    assert_eq!(req.url, "https://api.example.com/users");
    assert_eq!(req.headers[0].1, "Bearer abc-token");
    assert_eq!(req.query[0].1, "{{ver}}");
}

#[test]
fn substitute_json_body_walks_string_leaves() {
    use crate::env::substitute::{substitute_http_request, Ctx};
    use crate::http::types::{HttpRequest, RequestBody};

    let mut ctx = Ctx::default();
    ctx.vars.insert("name".into(), "alice".into());
    ctx.vars.insert("port".into(), "8080".into());

    let mut req = HttpRequest::new("https://x");
    req.body = Some(RequestBody::Json {
        value: serde_json::json!({
            "user": "{{name}}",
            "config": {
                "host": "localhost",
                "port_text": "{{port}}",
                "tags": ["{{name}}-tag", "static"]
            }
        }),
    });
    substitute_http_request(&mut req, &ctx);
    let body = match &req.body {
        Some(RequestBody::Json { value }) => value,
        _ => panic!("expected json"),
    };
    assert_eq!(body["user"], serde_json::json!("alice"));
    assert_eq!(body["config"]["port_text"], serde_json::json!("8080"));
    assert_eq!(body["config"]["tags"][0], serde_json::json!("alice-tag"));
    assert_eq!(body["config"]["tags"][1], serde_json::json!("static"));
}

#[tokio::test]
async fn load_ctx_from_disk_reads_vars() {
    use crate::env::schema::Environment;
    use crate::env::substitute::load_ctx_from_disk;

    let dir = tempfile::tempdir().unwrap();
    let env = Environment {
        name: "dev".into(),
        vars: vec![
            ("baseUrl".into(), "https://api.example.com".into()),
            ("apiVersion".into(), "v1".into()),
        ],
        secret_names: vec![], // no secrets — keyring not needed
    };
    crate::env::io::write_env(dir.path(), &env).unwrap();

    let ctx = load_ctx_from_disk(dir.path(), "dev").unwrap();
    assert_eq!(
        ctx.vars.get("baseUrl"),
        Some(&"https://api.example.com".to_string())
    );
    assert_eq!(ctx.vars.get("apiVersion"), Some(&"v1".to_string()));
    assert!(ctx.secrets.is_empty());
}

fn fixture(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures")
        .join(name)
}

fn load_petstore() -> openapiv3::OpenAPI {
    crate::importers::openapi::load::load_spec(&fixture("petstore-3.0.yaml"))
        .expect("load petstore fixture")
}

// ── router unit tests ────────────────────────────────────────────────────────

#[tokio::test]
async fn mock_router_serves_example_for_listpets() {
    use tower::ServiceExt;
    let spec = load_petstore();
    let router = crate::mock::router::build(&spec);

    let req = http::Request::builder()
        .uri("/pets")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn mock_router_returns_json_body_for_listpets() {
    use axum::body::to_bytes;
    use tower::ServiceExt;

    let spec = load_petstore();
    let router = crate::mock::router::build(&spec);

    let req = http::Request::builder()
        .uri("/pets")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);

    let bytes = to_bytes(resp.into_body(), 1_000_000).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // petstore example for listPets is `[]`
    assert!(body.is_array(), "expected array, got {body:?}");
}

#[tokio::test]
async fn mock_router_404_for_unmapped_path() {
    use tower::ServiceExt;
    let spec = load_petstore();
    let router = crate::mock::router::build(&spec);

    let req = http::Request::builder()
        .uri("/unknown-xyz")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 404);
}

// ── full lifecycle via TCP ───────────────────────────────────────────────────

#[tokio::test]
async fn mock_full_lifecycle_via_tcp() {
    use tokio::net::TcpListener;

    let spec = load_petstore();
    let router = crate::mock::router::build(&spec);

    // Bind on port 0 so the OS picks a free port.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let url = format!("http://127.0.0.1:{port}/pets");
    let resp = reqwest::get(&url).await.unwrap();
    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.is_array(), "expected array from /pets, got {body:?}");

    server.abort();
}

// ── pick_example unit tests ──────────────────────────────────────────────────

#[test]
fn pick_example_returns_inline_example() {
    let spec = load_petstore();
    let path_item = spec.paths.paths.get("/pets").unwrap().as_item().unwrap();
    let op = path_item.get.as_ref().unwrap();
    let example = crate::mock::responses::pick_example(op, &spec);
    // petstore listPets 200 response has `example: []`
    assert!(
        example.is_array(),
        "expected array example, got {example:?}"
    );
}

#[test]
fn pick_example_fallback_null_for_no_response_body() {
    let spec = load_petstore();
    let path_item = spec.paths.paths.get("/pets").unwrap().as_item().unwrap();
    // POST /pets returns 201 with no body content.
    let op = path_item.post.as_ref().unwrap();
    let example = crate::mock::responses::pick_example(op, &spec);
    // No content defined for 201 → Null.
    assert_eq!(example, serde_json::Value::Null);
}

// ── example_from_schema tests ────────────────────────────────────────────────

#[test]
fn example_from_schema_primitives() {
    use openapiv3::{BooleanType, IntegerType, Schema, SchemaData, SchemaKind, StringType, Type};

    let spec = openapiv3::OpenAPI::default();

    let string_schema = Schema {
        schema_data: SchemaData::default(),
        schema_kind: SchemaKind::Type(Type::String(StringType::default())),
    };
    assert_eq!(
        crate::mock::responses::example_from_schema(&string_schema, &spec, 0),
        serde_json::Value::String("string".into())
    );

    let int_schema = Schema {
        schema_data: SchemaData::default(),
        schema_kind: SchemaKind::Type(Type::Integer(IntegerType::default())),
    };
    assert_eq!(
        crate::mock::responses::example_from_schema(&int_schema, &spec, 0),
        serde_json::Value::from(0_i64)
    );

    let bool_schema = Schema {
        schema_data: SchemaData::default(),
        schema_kind: SchemaKind::Type(Type::Boolean(BooleanType::default())),
    };
    assert_eq!(
        crate::mock::responses::example_from_schema(&bool_schema, &spec, 0),
        serde_json::Value::Bool(false)
    );
}

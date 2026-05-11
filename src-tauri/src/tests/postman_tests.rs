use crate::collection::schema::Auth;
use crate::http::types::Method;
use crate::importers::postman::convert::{convert_request, extract_scripts, walk_items};
use crate::importers::postman::env::convert_env;
use crate::importers::postman::schema::{PostmanCollection, PostmanEnv};
use crate::importers::postman::walk::import_collection;

const FIXTURE: &str = include_str!("fixtures/postman-sample-collection.json");

// ─── 1. Schema deserialization ───────────────────────────────────────────────

#[test]
fn parses_collection_with_folder_and_two_requests() {
    let col: PostmanCollection = serde_json::from_str(FIXTURE).expect("parse fixture");

    assert_eq!(col.info.name, "Sample API");
    assert_eq!(col.item.len(), 1, "expected one top-level folder");

    let folder = &col.item[0];
    assert_eq!(folder.name, "Users");
    assert_eq!(folder.item.len(), 2, "expected two requests in folder");

    let get_item = &folder.item[0];
    let post_item = &folder.item[1];

    assert_eq!(get_item.name, "Get User");
    assert!(get_item.request.is_some());

    assert_eq!(post_item.name, "Create User");
    assert!(post_item.request.is_some());
    assert_eq!(post_item.event.len(), 2, "expected 2 events on Create User");
}

// ─── 2. GET request conversion ───────────────────────────────────────────────

#[test]
fn converts_get_request_with_bearer_and_query() {
    let col: PostmanCollection = serde_json::from_str(FIXTURE).expect("parse fixture");
    let get_item = &col.item[0].item[0];
    let pm_req = get_item.request.as_ref().unwrap();

    let mut warnings = Vec::new();
    let req = convert_request("Get User", 1, pm_req, None, None, &mut warnings);

    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");
    assert_eq!(req.method, Method::Get);
    assert_eq!(req.url, "{{baseUrl}}/users/42?expand=profile");
    assert_eq!(req.params.len(), 1);
    assert_eq!(req.params[0].key, "expand");
    assert_eq!(req.params[0].value, "profile");
    assert!(req.params[0].enabled);

    match &req.auth {
        Some(Auth::Bearer { token }) => assert_eq!(token, "{{token}}"),
        other => panic!("expected bearer auth, got {other:?}"),
    }

    assert_eq!(req.headers.len(), 1);
    assert_eq!(req.headers[0].key, "Accept");
}

// ─── 3. Import collection creates file tree ──────────────────────────────────

#[test]
fn import_collection_creates_bru_tree() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures/postman-sample-collection.json");

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path();

    let report = import_collection(&src, dest);

    assert!(report.errors.is_empty(), "errors: {:?}", report.errors);
    assert_eq!(
        report.created.len(),
        2,
        "expected 2 files created; got {:?}",
        report.created
    );

    // Both files should exist under Users/
    let get_path = dest.join("Users").join("Get User.bru");
    let post_path = dest.join("Users").join("Create User.bru");

    assert!(
        get_path.exists(),
        "Get User.bru not found at {}",
        get_path.display()
    );
    assert!(
        post_path.exists(),
        "Create User.bru not found at {}",
        post_path.display()
    );

    // Verify content round-trips back through the bru parser
    let parsed_get = crate::collection::bru::parse(&std::fs::read_to_string(&get_path).unwrap())
        .expect("parse Get User.bru");
    assert_eq!(parsed_get.name, "Get User");
    assert_eq!(parsed_get.method, Method::Get);
}

// ─── 4. Pre-request script preserved ────────────────────────────────────────

#[test]
fn import_collection_preserves_prerequest_script() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures/postman-sample-collection.json");

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path();

    let report = import_collection(&src, dest);
    assert!(report.errors.is_empty(), "errors: {:?}", report.errors);

    let post_path = dest.join("Users").join("Create User.bru");
    let content = std::fs::read_to_string(&post_path).expect("read Create User.bru");

    assert!(
        content.contains("script:pre-request {"),
        "missing script:pre-request block in:\n{content}"
    );
    assert!(
        content.contains("pm.environment.set('timestamp'"),
        "pre-request script body missing in:\n{content}"
    );
    assert!(
        content.contains("script:post-response {"),
        "missing script:post-response block in:\n{content}"
    );
    assert!(
        content.contains("pm.test('status 201'"),
        "post-response script body missing in:\n{content}"
    );
}

// ─── 5. Script extraction helper ────────────────────────────────────────────

#[test]
fn extract_scripts_returns_correct_bodies() {
    let col: PostmanCollection = serde_json::from_str(FIXTURE).expect("parse fixture");
    let post_item = &col.item[0].item[1]; // Create User

    let (pre, post) = extract_scripts(&post_item.event);

    let pre = pre.expect("expected pre-request script");
    let post = post.expect("expected post-response script");

    assert!(
        pre.contains("pm.environment.set('timestamp'"),
        "unexpected pre: {pre}"
    );
    assert!(
        post.contains("pm.test('status 201'"),
        "unexpected post: {post}"
    );
}

// ─── 6. Environment conversion ───────────────────────────────────────────────

#[test]
fn converts_postman_env_to_lancer_env() {
    let json = r#"{
        "name": "staging",
        "values": [
            { "key": "baseUrl", "value": "https://staging.api.example.com", "enabled": true, "type": "default" },
            { "key": "token",   "value": "s3cr3t",                          "enabled": true, "type": "secret"  },
            { "key": "debug",   "value": "true",                            "enabled": false, "type": "default" }
        ]
    }"#;
    let pm_env: PostmanEnv = serde_json::from_str(json).expect("parse env json");
    let env = convert_env(pm_env);

    assert_eq!(env.name, "staging");
    assert_eq!(env.vars.len(), 1, "only enabled non-secret vars");
    assert_eq!(
        env.vars[0],
        ("baseUrl".into(), "https://staging.api.example.com".into())
    );
    assert_eq!(env.secret_names, vec!["token"]);
}

// ─── 7. Walk items flattens folder hierarchy ─────────────────────────────────

#[test]
fn walk_items_flattens_nested_folders() {
    let col: PostmanCollection = serde_json::from_str(FIXTURE).expect("parse fixture");
    let mut leaves = Vec::new();
    walk_items(&col.item, "", &mut leaves);

    assert_eq!(leaves.len(), 2, "expected 2 leaf requests; got {leaves:?}");
    assert_eq!(leaves[0].0, "Users");
    assert_eq!(leaves[0].1.name, "Get User");
    assert_eq!(leaves[1].0, "Users");
    assert_eq!(leaves[1].1.name, "Create User");
}

// ─── 8. Skip-existing behaviour ──────────────────────────────────────────────

#[test]
fn import_collection_skips_existing_files() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures/postman-sample-collection.json");

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path();

    // First import
    let first = import_collection(&src, dest);
    assert_eq!(first.created.len(), 2);
    assert!(first.skipped_existing.is_empty());

    // Second import — both files should be skipped
    let second = import_collection(&src, dest);
    assert!(second.created.is_empty(), "nothing new should be created");
    assert_eq!(second.skipped_existing.len(), 2);
}

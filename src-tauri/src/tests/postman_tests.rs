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
    let pm_req = get_item.resolved_request().unwrap();

    let mut warnings = Vec::new();
    let req = convert_request("Get User", 1, &pm_req, None, None, &mut warnings);

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

    // The importer now wraps each Postman collection in its own folder
    // (collection.info.name = "Sample API" here) so requests land under
    // <dest>/Sample API/Users/ — preserving the "workspace contains many
    // collections" model rather than flattening into the workspace root.
    let get_path = dest.join("Sample API").join("Users").join("Get User.bru");
    let post_path = dest
        .join("Sample API")
        .join("Users")
        .join("Create User.bru");

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

// ─── 3b. Path-traversal defense ──────────────────────────────────────────────

/// A collection containing a folder literally named `..` must not write any
/// file outside the chosen collection directory (CVE-class arbitrary write).
#[test]
fn import_collection_rejects_dotdot_folder_traversal() {
    // Build a collection with a `..` folder holding one request. If the guard
    // is missing, the request would land in <dest_parent>/pwned.bru — outside
    // the per-collection dir entirely.
    let collection = r#"{
      "info": { "name": "Evil", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      "item": [
        {
          "name": "..",
          "item": [
            {
              "name": "pwned",
              "request": { "method": "GET", "url": "https://example.com/" }
            }
          ]
        }
      ]
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    // dest is a *nested* dir so an escape via `..` would surface in `outer`.
    let outer = dir.path();
    let dest = outer.join("workspace");
    std::fs::create_dir_all(&dest).unwrap();

    let col_file = outer.join("evil.json");
    std::fs::write(&col_file, collection).unwrap();

    let report = import_collection(&col_file, &dest);

    // Nothing must be written outside the collection dir (<dest>/Evil).
    // Specifically, no stray `.bru` may appear under `outer` outside `dest`.
    let mut escaped: Vec<std::path::PathBuf> = Vec::new();
    for entry in walkdir::WalkDir::new(outer)
        .into_iter()
        .filter_map(Result::ok)
    {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|e| e.to_str()) == Some("bru") {
            // Allowed location: under <dest>/Evil/...
            let collection_dir = dest.join("Evil");
            if !p.starts_with(&collection_dir) {
                escaped.push(p.to_path_buf());
            }
        }
    }
    assert!(
        escaped.is_empty(),
        "path traversal wrote files outside collection dir: {escaped:?}"
    );
    // The unsafe segment must be reported, not silently dropped.
    assert!(
        report.created.is_empty(),
        "no request should have been written; created={:?}",
        report.created
    );
    assert!(
        report.warnings.iter().any(|w| w.contains("unsafe segment")),
        "expected an 'unsafe segment' warning; warnings={:?}",
        report.warnings
    );
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

    let post_path = dest
        .join("Sample API")
        .join("Users")
        .join("Create User.bru");
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

// ─── 8. Re-import creates a new sibling folder ───────────────────────────────
//
// Each import targets its own `<collection-name>/` sub-folder, so a second
// run with the same source creates `Sample API (2)/` instead of trying to
// overwrite. This matches Postman's own behaviour (re-importing the same
// collection just gets a numbered duplicate) and is safer than silently
// merging or refusing.

#[test]
fn import_collection_re_imports_into_numbered_sibling() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures/postman-sample-collection.json");

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path();

    let first = import_collection(&src, dest);
    assert_eq!(first.created.len(), 2);
    assert!(first.skipped_existing.is_empty());
    assert!(dest.join("Sample API").exists());

    let second = import_collection(&src, dest);
    assert_eq!(second.created.len(), 2, "re-import should create new files");
    assert!(
        dest.join("Sample API (2)").exists(),
        "expected numbered sibling for re-import"
    );
}

// ─── 9. String-shorthand request + deeply nested folder ──────────────────────
//
// Regression for "import came in incomplete with no explanation". Two failure
// modes are covered:
//   (a) `"request": "https://…"` (bare URL shorthand) must import as a GET,
//       not break the parse or get silently dropped.
//   (b) a request buried several folder levels deep must still be created
//       (recursion is unbounded in depth).

#[test]
fn import_collection_handles_shorthand_and_deep_nesting() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures/postman-shorthand-and-nested.json");

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path();

    let report = import_collection(&src, dest);
    assert!(report.errors.is_empty(), "errors: {:?}", report.errors);
    assert_eq!(
        report.created.len(),
        2,
        "expected both shorthand + deeply-nested requests; got {:?}",
        report.created
    );

    // (a) shorthand → GET at the collection root
    let ping_path = dest.join("Edge Cases").join("Ping.bru");
    assert!(
        ping_path.exists(),
        "shorthand request not created at {}",
        ping_path.display()
    );
    let ping = crate::collection::bru::parse(&std::fs::read_to_string(&ping_path).unwrap())
        .expect("parse Ping.bru");
    assert_eq!(ping.method, Method::Get, "shorthand should default to GET");
    assert_eq!(ping.url, "https://api.example.com/ping");

    // (b) deeply nested request mirrors the folder tree on disk
    let deep_path = dest
        .join("Edge Cases")
        .join("Level1")
        .join("Level2")
        .join("Level3")
        .join("Deep Request.bru");
    assert!(
        deep_path.exists(),
        "deeply nested request not created at {}",
        deep_path.display()
    );
}

// ─── 10. Malformed leaf is warned about, never silently dropped ──────────────
//
// A node with neither a `request` nor child `item`s used to be mistaken for an
// empty folder and vanish without a trace. It must now surface a warning so
// the import report explains every missing item.

#[test]
fn import_collection_warns_on_item_without_request() {
    let json = r#"{
        "info": { "name": "Has Empty", "schema": "v2.1" },
        "item": [
            { "name": "Good", "request": "https://api.example.com/ok" },
            { "name": "Broken" }
        ]
    }"#;

    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("col.json");
    std::fs::write(&file, json).unwrap();

    let report = import_collection(&file, dir.path());

    assert_eq!(report.created.len(), 1, "only the valid request imports");
    assert!(
        report.warnings.iter().any(|w| w.contains("Broken")),
        "expected a warning naming the skipped item; warnings: {:?}",
        report.warnings
    );
}

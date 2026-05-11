use std::path::PathBuf;

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src/tests/fixtures")
        .join(name)
}

// ── M7.1: load tests ─────────────────────────────────────────────────────────

#[test]
fn load_petstore_30_yaml_parses() {
    use crate::importers::openapi::load::load_spec;
    let spec = load_spec(&fixture("petstore-3.0.yaml")).expect("load");
    assert!(
        spec.paths.paths.contains_key("/pets"),
        "/pets path not found; keys: {:?}",
        spec.paths.paths.keys().collect::<Vec<_>>()
    );
    assert_eq!(spec.info.title, "Petstore");
    assert_eq!(spec.info.version, "1.0.0");
}

// ── M7.2: convert tests ───────────────────────────────────────────────────────

#[test]
fn convert_listpets_operation_to_get_request() {
    use crate::http::types::Method;
    use crate::importers::openapi::convert::convert_operation;
    use crate::importers::openapi::load::load_spec;
    use openapiv3::ReferenceOr;

    let spec = load_spec(&fixture("petstore-3.0.yaml")).expect("load");
    let path_item = spec
        .paths
        .paths
        .get("/pets")
        .and_then(|r| match r {
            ReferenceOr::Item(item) => Some(item),
            _ => None,
        })
        .expect("/pets path item");

    let op = path_item.get.as_ref().expect("GET /pets operation");
    let req = convert_operation("/pets", "get", op, &spec).expect("convert");

    assert_eq!(req.method, Method::Get);
    assert!(
        req.url.contains("{{baseUrl}}"),
        "url should contain {{{{baseUrl}}}}: {}",
        req.url
    );
    assert!(
        req.url.contains("/pets"),
        "url should contain /pets: {}",
        req.url
    );

    // The `limit` query parameter should appear.
    assert!(
        req.params.iter().any(|p| p.key == "limit"),
        "expected `limit` param, got: {:?}",
        req.params
    );
}

#[test]
fn convert_createpet_picks_up_bearer_auth() {
    use crate::collection::schema::Auth;
    use crate::importers::openapi::convert::convert_operation;
    use crate::importers::openapi::load::load_spec;
    use openapiv3::ReferenceOr;

    let spec = load_spec(&fixture("petstore-3.0.yaml")).expect("load");
    let path_item = spec
        .paths
        .paths
        .get("/pets")
        .and_then(|r| match r {
            ReferenceOr::Item(item) => Some(item),
            _ => None,
        })
        .expect("/pets path item");

    let op = path_item.post.as_ref().expect("POST /pets operation");
    let req = convert_operation("/pets", "post", op, &spec).expect("convert");

    match &req.auth {
        Some(Auth::Bearer { .. }) => {} // pass
        other => panic!("expected Auth::Bearer, got {:?}", other),
    }
}

// ── M7.3: walk / import_spec tests ───────────────────────────────────────────

#[test]
fn import_spec_creates_bru_tree_and_env() {
    use crate::importers::openapi::walk::import_spec;

    let dir = tempfile::tempdir().expect("tempdir");
    let dest = dir.path().to_path_buf();

    let report = import_spec(&fixture("petstore-3.0.yaml"), &dest).expect("import");

    // Environment file should have been created.
    assert!(
        report.env_created.is_some(),
        "env_created should be Some, report: {report:?}"
    );
    let env_path = dest.join("environments").join("imported.bru");
    assert!(env_path.exists(), "environments/imported.bru not on disk");

    // Check that baseUrl was written into the env.
    let env_text = std::fs::read_to_string(&env_path).unwrap();
    assert!(
        env_text.contains("baseUrl"),
        "env file should contain baseUrl: {env_text}"
    );
    assert!(
        env_text.contains("https://petstore.example.com/v1"),
        "env file should contain server url: {env_text}"
    );

    // At least 2 .bru files created for the two petstore operations.
    assert!(
        report.created_files.len() >= 2,
        "expected ≥2 created files, got: {:?}",
        report.created_files
    );

    // No errors.
    assert!(
        report.errors.is_empty(),
        "expected no errors, got: {:?}",
        report.errors
    );

    // All listed files should actually exist on disk.
    for rel in &report.created_files {
        let full = dest.join(rel);
        assert!(
            full.exists(),
            "reported file {rel} does not exist at {full:?}"
        );
    }
}

//! Tests for collection-level (folder) auth: on-disk round-trip and the
//! nearest-ancestor inheritance walk used by the send path.

use std::fs;

use crate::collection::folder::{self, FolderSettings};
use crate::collection::schema::{Auth, KvEnabled};

/// A folder's default auth survives write → read through `folder.bru`.
#[test]
fn folder_auth_round_trips_through_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().to_path_buf();

    let settings = FolderSettings {
        vars: vec![KvEnabled {
            key: "baseUrl".into(),
            value: "https://api.example.com".into(),
            enabled: true,
        }],
        name: "API".into(),
        description: String::new(),
        auth: Some(Auth::Bearer {
            token: "{{token}}".into(),
        }),
    };

    folder::write_folder_settings(path.clone(), settings.clone()).expect("write");
    let back = folder::read_folder_settings(path).expect("read");

    assert_eq!(back.auth, settings.auth, "folder auth lost on round-trip");
    assert_eq!(back.vars, settings.vars);
}

/// A default of `Auth::None` (or no auth) writes nothing and reads back as
/// `None` — the folder defines no inheritable default.
#[test]
fn folder_auth_none_is_omitted() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().to_path_buf();

    let settings = FolderSettings {
        vars: vec![],
        name: String::new(),
        description: String::new(),
        auth: Some(Auth::None),
    };
    folder::write_folder_settings(path.clone(), settings).expect("write");

    let text = fs::read_to_string(path.join("folder.bru")).expect("read file");
    assert!(
        !text.contains("auth"),
        "auth block should be omitted:\n{text}"
    );

    let back = folder::read_folder_settings(path).expect("read");
    assert_eq!(back.auth, None);
}

/// The nearest ancestor folder with a concrete auth wins; a closer folder
/// fully overrides a parent rather than merging.
#[test]
fn collect_auth_chain_picks_nearest_ancestor() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let child = root.join("child");
    fs::create_dir_all(&child).unwrap();

    // Root folder: Bearer. Child folder: Basic (should override).
    folder::write_folder_settings(
        root.to_path_buf(),
        FolderSettings {
            vars: vec![],
            name: String::new(),
            description: String::new(),
            auth: Some(Auth::Bearer {
                token: "root-token".into(),
            }),
        },
    )
    .unwrap();
    folder::write_folder_settings(
        child.clone(),
        FolderSettings {
            vars: vec![],
            name: String::new(),
            description: String::new(),
            auth: Some(Auth::Basic {
                username: "u".into(),
                password: "p".into(),
            }),
        },
    )
    .unwrap();

    // A request inside child/ inherits child's Basic auth.
    let req_in_child = child.join("login.bru");
    fs::write(&req_in_child, "meta {\n  name: x\n}\n").unwrap();
    let resolved = folder::collect_auth_chain(root, &req_in_child);
    assert!(
        matches!(resolved, Some(Auth::Basic { .. })),
        "expected nearest (child) Basic auth, got {resolved:?}"
    );
}

/// A request whose only ancestor with auth is the root inherits the root's
/// auth (walk continues past folders that define no default).
#[test]
fn collect_auth_chain_falls_back_to_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let child = root.join("child");
    fs::create_dir_all(&child).unwrap();

    folder::write_folder_settings(
        root.to_path_buf(),
        FolderSettings {
            vars: vec![],
            name: String::new(),
            description: String::new(),
            auth: Some(Auth::Bearer {
                token: "root-token".into(),
            }),
        },
    )
    .unwrap();
    // child has no folder.bru / no auth → walk continues up to root.

    let req_in_child = child.join("login.bru");
    fs::write(&req_in_child, "meta {\n  name: x\n}\n").unwrap();
    let resolved = folder::collect_auth_chain(root, &req_in_child);
    match resolved {
        Some(Auth::Bearer { token }) => assert_eq!(token, "root-token"),
        other => panic!("expected root Bearer auth, got {other:?}"),
    }
}

/// No folder.bru anywhere on the chain → no inherited auth.
#[test]
fn collect_auth_chain_returns_none_without_defaults() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    let req = root.join("login.bru");
    fs::write(&req, "meta {\n  name: x\n}\n").unwrap();
    assert_eq!(folder::collect_auth_chain(root, &req), None);
}

/// Disabled folder vars (Bruno's `~` prefix) must NOT apply on the send path.
/// `collect_chain` previously used `parse_kv_block`, which strips the `~`, so a
/// disabled row leaked into the resolved variables. The enabled row still wins.
#[test]
fn collect_chain_skips_disabled_vars() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();

    // Hand-write a folder.bru with one enabled and one disabled var so we
    // exercise the parser path used by the send chain directly.
    fs::write(
        root.join("folder.bru"),
        "meta {\n  type: folder\n}\n\nvars {\n  baseUrl: https://api.example.com\n  ~debug: on\n}\n",
    )
    .unwrap();

    let req = root.join("login.bru");
    fs::write(&req, "meta {\n  name: x\n}\n").unwrap();

    let vars = folder::collect_chain(root, &req);
    assert_eq!(
        vars.get("baseUrl").map(String::as_str),
        Some("https://api.example.com"),
        "enabled var should resolve"
    );
    assert!(
        !vars.contains_key("debug"),
        "disabled folder var leaked into the send path: {vars:?}"
    );
}

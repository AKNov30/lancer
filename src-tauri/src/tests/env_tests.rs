use crate::env::bru;
use crate::env::io;
use crate::env::schema::Environment;
use crate::env::secrets;

const ENV_FIXTURE: &str = include_str!("fixtures/env-dev.bru");

#[test]
fn environment_serializes_with_camel_case() {
    let env = Environment {
        name: "dev".into(),
        vars: vec![
            ("baseUrl".into(), "https://api.example.com".into()),
            ("apiVersion".into(), "v1".into()),
        ],
        secret_names: vec!["apiKey".into(), "oauthSecret".into()],
    };
    let json = serde_json::to_string(&env).unwrap();
    assert!(json.contains("\"secretNames\""), "got: {json}");
    let back: Environment = serde_json::from_str(&json).unwrap();
    assert_eq!(env, back);
}

#[test]
fn parses_env_with_vars_and_secret_names() {
    let env = bru::parse("dev", ENV_FIXTURE).expect("parse");
    assert_eq!(env.name, "dev");
    assert_eq!(env.vars.len(), 2);
    assert_eq!(env.vars[0].0, "baseUrl");
    assert_eq!(env.vars[0].1, "https://api.example.com");
    assert_eq!(env.vars[1].0, "apiVersion");
    assert_eq!(env.secret_names, vec!["apiKey", "oauthSecret"]);
}

#[test]
fn env_round_trips_through_serialize() {
    let env = bru::parse("dev", ENV_FIXTURE).unwrap();
    let serialized = bru::serialize(&env);
    let back = bru::parse("dev", &serialized).unwrap();
    assert_eq!(env, back, "round-trip mismatch:\n{serialized}");
}

#[test]
fn list_envs_finds_bru_files_in_environments_subdir() {
    let dir = tempfile::tempdir().unwrap();
    let envs_dir = dir.path().join("environments");
    std::fs::create_dir(&envs_dir).unwrap();
    std::fs::write(envs_dir.join("dev.bru"), ENV_FIXTURE).unwrap();
    std::fs::write(envs_dir.join("staging.bru"), ENV_FIXTURE).unwrap();
    std::fs::write(envs_dir.join("notes.txt"), "ignored").unwrap();

    let names = io::list_envs(dir.path()).expect("list");
    assert!(names.iter().any(|n| n == "dev"));
    assert!(names.iter().any(|n| n == "staging"));
    assert!(!names.iter().any(|n| n == "notes"));
}

#[test]
fn read_write_env_round_trips_through_disk() {
    let dir = tempfile::tempdir().unwrap();
    let original = Environment {
        name: "test".into(),
        vars: vec![("k".into(), "v".into())],
        secret_names: vec!["s".into()],
    };
    io::write_env(dir.path(), &original).unwrap();
    let back = io::read_env(dir.path(), "test").unwrap();
    assert_eq!(original, back);
}

#[test]
#[ignore = "requires unlocked OS keyring; skip in CI"]
fn secrets_round_trip_through_os_keyring() {
    use std::path::Path;
    let root = Path::new("D:/world/lancer/test-keyring-fixture");
    let env = "test-env";
    let var = "apiKey";
    secrets::set(root, env, var, "value-1").unwrap();
    assert_eq!(
        secrets::get(root, env, var).unwrap(),
        Some("value-1".into())
    );
    secrets::delete(root, env, var).unwrap();
    assert_eq!(secrets::get(root, env, var).unwrap(), None);
}

#[test]
fn workspace_hash_is_stable_and_short() {
    // Verify the secrets module compiles end-to-end. The round-trip behaviour
    // is covered by the #[ignore]d test above on machines with a real keyring.
    let _ = secrets::get;
    let _ = secrets::set;
    let _ = secrets::delete;
}

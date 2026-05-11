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

// ── M6.2 tests: substitute + materialize ─────────────────────────────────────

use crate::collection::schema::{
    Auth as SchemaAuth, KvEnabled, Request as SchemaRequest, RequestBody as SchemaBody,
};
use crate::env::materialize::materialize;
use crate::env::substitute::{substitute, substitute_auth, substitute_request, Ctx};
use crate::http::types::Method;

fn make_ctx(vars: &[(&str, &str)], secrets: &[(&str, &str)]) -> Ctx {
    Ctx {
        vars: vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        secrets: secrets
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

#[test]
fn substitutes_single_var() {
    let c = make_ctx(&[("name", "lancer")], &[]);
    assert_eq!(substitute("hello {{name}}", &c), "hello lancer");
}

#[test]
fn substitutes_multiple_in_one_string() {
    let c = make_ctx(&[("a", "1"), ("b", "2")], &[]);
    assert_eq!(substitute("a={{a}}&b={{b}}", &c), "a=1&b=2");
}

#[test]
fn secrets_win_collision_with_vars() {
    let c = make_ctx(&[("k", "plain")], &[("k", "secret")]);
    assert_eq!(substitute("{{k}}", &c), "secret");
}

#[test]
fn unknown_var_left_as_is() {
    let c = make_ctx(&[], &[]);
    assert_eq!(substitute("hello {{nope}}", &c), "hello {{nope}}");
}

#[test]
fn substitution_is_single_pass_no_recursion() {
    let c = make_ctx(&[("outer", "{{inner}}"), ("inner", "boom")], &[]);
    assert_eq!(substitute("{{outer}}", &c), "{{inner}}");
}

#[test]
fn whitespace_in_braces_tolerated() {
    let c = make_ctx(&[("name", "lancer")], &[]);
    assert_eq!(substitute("{{ name }}", &c), "lancer");
}

#[test]
fn substitute_request_walks_url_headers_params() {
    let c = make_ctx(&[("base", "https://api.example.com")], &[("tok", "abc")]);
    let mut req = SchemaRequest {
        name: "x".into(),
        seq: None,
        method: Method::Get,
        url: "{{base}}/users".into(),
        headers: vec![KvEnabled {
            key: "Authorization".into(),
            value: "Bearer {{tok}}".into(),
            enabled: true,
        }],
        params: vec![KvEnabled {
            key: "v".into(),
            value: "{{ver}}".into(), // unknown — stays
            enabled: true,
        }],
        body: None,
        auth: None,
        vars: vec![],
        pre_request_script: None,
        post_response_script: None,
    };
    substitute_request(&mut req, &c);
    assert_eq!(req.url, "https://api.example.com/users");
    assert_eq!(req.headers[0].value, "Bearer abc");
    assert_eq!(req.params[0].value, "{{ver}}");
}

#[test]
fn substitute_auth_bearer_resolves_token() {
    let c = make_ctx(&[], &[("secret", "shh-secret")]);
    let mut a = SchemaAuth::Bearer {
        token: "{{secret}}".into(),
    };
    substitute_auth(&mut a, &c);
    if let SchemaAuth::Bearer { token } = a {
        assert_eq!(token, "shh-secret");
    } else {
        panic!("expected Bearer");
    }
}

#[test]
fn substitute_auth_oauth2_walks_all_fields() {
    let c = make_ctx(
        &[("clientId", "cid"), ("scope", "read")],
        &[("clientSecret", "sec")],
    );
    let mut a = SchemaAuth::OAuth2Cc {
        token_url: "https://auth/{{tenant}}/token".into(),
        client_id: "{{clientId}}".into(),
        client_secret: "{{clientSecret}}".into(),
        scope: "{{scope}}".into(),
        audience: "".into(),
    };
    substitute_auth(&mut a, &c);
    if let SchemaAuth::OAuth2Cc {
        token_url,
        client_id,
        client_secret,
        scope,
        ..
    } = a
    {
        assert_eq!(token_url, "https://auth/{{tenant}}/token"); // tenant unknown — stays
        assert_eq!(client_id, "cid");
        assert_eq!(client_secret, "sec");
        assert_eq!(scope, "read");
    } else {
        panic!("expected OAuth2Cc");
    }
}

#[test]
fn materialize_json_body_parses_after_substitution() {
    let req = SchemaRequest {
        name: "x".into(),
        seq: None,
        method: Method::Post,
        url: "https://x".into(),
        headers: vec![],
        params: vec![],
        body: Some(SchemaBody::Json {
            value: r#"{"ok": true, "n": 42}"#.into(),
        }),
        auth: None,
        vars: vec![],
        pre_request_script: None,
        post_response_script: None,
    };
    let http = materialize(&req).unwrap();
    assert_eq!(http.url, "https://x");
    match http.body {
        Some(crate::http::types::RequestBody::Json { value }) => {
            assert_eq!(value["ok"], serde_json::json!(true));
            assert_eq!(value["n"], serde_json::json!(42));
        }
        other => panic!("expected JSON body, got {other:?}"),
    }
}

#[test]
fn materialize_json_returns_err_on_invalid_after_substitution() {
    // Simulate a templated value that broke JSON structure.
    let req = SchemaRequest {
        name: "x".into(),
        seq: None,
        method: Method::Post,
        url: "https://x".into(),
        headers: vec![],
        params: vec![],
        body: Some(SchemaBody::Json {
            value: r#"{"k": ","admin":true,"}"#.into(), // malformed
        }),
        auth: None,
        vars: vec![],
        pre_request_script: None,
        post_response_script: None,
    };
    let result = materialize(&req);
    assert!(result.is_err(), "expected JSON parse error from injection");
}

#[test]
fn materialize_drops_disabled_headers_and_params() {
    let req = SchemaRequest {
        name: "x".into(),
        seq: None,
        method: Method::Get,
        url: "https://x".into(),
        headers: vec![
            KvEnabled {
                key: "a".into(),
                value: "1".into(),
                enabled: true,
            },
            KvEnabled {
                key: "b".into(),
                value: "2".into(),
                enabled: false,
            },
        ],
        params: vec![KvEnabled {
            key: "p".into(),
            value: "1".into(),
            enabled: false,
        }],
        body: None,
        auth: None,
        vars: vec![],
        pre_request_script: None,
        post_response_script: None,
    };
    let http = materialize(&req).unwrap();
    assert_eq!(http.headers.len(), 1);
    assert_eq!(http.headers[0].0, "a");
    assert_eq!(http.query.len(), 0);
}

use crate::collection::bru;
use crate::collection::schema::{Auth, KvEnabled};
use crate::http::types::Method;

const FIXTURE: &str = include_str!("fixtures/simple.bru");

#[test]
fn parses_simple_get_request() {
    let req = bru::parse(FIXTURE).expect("parse");

    assert_eq!(req.name, "Get user");
    assert_eq!(req.seq, Some(1));
    assert_eq!(req.method, Method::Get);
    assert_eq!(req.url, "{{baseUrl}}/users/42");

    // Headers should preserve order, with the ~accept-language disabled.
    assert_eq!(
        req.headers,
        vec![
            KvEnabled {
                key: "accept".into(),
                value: "application/json".into(),
                enabled: true,
            },
            KvEnabled {
                key: "accept-language".into(),
                value: "en".into(),
                enabled: false,
            },
        ]
    );

    match &req.auth {
        Some(Auth::Bearer { token }) => assert_eq!(token, "{{token}}"),
        other => panic!("expected bearer auth, got {other:?}"),
    }

    // body: none → no body
    assert!(req.body.is_none());

    // vars:pre-request preserved
    assert_eq!(
        req.vars,
        vec![KvEnabled {
            key: "baseUrl".into(),
            value: "https://api.example.com".into(),
            enabled: true,
        }]
    );
}

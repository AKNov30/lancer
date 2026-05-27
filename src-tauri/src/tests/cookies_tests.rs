use std::sync::Arc;

use reqwest_cookie_store::CookieStoreMutex;

use crate::commands::cookies::{
    clear_cookies_in, delete_cookie_in, list_cookies_in, set_cookie_in,
};

fn jar() -> Arc<CookieStoreMutex> {
    Arc::new(CookieStoreMutex::default())
}

#[test]
fn set_then_list_shows_cookie() {
    let jar = jar();
    set_cookie_in(
        &jar,
        "example.com".into(),
        "session".into(),
        "abc123".into(),
        "/".into(),
        true,
        true,
    )
    .expect("set_cookie should succeed");

    let cookies = list_cookies_in(&jar);
    assert_eq!(cookies.len(), 1, "expected exactly one cookie");
    let c = &cookies[0];
    assert_eq!(c.domain, "example.com");
    assert_eq!(c.name, "session");
    assert_eq!(c.value, "abc123");
    assert_eq!(c.path, "/");
    assert!(c.secure, "secure flag should round-trip");
    assert!(c.http_only, "http_only flag should round-trip");
}

#[test]
fn set_same_key_updates_value() {
    let jar = jar();
    set_cookie_in(
        &jar,
        "example.com".into(),
        "token".into(),
        "old".into(),
        "/".into(),
        false,
        false,
    )
    .unwrap();
    set_cookie_in(
        &jar,
        "example.com".into(),
        "token".into(),
        "new".into(),
        "/".into(),
        false,
        false,
    )
    .unwrap();

    let cookies = list_cookies_in(&jar);
    assert_eq!(cookies.len(), 1, "same (domain,path,name) must overwrite");
    assert_eq!(cookies[0].value, "new");
}

#[test]
fn delete_removes_cookie() {
    let jar = jar();
    set_cookie_in(
        &jar,
        "example.com".into(),
        "session".into(),
        "abc123".into(),
        "/".into(),
        false,
        false,
    )
    .unwrap();
    assert_eq!(list_cookies_in(&jar).len(), 1);

    delete_cookie_in(&jar, "example.com", "session", "/");
    assert!(
        list_cookies_in(&jar).is_empty(),
        "cookie should be gone after delete"
    );
}

#[test]
fn clear_empties_jar() {
    let jar = jar();
    set_cookie_in(
        &jar,
        "a.com".into(),
        "x".into(),
        "1".into(),
        "/".into(),
        false,
        false,
    )
    .unwrap();
    set_cookie_in(
        &jar,
        "b.com".into(),
        "y".into(),
        "2".into(),
        "/".into(),
        false,
        false,
    )
    .unwrap();
    assert_eq!(list_cookies_in(&jar).len(), 2);

    clear_cookies_in(&jar);
    assert!(list_cookies_in(&jar).is_empty());
}

#[test]
fn empty_name_is_rejected() {
    let jar = jar();
    let res = set_cookie_in(
        &jar,
        "example.com".into(),
        "  ".into(),
        "v".into(),
        "/".into(),
        false,
        false,
    );
    assert!(res.is_err(), "blank cookie name must be rejected");
}

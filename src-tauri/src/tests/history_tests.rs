use crate::history::store::HistoryDb;

#[test]
fn record_and_list_round_trip() {
    let db = HistoryDb::open_in_memory().unwrap();
    db.record(
        "https://x",
        "GET",
        200,
        12,
        100,
        &[("content-type".into(), "application/json".into())],
        Some(r#"{"ok":true}"#),
    )
    .unwrap();
    let list = db.list(10).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].url, "https://x");
    assert_eq!(list[0].status, 200);
}

#[test]
fn record_redacts_sensitive_headers() {
    let db = HistoryDb::open_in_memory().unwrap();
    db.record(
        "https://x",
        "POST",
        200,
        1,
        1,
        &[
            ("Authorization".into(), "Bearer abc".into()),
            ("X-API-Key".into(), "secret".into()),
            ("Cookie".into(), "session=xyz".into()),
            ("Content-Type".into(), "text/plain".into()),
        ],
        None,
    )
    .unwrap();
    let entry = &db.list(1).unwrap()[0];
    let parsed: Vec<(String, String)> = serde_json::from_str(&entry.headers_json).unwrap();
    let auth = parsed.iter().find(|(k, _)| k == "Authorization").unwrap();
    assert_eq!(auth.1, "[redacted]");
    let key = parsed.iter().find(|(k, _)| k == "X-API-Key").unwrap();
    assert_eq!(key.1, "[redacted]");
    let cookie = parsed.iter().find(|(k, _)| k == "Cookie").unwrap();
    assert_eq!(cookie.1, "[redacted]");
    let ct = parsed.iter().find(|(k, _)| k == "Content-Type").unwrap();
    assert_eq!(ct.1, "text/plain");
}

#[test]
fn record_caps_at_500() {
    let db = HistoryDb::open_in_memory().unwrap();
    for i in 0..510 {
        db.record(&format!("https://x/{i}"), "GET", 200, 1, 1, &[], None)
            .unwrap();
    }
    let list = db.list(1000).unwrap();
    assert_eq!(list.len(), 500);
    // most-recent first
    assert!(list[0].url.contains("/509"));
}

#[test]
fn clear_empties_table() {
    let db = HistoryDb::open_in_memory().unwrap();
    db.record("https://x", "GET", 200, 1, 1, &[], None).unwrap();
    db.clear().unwrap();
    assert!(db.list(10).unwrap().is_empty());
}

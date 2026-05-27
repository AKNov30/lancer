//! Real-time streaming connections: Server-Sent Events (SSE) and WebSocket.
//!
//! Both transports stream incrementally to the webview via a Tauri v2
//! [`Channel`], the idiomatic way to push ordered events to the frontend
//! without the overhead of the global event bus. Each `*_connect` command
//! returns a `connection_id`; the frontend uses that id to `ws_send` /
//! `disconnect`. Active connections are tracked in [`AppState::connections`]
//! so those follow-up commands can find the right task to drive or stop.
//!
//! Lifecycle: connect spawns a background tokio task that owns the socket and
//! forwards frames into the channel. A `shutdown` oneshot lets `disconnect`
//! (or a connection-error/close) tear the task down; the task also removes
//! itself from the registry on exit so the map never leaks stale handles.

use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::{mpsc, oneshot};

use crate::http::sse::SseParser;
use crate::state::AppState;

/// One message pushed to the frontend over the connection's channel.
///
/// `kind` discriminates the event:
///   - `open`    — connection established (WS handshake completed)
///   - `message` — data received from the server (SSE event / WS frame)
///   - `sent`    — echo of a message we sent (WS only), for the local log
///   - `close`   — connection closed (clean or remote)
///   - `error`   — transport/protocol error; the connection is finished
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamMsg {
    pub kind: String,
    /// Payload text. For SSE `message`, the `data` field; for WS, the frame
    /// text; for `open`/`close`/`error`, a human-readable detail.
    pub data: String,
    /// SSE event name (e.g. `ping`), when present. `None` for WS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// SSE last-event-id, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Unix epoch milliseconds when this message was produced.
    pub ts: u128,
}

impl StreamMsg {
    fn now(kind: &str, data: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            data: data.into(),
            event: None,
            id: None,
            ts: now_ms(),
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// A live connection handle stored in the registry.
///
/// `shutdown` signals the owning task to stop. `outbound` is `Some` only for
/// WebSocket connections — it forwards text the user wants to send into the
/// socket-owning task. SSE is receive-only, so its `outbound` is `None`.
pub struct Connection {
    shutdown: Option<oneshot::Sender<()>>,
    outbound: Option<mpsc::UnboundedSender<String>>,
}

impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("has_outbound", &self.outbound.is_some())
            .finish_non_exhaustive()
    }
}

/// Build a `Cookie:` header value for a WebSocket URL from the shared jar, so
/// the WS handshake carries the same cookies as HTTP/SSE. The jar matches on
/// the HTTP(S) scheme, so `ws://`→`http://` and `wss://`→`https://` before
/// looking up. Returns `None` when no cookies match or the URL can't be parsed.
fn cookie_header_for_ws(state: &AppState, ws_url: &str) -> Option<String> {
    let http_url = if let Some(rest) = ws_url.strip_prefix("wss://") {
        format!("https://{rest}")
    } else if let Some(rest) = ws_url.strip_prefix("ws://") {
        format!("http://{rest}")
    } else {
        ws_url.to_string()
    };
    let url = url::Url::parse(&http_url).ok()?;
    let store = state.cookie_jar.lock().unwrap_or_else(|e| e.into_inner());
    let pairs: Vec<String> = store
        .get_request_values(&url)
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    if pairs.is_empty() {
        None
    } else {
        Some(pairs.join("; "))
    }
}

/// Build a reqwest header map from `(name, value)` pairs, skipping any that
/// fail to parse rather than aborting the whole connection.
fn build_headers(headers: &[(String, String)]) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut map = HeaderMap::new();
    for (k, v) in headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(k.as_bytes()),
            HeaderValue::from_str(v),
        ) {
            map.insert(name, value);
        }
    }
    map
}

/// Open an SSE connection. Streams the response body, parses SSE frames, and
/// emits each as a [`StreamMsg`]. Returns the connection id.
#[tauri::command]
pub async fn sse_connect(
    url: String,
    headers: Vec<(String, String)>,
    on_event: Channel<StreamMsg>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let id = uuid_like();
    let client = state.http_client();
    let mut header_map = build_headers(&headers);
    header_map.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("text/event-stream"),
    );

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let connections = state.connections.clone();

    // Kick off the request before spawning so we can surface connect errors
    // synchronously to the caller (bad URL, refused, non-2xx, etc.).
    let resp = client
        .get(&url)
        .headers(header_map)
        // SSE streams stay open indefinitely; disable the per-request timeout
        // inherited from the shared client so it isn't killed after 30s.
        .timeout(std::time::Duration::from_secs(60 * 60 * 24))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("server returned status {}", resp.status()));
    }

    let _ = on_event.send(StreamMsg::now("open", format!("connected to {url}")));

    connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            id.clone(),
            Connection {
                shutdown: Some(shutdown_tx),
                outbound: None,
            },
        );

    let task_id = id.clone();
    tokio::spawn(async move {
        let mut parser = SseParser::new();
        let mut stream = resp.bytes_stream();
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    let _ = on_event.send(StreamMsg::now("close", "disconnected"));
                    break;
                }
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            for ev in parser.feed(&bytes) {
                                let _ = on_event.send(StreamMsg {
                                    kind: "message".to_string(),
                                    data: ev.data,
                                    event: if ev.event.is_empty() { None } else { Some(ev.event) },
                                    id: ev.id,
                                    ts: now_ms(),
                                });
                            }
                        }
                        Some(Err(e)) => {
                            let _ = on_event.send(StreamMsg::now("error", e.to_string()));
                            break;
                        }
                        None => {
                            let _ = on_event.send(StreamMsg::now("close", "stream ended"));
                            break;
                        }
                    }
                }
            }
        }
        drop_connection_arc(&connections, &task_id);
    });

    Ok(id)
}

/// Open a WebSocket connection. Emits `open`/`message`/`sent`/`close`/`error`
/// events over the channel. Returns the connection id, which is used with
/// [`ws_send`] and [`disconnect`].
#[tauri::command]
pub async fn ws_connect(
    url: String,
    headers: Vec<(String, String)>,
    on_event: Channel<StreamMsg>,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::header::COOKIE;
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::tungstenite::Message;

    let id = uuid_like();

    // Build the handshake request with the user's custom headers.
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| e.to_string())?;
    {
        let req_headers = request.headers_mut();
        for (k, v) in &headers {
            if let (Ok(name), Ok(value)) = (
                k.parse::<tokio_tungstenite::tungstenite::http::HeaderName>(),
                HeaderValue::from_str(v),
            ) {
                req_headers.insert(name, value);
            }
        }

        // Attach matching cookies from the shared jar so WS handshakes carry
        // the same session as HTTP/SSE (asymmetry fix). Cookie matching keys on
        // the HTTP(S) scheme, so map ws→http / wss→https before looking up.
        // A user-supplied `Cookie` header (set above) takes precedence and is
        // left untouched.
        if !req_headers.contains_key(COOKIE) {
            if let Some(cookie_header) = cookie_header_for_ws(&state, &url) {
                if let Ok(value) = HeaderValue::from_str(&cookie_header) {
                    req_headers.insert(COOKIE, value);
                }
            }
        }
    }

    // PROXY LIMITATION: the WS handshake below goes straight out via
    // `connect_async`, bypassing the proxy configured in app settings. Threading
    // a proxy through the raw tungstenite handshake would require manually
    // dialing the proxy (HTTP CONNECT / SOCKS) and handing tungstenite the
    // resulting stream, which the current deps (`tokio-tungstenite` without a
    // proxy connector) don't support cleanly. Rather than half-implement it,
    // WebSocket connections are intentionally left proxy-unaware for now; SSE
    // and HTTP still honour the proxy via the shared reqwest client.

    // Connect now so a failed handshake is reported to the caller directly.
    let (ws_stream, _resp) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| e.to_string())?;

    let _ = on_event.send(StreamMsg::now("open", format!("connected to {url}")));

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let connections = state.connections.clone();

    connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            id.clone(),
            Connection {
                shutdown: Some(shutdown_tx),
                outbound: Some(out_tx),
            },
        );

    let task_id = id.clone();
    tokio::spawn(async move {
        let (mut write, mut read) = ws_stream.split();
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    let _ = write.send(Message::Close(None)).await;
                    let _ = on_event.send(StreamMsg::now("close", "disconnected"));
                    break;
                }
                Some(text) = out_rx.recv() => {
                    if write.send(Message::Text(text.clone())).await.is_err() {
                        let _ = on_event.send(StreamMsg::now("error", "failed to send message"));
                        break;
                    }
                    let _ = on_event.send(StreamMsg::now("sent", text));
                }
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            let _ = on_event.send(StreamMsg::now("message", t.to_string()));
                        }
                        Some(Ok(Message::Binary(b))) => {
                            let _ = on_event.send(StreamMsg::now(
                                "message",
                                format!("[binary {} bytes]", b.len()),
                            ));
                        }
                        Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {
                            // Heartbeat — handled by the library; nothing to surface.
                        }
                        Some(Ok(Message::Close(frame))) => {
                            let detail = frame
                                .map(|f| format!("{} {}", f.code, f.reason))
                                .unwrap_or_else(|| "closed by server".to_string());
                            let _ = on_event.send(StreamMsg::now("close", detail));
                            break;
                        }
                        Some(Ok(Message::Frame(_))) => {}
                        Some(Err(e)) => {
                            let _ = on_event.send(StreamMsg::now("error", e.to_string()));
                            break;
                        }
                        None => {
                            let _ = on_event.send(StreamMsg::now("close", "stream ended"));
                            break;
                        }
                    }
                }
            }
        }
        drop_connection_arc(&connections, &task_id);
    });

    Ok(id)
}

/// Send a text message over an open WebSocket connection.
#[tauri::command]
pub async fn ws_send(
    connection_id: String,
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let sender = {
        let guard = state.connections.lock().unwrap_or_else(|e| e.into_inner());
        match guard.get(&connection_id) {
            Some(conn) => conn.outbound.clone(),
            None => return Err("connection not found".to_string()),
        }
    };
    match sender {
        Some(tx) => tx.send(text).map_err(|_| "connection closed".to_string()),
        None => Err("connection is not a WebSocket".to_string()),
    }
}

/// Close a streaming connection (SSE or WebSocket). No-op if already gone.
#[tauri::command]
pub async fn disconnect(
    connection_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let conn = state
        .connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&connection_id);
    if let Some(mut conn) = conn {
        if let Some(tx) = conn.shutdown.take() {
            // Receiver may already be gone if the task ended on its own.
            let _ = tx.send(());
        }
    }
    Ok(())
}

/// Remove a connection from the registry by its Arc handle, for use inside
/// spawned tasks that don't hold a `tauri::State`. Idempotent.
fn drop_connection_arc(
    connections: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Connection>>>,
    id: &str,
) {
    connections
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id);
}

/// Generate a reasonably-unique connection id without pulling in a uuid crate.
/// Combines a nanosecond timestamp with a thread-local counter — collisions
/// would require two connections opened in the same nanosecond, which the
/// counter still disambiguates.
fn uuid_like() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("conn-{ts:x}-{n:x}")
}

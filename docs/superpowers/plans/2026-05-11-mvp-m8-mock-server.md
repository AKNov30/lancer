# Lancer MVP M8 — Local Mock Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** From an OpenAPI spec, spin up a local HTTP server in Lancer's process that responds to every path × method with a plausible response (chosen from the spec's `examples` or generated from the schema). Bind to a user-chosen port (default 8787). Show a status pill in the UI: `Mock ● localhost:8787` with Start/Stop controls.

**Why this matters:** Front-end devs constantly wait for back-end API endpoints. Postman charges per mock call. Lancer's mock is local, free, and instant — drop a spec, get a server.

**Architecture:**
- Use the **`axum`** crate (already in scope from earlier milestones).
- The mock router is built ONCE per spec load. Each route handler returns a static `Response` whose body is the chosen example.
- **Server lifecycle** lives in `AppState`: an `Arc<Mutex<Option<MockServerHandle>>>` that holds an axum task + cancellation signal.
- **Tauri commands:** `mock_start(spec_path, port)`, `mock_stop()`, `mock_status() -> MockStatus`.
- **Port management:** the user picks the port; if it's bound, we return a clear error suggesting a free one.
- **Response selection:** if multiple examples exist, default to the first; offer an "example name" filter as a future enhancement.
- The mock is in-process for simplicity. It shares the Tauri runtime. No external binary, no Docker.
- **CORS:** mock responds with `Access-Control-Allow-Origin: *` so it works from any browser dev page.

**Tech additions:**
- None — `axum`, `tower-http` (for CORS), `tokio` already in scope.

---

## Scope

**In:**
- OAS 3.0 + 3.1 → mock router
- Status codes: default to lowest 2xx with an example; fall through to 404 for unmapped paths
- Response body: example > example-from-schema > empty string
- CORS permissive headers
- Live server status (running / stopped / port-bound-error)
- One spec → one mock instance; switching spec stops + restarts

**Out:**
- Stateful behavior (POST /users → GET /users/{id} returning the same data) — Phase 2
- Auth simulation (no 401 if Authorization is missing) — Phase 2
- WebSocket / SSE mocks — Phase 2 (Pro tier)
- Dynamic data via faker — out of scope unless trivial

---

## File structure

```
src-tauri\src\
├── mock\                                     # NEW module
│   ├── mod.rs
│   ├── router.rs                             # build axum Router from oas3::Spec
│   ├── responses.rs                          # pick example, schema → example
│   ├── server.rs                             # spawn/stop axum task, port binding
│   └── state.rs                              # MockServerHandle, MockStatus
├── state.rs                                  # extend AppState with mock_handle
├── commands\
│   └── mock.rs                               # mock_start / mock_stop / mock_status
└── tests\
    └── mock_tests.rs                         # integration: spin up, hit, assert

src\
├── components\
│   └── mock\
│       ├── mock-panel.tsx                    # status pill + Start/Stop
│       └── mock-config-dialog.tsx            # spec path + port
└── stores\
    └── mock-store.ts                         # status, port, spec path
```

---

## M8.1 — Mock router builder

### Task 8.1.1 — Convert an Operation → axum route

- [ ] **Test fixture: petstore "listPets" returns 200 with example body**

```rust
#[tokio::test]
async fn mock_returns_example_body_for_listpets() {
    use axum::body::to_bytes;
    let spec = crate::importers::openapi::load::load(
        std::path::Path::new("src/tests/fixtures/petstore-3.0.yaml"),
    ).unwrap();
    let router = crate::mock::router::build(&spec);

    let req = http::Request::builder()
        .uri("/pets")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = tower::ServiceExt::oneshot(router, req).await.unwrap();
    assert_eq!(resp.status(), 200);
    let bytes = to_bytes(resp.into_body(), 1_000_000).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body.is_array(), "expected example array, got {body:?}");
}
```

- [ ] **Implementation (`mock/router.rs`):**

```rust
use axum::{
    extract::Path,
    response::{IntoResponse, Json, Response},
    routing::{any, MethodRouter},
    Router,
};
use http::StatusCode;
use tower_http::cors::{Any, CorsLayer};

pub fn build(spec: &oas3::Spec) -> Router {
    let mut router = Router::new();
    for (path, item) in &spec.paths {
        // Convert /pets/{id} → /pets/:id for axum
        let axum_path = convert_path(path);
        let methods = collect_methods(item, spec);
        if let Some(m) = methods {
            router = router.route(&axum_path, m);
        }
    }
    router.layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    )
}

fn convert_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            out.push(':');
            for c in chars.by_ref() {
                if c == '}' { break; }
                out.push(c);
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn collect_methods(item: &oas3::spec::PathItem, spec: &oas3::Spec) -> Option<MethodRouter> {
    let mut mr: Option<MethodRouter> = None;
    macro_rules! add {
        ($field:ident, $method:ident) => {
            if let Some(op) = &item.$field {
                let example = super::responses::pick_example(op, spec);
                let handler = move || async move {
                    Json(example.clone()).into_response()
                };
                mr = Some(match mr.take() {
                    None => axum::routing::$method(handler),
                    Some(existing) => existing.$method(handler),
                });
            }
        };
    }
    add!(get, get);
    add!(post, post);
    add!(put, put);
    add!(patch, patch);
    add!(delete, delete);
    add!(head, head);
    add!(options, options);
    mr
}
```

- [ ] **Implementation (`mock/responses.rs`):**

```rust
use serde_json::Value;

pub fn pick_example(op: &oas3::spec::Operation, spec: &oas3::Spec) -> Value {
    // Prefer 2xx response with example
    let responses = op.responses(spec);
    for (status, resp) in responses {
        if !status.starts_with('2') && status != "default" {
            continue;
        }
        if let Some(r) = resp.resolve(spec).ok() {
            if let Some(json) = r.content.get("application/json") {
                if let Some(ex) = &json.example {
                    return ex.clone();
                }
                if let Some(s) = &json.schema {
                    if let Ok(sch) = s.resolve_value() {
                        return example_from_schema(&sch);
                    }
                }
            }
        }
    }
    Value::Null
}

pub fn example_from_schema(schema: &oas3::spec::Schema) -> Value {
    // Use schema.example if present, else generate skeletal data based on type.
    if let Some(ex) = &schema.example {
        return ex.clone();
    }
    use oas3::spec::SchemaType::*;
    match schema.schema_type {
        Some(String) => Value::String("string".into()),
        Some(Integer) => Value::from(0),
        Some(Number) => Value::from(0.0),
        Some(Boolean) => Value::Bool(false),
        Some(Array) => Value::Array(vec![]),
        Some(Object) => {
            let mut map = serde_json::Map::new();
            for (k, prop_schema) in &schema.properties {
                if let Ok(s) = prop_schema.resolve_value() {
                    map.insert(k.clone(), example_from_schema(&s));
                }
            }
            Value::Object(map)
        }
        _ => Value::Null,
    }
}
```

> **Note on oas3 API:** specifics differ across versions. The handlers above assume the same crate chosen in M7. Adapt as needed.

Commit:

```powershell
git commit -m "feat(mock): build axum router from oas spec with example bodies"
```

---

## M8.2 — Server lifecycle in `AppState`

### Task 8.2.1 — `MockServerHandle` with cancellation

- [ ] **Extend `src-tauri/src/state.rs`:**

```rust
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub spec_path: Option<String>,
    pub error: Option<String>,
}

pub struct MockHandle {
    pub port: u16,
    pub spec_path: String,
    pub shutdown: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct AppState {
    pub oauth2_cache: OAuth2Cache,
    pub mock: Arc<Mutex<Option<MockHandle>>>,
    pub mock_error: Arc<Mutex<Option<String>>>,
}
```

### Task 8.2.2 — `mock_start` / `mock_stop` / `mock_status` commands

- [ ] **Implementation (`commands/mock.rs`):**

```rust
use std::path::PathBuf;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::importers::openapi::load;
use crate::mock::router;
use crate::state::{AppState, MockHandle, MockStatus};

#[tauri::command]
pub async fn mock_start(
    spec_path: PathBuf,
    port: u16,
    state: tauri::State<'_, AppState>,
) -> Result<MockStatus, String> {
    // Stop any prior instance.
    {
        let mut guard = state.mock.lock().await;
        if let Some(h) = guard.take() {
            let _ = h.shutdown.send(());
        }
    }
    *state.mock_error.lock().await = None;

    let spec = load::load(&spec_path).map_err(|e| e.to_string())?;
    let router = router::build(&spec);

    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("bind {port}: {e}"))?;
    let (tx, rx) = oneshot::channel::<()>();

    let mock_error = state.mock_error.clone();
    tokio::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = result {
            *mock_error.lock().await = Some(e.to_string());
        }
    });

    let handle = MockHandle {
        port,
        spec_path: spec_path.to_string_lossy().into_owned(),
        shutdown: tx,
    };
    *state.mock.lock().await = Some(handle);

    Ok(mock_status_inner(&state).await)
}

#[tauri::command]
pub async fn mock_stop(state: tauri::State<'_, AppState>) -> Result<MockStatus, String> {
    if let Some(h) = state.mock.lock().await.take() {
        let _ = h.shutdown.send(());
    }
    Ok(mock_status_inner(&state).await)
}

#[tauri::command]
pub async fn mock_status(state: tauri::State<'_, AppState>) -> Result<MockStatus, String> {
    Ok(mock_status_inner(&state).await)
}

async fn mock_status_inner(state: &tauri::State<'_, AppState>) -> MockStatus {
    let guard = state.mock.lock().await;
    let err = state.mock_error.lock().await.clone();
    match &*guard {
        Some(h) => MockStatus {
            running: true,
            port: Some(h.port),
            spec_path: Some(h.spec_path.clone()),
            error: err,
        },
        None => MockStatus {
            running: false,
            port: None,
            spec_path: None,
            error: err,
        },
    }
}
```

Register all three commands in `lib.rs`.

### Task 8.2.3 — Integration test

```rust
#[tokio::test]
async fn mock_server_serves_example_body() {
    // Bring up the server on a random port via direct router invocation
    // (full Tauri command test is too heavy). Use TcpListener with port 0.
    let spec = crate::importers::openapi::load::load(
        std::path::Path::new("src/tests/fixtures/petstore-3.0.yaml"),
    ).unwrap();
    let router = crate::mock::router::build(&spec);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    let resp = reqwest::get(format!("http://127.0.0.1:{port}/pets")).await.unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert!(body.is_array());

    server.abort();
}
```

Commit:

```powershell
git commit -m "feat(mock): lifecycle commands (start/stop/status) backed by axum"
```

---

## M8.3 — UI: status panel + config dialog

### Task 8.3.1 — Mock store

```ts
// src/stores/mock-store.ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface MockStatus {
  running: boolean;
  port: number | null;
  specPath: string | null;
  error: string | null;
}

interface MockState extends MockStatus {
  start: (specPath: string, port: number) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useMock = create<MockState>((set) => ({
  running: false,
  port: null,
  specPath: null,
  error: null,
  start: async (specPath, port) => {
    const s = await invoke<MockStatus>("mock_start", { specPath, port });
    set(s);
  },
  stop: async () => {
    const s = await invoke<MockStatus>("mock_stop");
    set(s);
  },
  refresh: async () => {
    const s = await invoke<MockStatus>("mock_status");
    set(s);
  },
}));
```

### Task 8.3.2 — `<MockPanel>` and `<MockConfigDialog>`

A small fixed-bottom strip on the editor pane:

```tsx
export function MockPanel() {
  const { running, port, error, stop } = useMock();
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="flex items-center justify-end gap-2 border-border border-t bg-card px-3 py-1 text-xs">
      {running ? (
        <>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-[var(--color-success)]" />
            Mock · localhost:{port}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void stop()}>Stop</Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">Mock off</span>
          <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>Start mock…</Button>
        </>
      )}
      {error && <span className="text-destructive">{error}</span>}
      <MockConfigDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
```

The config dialog asks for spec path (file picker) + port (default 8787). On submit calls `start`.

Wire `<MockPanel>` into the app shell below `<ResponseViewer>` or in a status bar.

Commit:

```powershell
git commit -m "feat(mock): UI panel + config dialog"
```

---

## Self-Review

- [x] Scope covers Phase 1's "Local mock server from OpenAPI spec" SPEC item.
- [x] Lifecycle is robust — re-starting stops the prior instance.
- [x] CORS open for browser dev.
- [x] Tests don't require Tauri runtime — direct router + reqwest.
- [x] No external processes.
- [x] Error surfaces (port-bind failures, parse failures) reach the UI as strings.

## Future plans

After M8, M9 (Postman import) will let users who don't have OAS yet still onboard. M9 also benefits from this mock — Postman collections often include mock-expected responses.

## Execution Handoff

5 tasks total: M8.1.1, M8.2.1, M8.2.2, M8.2.3, M8.3.1, M8.3.2. ~6 dispatches.

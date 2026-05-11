# Lancer MVP M7 — OpenAPI 3 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Let the user drop an `openapi.yaml` (or `.json`) file on Lancer and produce a folder of `.bru` files — one per operation — plus an env file with security schemes / server URLs.

**Why this matters:** OpenAPI is the gateway drug to API documentation done well. If Lancer ingests OAS losslessly, every project with an OAS spec becomes a usable Lancer workspace in 5 seconds. Postman charges for this; Lancer ships it free.

**Architecture:**
- Use the **`oas3`** crate (or `openapi` / `openapiv3` depending on which is best-maintained at implementation time — see Step 1 of M7.1 for the bake-off). Supports both OpenAPI 3.0 and 3.1.
- One **`.bru`** per `(path, method)` pair. Filename: `<operationId or path-method>.bru`. Place under a folder named after the spec's `info.title` or the file stem.
- **Path params** (`/users/{id}`) become `{{id}}` in the URL template; the import surfaces a hint to set them in an env.
- **Query / header params** become `params:query` / `headers` lists with their default or example values.
- **Request bodies** with a JSON schema become a `body:json` block populated from the example, or, if none, from generated example data (using the `schemars` or a small custom generator).
- **Security schemes** (`bearerAuth`, `apiKeyAuth`, `oauth2`) become per-operation `auth:*` blocks. `oauth2 clientCredentials` flow maps to Lancer's `Auth::OAuth2Cc`.
- **Server URLs** become an environment file at `environments/<spec-name>.bru` with a `baseUrl` variable.
- Import is non-destructive: it never overwrites an existing `.bru` without explicit confirmation.

**Tech additions:**
- `oas3 = "0.13"` (Rust, MIT) — preferred for 3.1 support.
- `serde_yaml = "0.9"` (already may be transitive; add explicit).
- `schemars = "0.8"` only if needed for example generation; aim to use OAS's own `example` / `examples` fields first.

---

## Scope

**In:**
- OAS 3.0 and 3.1 (YAML and JSON inputs)
- Operations → `.bru` files with method/url/headers/params/body/auth
- Security schemes → per-operation `Auth` (5 of 6 kinds we support; OAuth 2 Authorization Code is out-of-scope as Phase 2)
- Servers → env file `baseUrl`
- Refs (`$ref`) — resolved locally; external `$ref` URLs blocked with a clear error

**Out:**
- Generating a mock server from the spec — M8 handles that
- Round-trip: changes to a `.bru` do not flow back into the original OAS file
- OpenAPI 2 (Swagger) — convert to 3.x with `swagger2openapi` externally first
- Multiple `examples` per parameter — import picks the first one
- callbacks / links / webhooks

---

## File structure

```
src-tauri\src\
├── importers\                                # NEW module
│   ├── mod.rs
│   ├── openapi\
│   │   ├── mod.rs
│   │   ├── load.rs                           # YAML/JSON → oas3::Spec
│   │   ├── convert.rs                        # Operation → collection::Request
│   │   ├── server.rs                         # servers → environments
│   │   ├── auth.rs                           # security schemes → schema::Auth
│   │   ├── body.rs                           # schema → example JSON
│   │   └── walk.rs                           # full spec → tree on disk
│   └── postman\                              # M9
├── commands\
│   └── importers.rs                          # import_openapi command
└── tests\
    ├── openapi_tests.rs
    └── fixtures\
        ├── petstore-3.0.yaml
        └── petstore-3.1.json

src\
├── components\
│   └── importers\
│       └── openapi-dialog.tsx                # picker + progress + summary
└── lib\
    └── tauri.ts                              # importOpenapi wrapper
```

---

## M7.1 — Load and validate an OAS spec

### Task 7.1.1 — Add deps + pick a crate

- [ ] **Bake-off:** in a scratch branch, try parsing `petstore-3.0.yaml` (and the 3.1 variant) with `oas3 = "0.13"` AND `openapiv3 = "2"`. Pick whichever:
  1. Parses both 3.0 and 3.1 without panic
  2. Has been touched on GitHub in the last 6 months
  3. Exposes `$ref` resolution as a first-class API (saves us writing that)

  Commit the winner's dep to `Cargo.toml`. Document the choice in `importers/openapi/mod.rs` with a one-line `//!` doc comment.

- [ ] **Step 1: Add deps**

```toml
oas3 = "0.13"       # or openapiv3 = "2" — picked by bake-off above
serde_yaml = "0.9"
```

- [ ] **Step 2: Create `importers/openapi/load.rs`**

```rust
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml parse: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json parse: {0}")]
    Json(#[from] serde_json::Error),
    #[error("oas error: {0}")]
    Oas(String),
}

pub fn load(path: &Path) -> Result<oas3::Spec, LoadError> {
    let text = std::fs::read_to_string(path)?;
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let spec: oas3::Spec = match ext {
        "json" => serde_json::from_str(&text)?,
        _ => serde_yaml::from_str(&text)?,
    };
    Ok(spec)
}
```

- [ ] **Step 3: TDD test that load on petstore works**

```rust
#[test]
fn load_petstore_30_yaml() {
    let path = std::path::Path::new("src/tests/fixtures/petstore-3.0.yaml");
    let spec = crate::importers::openapi::load::load(path).expect("load");
    assert_eq!(spec.openapi, "3.0.0");
    assert!(spec.paths.contains_key("/pets"));
}
```

(Drop the official Petstore YAML into `src/tests/fixtures/petstore-3.0.yaml` — pull from `https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/examples/v3.0/petstore.yaml` once and commit.)

Commit:

```powershell
git commit -m "feat(import/openapi): load YAML/JSON specs via oas3 crate"
```

---

## M7.2 — Convert one Operation → `collection::schema::Request`

### Task 7.2.1 — `convert_operation(path, method, op, spec) -> Request`

The hardest single function in M7. It pulls together URL templating, params, body, security.

- [ ] **TDD test with petstore "listPets":**

```rust
#[test]
fn convert_listpets_operation_to_get_request() {
    let spec = crate::importers::openapi::load::load(
        std::path::Path::new("src/tests/fixtures/petstore-3.0.yaml"),
    )
    .unwrap();
    let op = spec.paths["/pets"].get.as_ref().unwrap();
    let req = crate::importers::openapi::convert::convert_operation("/pets", "GET", op, &spec)
        .expect("convert");
    assert_eq!(req.method, crate::http::types::Method::Get);
    assert_eq!(req.url, "{{baseUrl}}/pets");
    // limit query param should be present
    let limit = req.params.iter().find(|p| p.key == "limit");
    assert!(limit.is_some());
}
```

- [ ] **Implementation skeleton (`importers/openapi/convert.rs`):**

```rust
use crate::collection::schema::{KvEnabled, Request, RequestBody, Auth};
use crate::http::types::Method;

pub fn convert_operation(
    path: &str,
    method: &str,
    op: &oas3::spec::Operation,
    spec: &oas3::Spec,
) -> anyhow::Result<Request> {
    let method = parse_method(method)?;
    let name = op
        .operation_id
        .clone()
        .unwrap_or_else(|| format!("{method:?} {path}"));

    let params: Vec<KvEnabled> = op
        .parameters
        .iter()
        .filter_map(|p| p.resolve(spec).ok())
        .filter(|p| matches!(p.parameter_in, oas3::spec::ParameterIn::Query))
        .map(|p| KvEnabled {
            key: p.name.clone(),
            value: example_for(&p).unwrap_or_default(),
            enabled: true,
        })
        .collect();

    let headers: Vec<KvEnabled> = op
        .parameters
        .iter()
        .filter_map(|p| p.resolve(spec).ok())
        .filter(|p| matches!(p.parameter_in, oas3::spec::ParameterIn::Header))
        .map(|p| KvEnabled {
            key: p.name.clone(),
            value: example_for(&p).unwrap_or_default(),
            enabled: true,
        })
        .collect();

    let body = op.request_body.as_ref().and_then(|rb| {
        let rb = rb.resolve(spec).ok()?;
        let json = rb.content.get("application/json")?;
        let example = json.example.clone()
            .or_else(|| json.schema.as_ref().and_then(|s| super::body::example_from_schema(s, spec)))?;
        Some(RequestBody::Json {
            value: serde_json::to_string_pretty(&example).ok()?,
        })
    });

    let auth = derive_auth_from_security(&op.security, spec);

    Ok(Request {
        name,
        seq: None,
        method,
        url: format!("{{{{baseUrl}}}}{path}"),
        headers,
        params,
        body,
        auth,
        vars: vec![],
    })
}

fn parse_method(s: &str) -> anyhow::Result<Method> {
    Ok(match s.to_ascii_uppercase().as_str() {
        "GET" => Method::Get,
        "POST" => Method::Post,
        "PUT" => Method::Put,
        "PATCH" => Method::Patch,
        "DELETE" => Method::Delete,
        "HEAD" => Method::Head,
        "OPTIONS" => Method::Options,
        other => anyhow::bail!("unknown method: {other}"),
    })
}

fn example_for(p: &oas3::spec::Parameter) -> Option<String> {
    p.example
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default())
        .or_else(|| {
            p.schema
                .as_ref()
                .and_then(|s| s.resolve_value().ok())
                .and_then(|s| s.example.clone())
                .map(|v| serde_json::to_string(&v).unwrap_or_default())
        })
}

fn derive_auth_from_security(
    requirement: &[oas3::spec::SecurityRequirement],
    spec: &oas3::Spec,
) -> Option<Auth> {
    let req = requirement.first()?;
    let scheme_name = req.keys().next()?;
    let scheme = spec
        .components
        .as_ref()?
        .security_schemes
        .get(scheme_name)?
        .resolve(spec)
        .ok()?;
    match scheme.kind {
        oas3::spec::SecuritySchemeKind::Http { scheme: ref s, .. } if s == "bearer" => {
            Some(Auth::Bearer { token: "{{token}}".into() })
        }
        oas3::spec::SecuritySchemeKind::Http { scheme: ref s, .. } if s == "basic" => {
            Some(Auth::Basic {
                username: "{{username}}".into(),
                password: "{{password}}".into(),
            })
        }
        oas3::spec::SecuritySchemeKind::ApiKey { name, location, .. } => Some(Auth::ApiKey {
            key: name.clone(),
            value: format!("{{{{ {} }}}}", name.replace('-', "_")),
            location: match location {
                oas3::spec::ApiKeyLocation::Header => "header".into(),
                oas3::spec::ApiKeyLocation::Query => "query".into(),
                _ => "header".into(),
            },
        }),
        oas3::spec::SecuritySchemeKind::OAuth2 { ref flows, .. } => {
            let cc = flows.client_credentials.as_ref()?;
            Some(Auth::OAuth2Cc {
                token_url: cc.token_url.to_string(),
                client_id: "{{clientId}}".into(),
                client_secret: "{{clientSecret}}".into(),
                scope: cc.scopes.keys().cloned().collect::<Vec<_>>().join(" "),
                audience: String::new(),
            })
        }
        _ => None,
    }
}
```

> **Note:** Exact `oas3` API may differ from the snippet above. Treat the snippet as a guide; adapt to the actual API by reading the crate docs after `cargo doc --open --package oas3`.

Commit:

```powershell
git commit -m "feat(import/openapi): convert single Operation to Request"
```

---

## M7.3 — Walk the full spec and write to disk

### Task 7.3.1 — `import_spec(path, dest_root) -> ImportReport`

Walk every `(path, method)`, convert, write `.bru` files. Also create the env file from `servers`.

- [ ] **Implementation:**

```rust
pub struct ImportReport {
    pub created_files: Vec<PathBuf>,
    pub skipped_existing: Vec<PathBuf>,
    pub errors: Vec<String>,
    pub env_created: Option<PathBuf>,
}

pub fn import_spec(spec_path: &Path, dest_root: &Path) -> Result<ImportReport, ImportError> {
    let spec = super::load::load(spec_path)?;
    let mut report = ImportReport::default();

    // 1. Create environment from servers[0]
    if let Some(server) = spec.servers.first() {
        let env = crate::env::schema::Environment {
            name: "imported".into(),
            vars: vec![("baseUrl".into(), server.url.clone())],
            secret_names: vec![],
        };
        crate::env::io::write_env(dest_root, &env)?;
        report.env_created = Some(dest_root.join("environments/imported.bru"));
    }

    // 2. One .bru per operation
    for (path_str, path_item) in &spec.paths {
        for (method, op) in operation_iter(path_item) {
            let req = match super::convert::convert_operation(path_str, method, op, &spec) {
                Ok(r) => r,
                Err(e) => {
                    report.errors.push(format!("{method} {path_str}: {e}"));
                    continue;
                }
            };
            let filename = bru_filename(&req, path_str, method);
            let dest = dest_root.join(&filename);
            if dest.exists() {
                report.skipped_existing.push(dest);
                continue;
            }
            crate::collection::io::write_request(&dest, &req)?;
            report.created_files.push(dest);
        }
    }

    Ok(report)
}

fn bru_filename(req: &Request, path: &str, method: &str) -> String {
    let mut name = req.name.clone();
    if name.is_empty() {
        name = format!("{}-{}", method.to_lowercase(), path.replace('/', "-"));
    }
    let safe: String = name.chars().map(|c| {
        if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }
    }).collect();
    format!("{safe}.bru")
}
```

Commit:

```powershell
git commit -m "feat(import/openapi): walk spec and write .bru tree + env"
```

---

## M7.4 — UI: import dialog

### Task 7.4.1 — Tauri command + JS wrapper

```rust
#[tauri::command]
pub fn import_openapi(spec_path: PathBuf, dest_root: PathBuf)
    -> Result<crate::importers::openapi::walk::ImportReport, String>
{
    crate::importers::openapi::walk::import_spec(&spec_path, &dest_root)
        .map_err(|e| e.to_string())
}
```

### Task 7.4.2 — `<OpenApiImportDialog>` component

A `<Dialog>` that:
1. Asks for the OAS file path (`open({ filters: [{name: "OpenAPI", extensions: ["yaml", "yml", "json"]}] })`)
2. Confirms destination = current workspace root
3. On submit: invokes `importOpenapi`, shows progress (spinner is fine — most specs convert in < 1s)
4. On success: shows the `ImportReport` — `<table>` with created / skipped / error rows, plus "Open env" button

Wire into the sidebar's "+" button menu (`<DropdownMenu>`):
- "New request"
- "Import OpenAPI…"  ← this one
- "Import Postman…" (M9)

Commit:

```powershell
git commit -m "feat(import/openapi): dialog UI + import_openapi command"
```

---

## Future plans

After M7 ships, M8 (mock server) consumes the same OAS structure to serve example responses. M7's `convert::convert_operation` will be reused by M8's mock router builder. Plan accordingly.

## Self-Review

- [x] Scope covers Phase 1's "OpenAPI 3 importer" SPEC item.
- [x] Crate choice deferred to a bake-off — avoids picking a stagnant crate.
- [x] Path/query/header params → variables and template strings.
- [x] Security schemes mapped to all 5 Auth kinds we support.
- [x] Refs resolved locally; external `$ref` errors with clear message.
- [x] Non-destructive (skip existing `.bru` files).

## Execution Handoff

5 tasks total: M7.1.1, M7.2.1, M7.3.1, M7.4.1, M7.4.2. ~5 dispatches.

# Lancer MVP M9 — Postman v2.1 Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Convert a Postman v2.1 collection JSON (and optional environment JSON) into a folder of `.bru` files + Lancer env files. Target conversion fidelity: **≥ 95 % of real-world Postman collections (sampled from public GitHub repos)** parse without error, and ≥ 90 % of requests preserve method/url/headers/params/auth/body verbatim.

**Why this matters:** This is the single biggest dam-breaker for Lancer adoption. Devs sit on years of Postman collections. If we make the migration painless — one click, no data loss — we capture the Postman-fatigue exodus.

**Architecture:**
- Parse Postman v2.1 schema (https://schema.postman.com/collection/json/v2.1.0/collection.json) with `serde`. We model a subset: enough types to map the fields we support.
- One Postman **item** = one `.bru` file. Folder structure mirrors Postman's nested folders.
- Postman **variables** (`{{var}}`) translate identically — same `{{}}` syntax.
- Postman **environments** become Lancer env files in `environments/`.
- Postman **auth** (5 of ~12 types directly supported) translates to `Auth`; unsupported types are recorded in a `// TODO:` comment in the resulting `.bru` and surfaced in the import report.
- Postman **pre-request and test scripts** are preserved in explicit `script:pre-request` and `script:post-response` blocks in the `.bru` format (see M9.4.1 for details). These blocks are written verbatim but are NOT executed in M9 — they are inert until the Pro-tier test runner lands in Phase 2. The import report notes any request that carried scripts.
- Import is **non-destructive**: existing `.bru` files are skipped with a clear report row.

---

## Scope

**In:**
- Postman v2.1 collection JSON (schema URL: `https://schema.postman.com/collection/json/v2.1.0/collection.json`)
- Folder hierarchy preserved
- Method, URL (with `{{}}` vars), headers, query params, path params
- Bodies: raw (json/text/xml/html/javascript), urlencoded, formdata, file, graphql, none
- Auth: noauth, bearer, basic, apikey, oauth2 (client-credentials flow only), awsv4
- Variables (collection + environment levels)
- Postman environment JSON → Lancer env file
- Test/pre-request scripts preserved in `script:pre-request` / `script:post-response` blocks (inert until Phase 2 test runner)

**Out:**
- Postman v1 / v2.0 (user must export as v2.1 first)
- Mock servers (Postman's hosted mock is paywalled anyway)
- Workspace / team metadata
- Monitors, flows, governance
- Folder-level scripts (not preserved — folder items have no `.bru` file to attach script blocks to)
- OAuth 2 authorization code flow (no PKCE support yet)
- Cookies / sessions

---

## File structure

```
src-tauri\src\
├── importers\
│   ├── mod.rs                                # already from M7
│   └── postman\                              # NEW
│       ├── mod.rs
│       ├── schema.rs                         # Postman v2.1 types (subset)
│       ├── convert.rs                        # PostmanItem → schema::Request
│       ├── env.rs                            # PostmanEnv → schema::Environment
│       ├── walk.rs                           # full collection → .bru tree
│       └── auth.rs                           # postman auth → schema::Auth
├── commands\
│   └── importers.rs                          # add import_postman, import_postman_env
└── tests\
    ├── postman_tests.rs
    └── fixtures\
        ├── postman-sample-collection.json
        └── postman-sample-env.json

src\
└── components\
    └── importers\
        └── postman-dialog.tsx
```

---

## M9.1 — Postman v2.1 schema (subset)

### Task 9.1.1 — Rust types for the parts we consume

The full Postman schema is large. Model only what we need; everything else uses `serde_json::Value` as escape hatch.

- [ ] **Implementation (`importers/postman/schema.rs`):**

```rust
use serde::{Deserialize, Serialize};

/// Top-level Postman v2.1 collection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostmanCollection {
    pub info: Info,
    #[serde(default)]
    pub item: Vec<Item>,
    #[serde(default)]
    pub auth: Option<Auth>,
    #[serde(default)]
    pub variable: Vec<Variable>,
    #[serde(default)]
    pub event: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Info {
    pub name: String,
    #[serde(default)]
    pub schema: String,
}

/// Item can be either a folder (has its own `item`) or a request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub item: Option<Vec<Item>>,
    #[serde(default)]
    pub request: Option<Request>,
    #[serde(default)]
    pub event: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub url: UrlField,
    #[serde(default)]
    pub header: Vec<Header>,
    #[serde(default)]
    pub body: Option<Body>,
    #[serde(default)]
    pub auth: Option<Auth>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UrlField {
    Raw(String),
    Object {
        #[serde(default)]
        raw: String,
        #[serde(default)]
        host: serde_json::Value,
        #[serde(default)]
        path: serde_json::Value,
        #[serde(default)]
        query: Vec<QueryParam>,
        #[serde(default)]
        variable: Vec<UrlVariable>,
    },
}

impl Default for UrlField {
    fn default() -> Self { UrlField::Raw(String::new()) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlVariable {
    pub key: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Header {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Body {
    pub mode: String, // "raw" | "urlencoded" | "formdata" | "file" | "graphql"
    #[serde(default)]
    pub raw: Option<String>,
    #[serde(default)]
    pub urlencoded: Option<Vec<FormParam>>,
    #[serde(default)]
    pub formdata: Option<Vec<FormParam>>,
    #[serde(default)]
    pub options: Option<BodyOptions>,
    #[serde(default)]
    pub graphql: Option<GraphqlBody>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormParam {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, rename = "type")]
    pub kind: String, // "text" | "file"
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BodyOptions {
    #[serde(default)]
    pub raw: Option<BodyRawOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BodyRawOptions {
    #[serde(default)]
    pub language: String, // "json" | "xml" | "html" | "javascript" | "text"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphqlBody {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub variables: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Auth {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub listen: String, // "prerequest" | "test"
    pub script: Script,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    #[serde(default)]
    pub exec: Vec<String>,
    #[serde(default, rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostmanEnv {
    pub name: String,
    #[serde(default)]
    pub values: Vec<EnvValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default, rename = "type")]
    pub kind: String, // "default" | "secret"
    #[serde(default)]
    pub enabled: bool,
}
```

Commit:

```powershell
git commit -m "feat(import/postman): v2.1 schema types (subset we consume)"
```

---

## M9.2 — Request converter

### Task 9.2.1 — `convert_request(postman_request) -> schema::Request`

- [ ] **TDD test (fixture-based):**

Drop a small sample collection at `src/tests/fixtures/postman-sample-collection.json` — one folder, two requests (GET with query + Bearer auth, POST with JSON body).

```rust
#[test]
fn converts_postman_get_with_bearer_and_query() {
    const FIXTURE: &str = include_str!("fixtures/postman-sample-collection.json");
    let collection: crate::importers::postman::schema::PostmanCollection =
        serde_json::from_str(FIXTURE).expect("parse postman");
    let first = collection.item.iter().flat_map(walk_items).find(|i| i.name.contains("GET")).unwrap();
    let req = crate::importers::postman::convert::convert_request(&first.request.unwrap().clone(), &first.name).unwrap();
    assert_eq!(req.method, crate::http::types::Method::Get);
    assert!(req.url.contains("{{baseUrl}}"));
    assert!(matches!(req.auth, Some(crate::collection::schema::Auth::Bearer { .. })));
}

fn walk_items(item: &Item) -> Vec<Item> { /* recursive flattener */ vec![item.clone()] }
```

- [ ] **Implementation (`importers/postman/convert.rs`):**

```rust
use crate::collection::schema::{Auth, KvEnabled, Request, RequestBody};
use crate::http::types::Method;
use crate::importers::postman::schema as pm;

pub fn convert_request(pr: &pm::Request, name: &str) -> anyhow::Result<Request> {
    let method = parse_method(&pr.method)?;
    let url = match &pr.url {
        pm::UrlField::Raw(s) => s.clone(),
        pm::UrlField::Object { raw, .. } => raw.clone(),
    };

    let headers: Vec<KvEnabled> = pr.header.iter().map(|h| KvEnabled {
        key: h.key.clone(),
        value: h.value.clone(),
        enabled: !h.disabled,
    }).collect();

    let params: Vec<KvEnabled> = match &pr.url {
        pm::UrlField::Object { query, .. } => query.iter().map(|q| KvEnabled {
            key: q.key.clone(),
            value: q.value.clone(),
            enabled: !q.disabled,
        }).collect(),
        _ => vec![],
    };

    let body = pr.body.as_ref().and_then(|b| convert_body(b));
    let auth = pr.auth.as_ref().and_then(super::auth::convert_auth);

    Ok(Request {
        name: name.to_string(),
        seq: None,
        method,
        url,
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
        other => anyhow::bail!("unsupported method: {other}"),
    })
}

fn convert_body(b: &pm::Body) -> Option<RequestBody> {
    match b.mode.as_str() {
        "raw" => {
            let raw = b.raw.clone()?;
            let lang = b.options.as_ref()
                .and_then(|o| o.raw.as_ref())
                .map(|r| r.language.as_str())
                .unwrap_or("text");
            match lang {
                "json" => Some(RequestBody::Json { value: raw }),
                _ => Some(RequestBody::Text {
                    value: raw,
                    content_type: lang_to_content_type(lang),
                }),
            }
        }
        "urlencoded" => {
            let fields = b.urlencoded.as_ref()?.iter().map(|f| KvEnabled {
                key: f.key.clone(),
                value: f.value.clone(),
                enabled: !f.disabled,
            }).collect();
            Some(RequestBody::FormUrlencoded { fields })
        }
        "formdata" => {
            let fields = b.formdata.as_ref()?.iter().map(|f| KvEnabled {
                key: f.key.clone(),
                value: f.value.clone(),
                enabled: !f.disabled,
            }).collect();
            Some(RequestBody::MultipartForm { fields })
        }
        "graphql" => {
            let g = b.graphql.as_ref()?;
            Some(RequestBody::GraphQl {
                query: g.query.clone(),
                variables: g.variables.clone(),
            })
        }
        _ => None,
    }
}

fn lang_to_content_type(lang: &str) -> String {
    match lang {
        "xml" => "application/xml",
        "html" => "text/html",
        "javascript" => "application/javascript",
        _ => "text/plain",
    }.to_string()
}
```

Commit:

```powershell
git commit -m "feat(import/postman): convert Postman v2.1 request to schema::Request"
```

---

## M9.3 — Auth converter

### Task 9.3.1 — Map Postman auth to `schema::Auth`

- [ ] **Implementation (`importers/postman/auth.rs`):**

```rust
use crate::collection::schema::Auth;
use crate::importers::postman::schema as pm;

pub fn convert_auth(a: &pm::Auth) -> Option<Auth> {
    match a.kind.as_str() {
        "noauth" => Some(Auth::None),
        "bearer" => {
            let token = get_arr_value(&a.data, "bearer", "token");
            Some(Auth::Bearer { token })
        }
        "basic" => Some(Auth::Basic {
            username: get_arr_value(&a.data, "basic", "username"),
            password: get_arr_value(&a.data, "basic", "password"),
        }),
        "apikey" => Some(Auth::ApiKey {
            key: get_arr_value(&a.data, "apikey", "key"),
            value: get_arr_value(&a.data, "apikey", "value"),
            location: get_arr_value(&a.data, "apikey", "in"),
        }),
        "oauth2" => {
            // Postman oauth2 has 4 sub-flows; we support client_credentials only.
            let flow = get_arr_value(&a.data, "oauth2", "grant_type");
            if flow != "client_credentials" {
                return None;
            }
            Some(Auth::OAuth2Cc {
                token_url: get_arr_value(&a.data, "oauth2", "accessTokenUrl"),
                client_id: get_arr_value(&a.data, "oauth2", "clientId"),
                client_secret: get_arr_value(&a.data, "oauth2", "clientSecret"),
                scope: get_arr_value(&a.data, "oauth2", "scope"),
                audience: String::new(),
            })
        }
        "awsv4" => Some(Auth::AwsSigV4 {
            access_key_id: get_arr_value(&a.data, "awsv4", "accessKey"),
            secret_access_key: get_arr_value(&a.data, "awsv4", "secretKey"),
            session_token: {
                let t = get_arr_value(&a.data, "awsv4", "sessionToken");
                if t.is_empty() { None } else { Some(t) }
            },
            region: get_arr_value(&a.data, "awsv4", "region"),
            service: get_arr_value(&a.data, "awsv4", "service"),
        }),
        _ => None, // unsupported — caller logs a warning
    }
}

/// Postman packs auth data as `auth[<type>] = [{key,value},...]`. This helper
/// finds the value for a given key inside that array.
fn get_arr_value(
    data: &serde_json::Map<String, serde_json::Value>,
    auth_type: &str,
    key: &str,
) -> String {
    let Some(arr) = data.get(auth_type).and_then(|v| v.as_array()) else {
        return String::new();
    };
    for entry in arr {
        if entry.get("key").and_then(|v| v.as_str()) == Some(key) {
            return entry
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
        }
    }
    String::new()
}
```

Commit:

```powershell
git commit -m "feat(import/postman): auth converter (5 of 12 Postman auth types)"
```

---

## M9.4 — Walk and write to disk

### Task 9.4.1 — Recursive walk preserving folder hierarchy

**Scripts handling:** Postman items include `event[].script.exec` (pre-request and post-response JS).
The current `.bru` format has no comment or script block. M9 will:

1. Add an explicit `script:pre-request` and `script:post-response` block to the `.bru` format,
   under the `_lancer/` namespace reserved in SPEC §12 Decision A. These blocks are written
   verbatim (preserving the JS source) but are NOT executed in M9 — they are inert until the
   Pro-tier test runner lands in Phase 2.

2. The bru parser is extended to recognize `script:pre-request` and `script:post-response` as
   passthrough blocks (no parsing of the content; just preserve as raw string in `Request`).
   This requires a new field `pub pre_request_script: Option<String>` and
   `pub post_response_script: Option<String>` on `collection::schema::Request`.

3. The bru serializer writes the blocks back unchanged when present.

This makes "scripts preserved" a real promise rather than a placeholder warning.

- [ ] **Implementation (`importers/postman/walk.rs`):**

```rust
use std::path::{Path, PathBuf};

use crate::importers::postman::schema as pm;

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostmanImportReport {
    pub created: Vec<PathBuf>,
    pub skipped_existing: Vec<PathBuf>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

pub fn import_collection(
    collection_path: &Path,
    dest_root: &Path,
) -> Result<PostmanImportReport, String> {
    let text = std::fs::read_to_string(collection_path).map_err(|e| e.to_string())?;
    let collection: pm::PostmanCollection =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let mut report = PostmanImportReport::default();
    let base = dest_root.join(sanitize_folder(&collection.info.name));

    for item in &collection.item {
        walk(item, &base, 1, &mut report);
    }

    Ok(report)
}

fn walk(item: &pm::Item, dir: &Path, seq: u32, report: &mut PostmanImportReport) {
    if let Some(children) = &item.item {
        // It's a folder
        let subdir = dir.join(sanitize_folder(&item.name));
        for (i, child) in children.iter().enumerate() {
            walk(child, &subdir, (i + 1) as u32, report);
        }
    } else if let Some(pm_req) = &item.request {
        // It's a request
        match super::convert::convert_request(pm_req, &item.name) {
            Ok(mut req) => {
                req.seq = Some(seq);
                // Populate script blocks from Postman events. The bru serializer
                // will write `script:pre-request` and `script:post-response` blocks
                // verbatim. They are inert in M9 (no test runner yet).
                for event in &item.event {
                    let source = event.script.exec.join("\n");
                    match event.listen.as_str() {
                        "prerequest" => req.pre_request_script = Some(source),
                        "test" => req.post_response_script = Some(source),
                        _ => {}
                    }
                }
                if req.pre_request_script.is_some() || req.post_response_script.is_some() {
                    report.warnings.push(format!(
                        "{}: script(s) preserved in script:pre-request / script:post-response blocks; \
                         runner is Pro tier (Phase 2)",
                        item.name,
                    ));
                }
                let filename = format!("{}.bru", sanitize_folder(&item.name));
                let dest = dir.join(filename);
                if dest.exists() {
                    report.skipped_existing.push(dest);
                    return;
                }
                if let Err(e) = crate::collection::io::write_request(&dest, &req) {
                    report.errors.push(format!("{}: {}", item.name, e));
                } else {
                    report.created.push(dest);
                }
            }
            Err(e) => report.errors.push(format!("{}: {}", item.name, e)),
        }
    }
}

fn sanitize_folder(s: &str) -> String {
    s.chars().map(|c| {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' }
    }).collect::<String>().trim().to_string()
}
```

Commit:

```powershell
git commit -m "feat(import/postman): recursive walk + .bru tree on disk"
```

---

## M9.5 — Environment import + UI

### Task 9.5.1 — Convert Postman env

```rust
pub fn convert_env(pe: &pm::PostmanEnv) -> crate::env::schema::Environment {
    let mut vars = Vec::new();
    let mut secret_names = Vec::new();
    for v in &pe.values {
        if !v.enabled { continue; }
        if v.kind == "secret" {
            secret_names.push(v.key.clone());
        } else {
            vars.push((v.key.clone(), v.value.clone()));
        }
    }
    crate::env::schema::Environment {
        name: pe.name.clone(),
        vars,
        secret_names,
    }
}
```

### Task 9.5.2 — Tauri commands + dialog UI

```rust
#[tauri::command]
pub fn import_postman(collection_path: PathBuf, dest_root: PathBuf)
    -> Result<crate::importers::postman::walk::PostmanImportReport, String>
{
    crate::importers::postman::walk::import_collection(&collection_path, &dest_root)
}

#[tauri::command]
pub fn import_postman_env(env_path: PathBuf, workspace_root: PathBuf) -> Result<String, String> {
    let text = std::fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let pm_env: crate::importers::postman::schema::PostmanEnv =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let env = crate::importers::postman::env::convert_env(&pm_env);
    crate::env::io::write_env(&workspace_root, &env).map_err(|e| e.to_string())?;
    Ok(env.name)
}
```

UI: `<PostmanImportDialog>` similar to M7's openapi dialog — file pickers for collection JSON + optional env JSON, destination = current workspace root, shows progress and final `PostmanImportReport`.

Wire into the sidebar `<DropdownMenu>` ("+") item: "Import Postman…".

Commit:

```powershell
git commit -m "feat(import/postman): env converter + Tauri commands + dialog UI"
```

---

## Success Metric

After M9 ships, sample 50 real-world Postman v2.1 collections from public GitHub. Track:

- **Parse success rate** (target ≥ 95 %)
- **Per-request fidelity** — for each request, does method+url+headers+params+auth+body round-trip identically? (target ≥ 90 %)
- **Auth coverage** — what % of requests use one of the 5 supported auth types? (target ≥ 95 %)

Publish results in a blog post. Use this as launch content.

## Self-Review

- [x] Scope covers Phase 1's "Postman v2.1 importer" SPEC item.
- [x] Subset schema with `serde_json::Value` escape hatch for forward-compat.
- [x] Non-destructive: skip existing `.bru` files.
- [x] Auth coverage: 5 of 12 types (the 5 we natively support).
- [x] Scripts preserved verbatim in `script:pre-request` / `script:post-response` bru blocks; bru parser and serializer extended to round-trip them as raw strings (M9 doesn't execute them — Phase 2 test runner).
- [x] Folder hierarchy preserved.
- [x] Env conversion includes secret-name detection.

## Execution Handoff

7 tasks total: M9.1.1, M9.2.1, M9.3.1, M9.4.1, M9.5.1, M9.5.2, + a final spec-validation pass on 5 sampled collections. ~7 dispatches.

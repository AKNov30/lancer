use std::path::PathBuf;

use crate::collection::schema::Auth;
use crate::env::substitute::{load_ctx_from_disk, substitute_auth, substitute_http_request};
use crate::http::{
    auth, client,
    types::{HttpRequest, HttpResponse},
};
use crate::state::AppState;

/// Sentinel error returned by `send_request` when the user aborts an in-flight
/// request via `cancel_request`. The frontend recognises this exact string to
/// show a neutral "cancelled" message instead of a scary network error.
pub const CANCELLED_SENTINEL: &str = "__cancelled__";

#[tauri::command]
// Tauri command — args map to the frontend invoke payload.
#[allow(clippy::too_many_arguments)]
pub async fn send_request(
    mut req: HttpRequest,
    auth: Option<Auth>,
    workspace_root: Option<PathBuf>,
    env_name: Option<String>,
    // Path to the saved `.bru` for the request being sent, if any. Used to
    // walk the `folder.bru` chain and collect collection-level vars. Scratch
    // tabs (no savedPath) skip this and rely purely on env + overlay vars.
    request_path: Option<PathBuf>,
    // Runtime overlay variables (post-response captures, command-line args,
    // etc.). These layer on top of folder + env vars with higher precedence
    // — captured tokens beat stale file values.
    extra_vars: Option<Vec<(String, String)>>,
    // User JavaScript run BEFORE the request is sent — may set vars/headers via
    // `lancer.env.set(...)`. None/empty → skipped (HTTP behaviour unchanged).
    pre_request_script: Option<String>,
    // User JavaScript run AFTER the response arrives — may assert on the
    // response via `lancer.test(...)`. None/empty → skipped.
    post_response_script: Option<String>,
    // Frontend-generated id used to cancel this request mid-flight via
    // `cancel_request`. `None` → the request can't be cancelled and behaves
    // exactly as before (no registry entry, no `select!`).
    request_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<HttpResponse, String> {
    // Capture original URL and method before substitution for history recording.
    let original_url = req.url.clone();
    let original_method = format!("{:?}", req.method);

    // Variable precedence, low → high:
    //   folder.bru chain (root → leaf) < env file < runtime overlay
    // Each later step overwrites earlier values on key collisions.
    let mut ctx_opt: Option<crate::env::substitute::Ctx> = None;
    if let (Some(root), Some(req_path)) = (workspace_root.as_ref(), request_path.as_ref()) {
        let folder_vars = crate::collection::folder::collect_chain(root, req_path);
        if !folder_vars.is_empty() {
            let ctx = ctx_opt.get_or_insert_with(crate::env::substitute::Ctx::default);
            for (k, v) in folder_vars {
                ctx.vars.insert(k, v);
            }
        }
    }
    if let (Some(root), Some(name)) = (workspace_root.as_ref(), env_name.as_ref()) {
        let env_ctx = load_ctx_from_disk(root, name).map_err(|e| e.to_string())?;
        let ctx = ctx_opt.get_or_insert_with(crate::env::substitute::Ctx::default);
        for (k, v) in env_ctx.vars {
            ctx.vars.insert(k, v);
        }
        for (k, v) in env_ctx.secrets {
            ctx.secrets.insert(k, v);
        }
    }
    if let Some(extra) = extra_vars {
        let ctx = ctx_opt.get_or_insert_with(crate::env::substitute::Ctx::default);
        for (k, v) in extra {
            ctx.vars.insert(k, v);
        }
    }

    // Pre-request script. Runs against the *pre-substitution* request (raw
    // `{{template}}` strings) seeded with the currently-resolved vars, and may
    // call `lancer.env.set(...)` to inject/override variables. Those writes
    // merge into the ctx at the highest precedence so the substitution below
    // (and any auth template) sees them. Script errors/logs are surfaced on
    // the response, never failing the send.
    let mut script_logs: Vec<String> = Vec::new();
    let mut script_error: Option<String> = None;
    if let Some(code) = pre_request_script
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let ctx = ctx_opt.get_or_insert_with(crate::env::substitute::Ctx::default);
        let seed = collect_env_seed(ctx);
        let sctx = crate::scripting::ScriptContext {
            env: seed,
            request: crate::scripting::RequestContext {
                url: req.url.clone(),
                method: format!("{:?}", req.method).to_uppercase(),
                headers: req.headers.clone(),
            },
            response: None,
        };
        let res = crate::scripting::run_script(code, &sctx).await;
        for (k, v) in res.vars_set {
            ctx.vars.insert(k, v);
        }
        script_logs.extend(res.logs);
        if let Some(e) = res.error {
            script_error = Some(format!("pre-request: {e}"));
        }
    }

    // Collection-level auth inheritance: when the request itself carries no
    // explicit auth (`None` or `Auth::None`), inherit the nearest ancestor
    // folder's default auth via the `folder.bru` chain. An explicit auth on
    // the request always wins. The inherited auth still flows through
    // `substitute_auth` below so `{{env}}` placeholders in collection auth
    // resolve just like request-level auth.
    let mut effective_auth = auth.filter(|a| !matches!(a, Auth::None));
    if effective_auth.is_none() {
        if let (Some(root), Some(req_path)) = (workspace_root.as_ref(), request_path.as_ref()) {
            effective_auth = crate::collection::folder::collect_auth_chain(root, req_path);
        }
    }

    if let Some(ctx) = ctx_opt.as_ref() {
        substitute_http_request(&mut req, ctx);
        if let Some(a) = effective_auth.as_mut() {
            substitute_auth(a, ctx);
        }
    }

    // 2. Apply auth.
    let req = match effective_auth {
        Some(a) => auth::apply_auth(req, &a, state.inner())
            .await
            .map_err(|e| e.to_string())?,
        None => req,
    };

    // Snapshot the actually-sent headers (post-substitution + post-auth) so a
    // post-response script can read `lancer.request.headers` truthfully.
    let sent_headers = req.headers.clone();

    // 3. Send — cancellable when the frontend supplied a `request_id`.
    //
    // Register a oneshot cancel channel keyed by the id, then race the network
    // send against the cancel receiver in a `tokio::select!`. If cancel fires
    // first, the send future is dropped (reqwest aborts the in-flight request)
    // and we return the `__cancelled__` sentinel. Only the network send is
    // raced — substitution/auth/pre-request already ran above.
    //
    // The registry entry is removed on EVERY exit path (success, error, OR
    // cancel) via `take_cancel` so the map can never leak a stale sender. When
    // `request_id` is `None`, no entry is registered and the send is awaited
    // plainly — byte-identical to the previous behaviour.
    let cancel_rx = match request_id.as_ref() {
        Some(id) => {
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            state
                .inner()
                .cancellations
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id.clone(), tx);
            Some(rx)
        }
        None => None,
    };

    // Helper: remove this request's cancel sender from the registry (idempotent).
    let take_cancel = || {
        if let Some(id) = request_id.as_ref() {
            state
                .inner()
                .cancellations
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(id);
        }
    };

    let http_client = state.inner().http_client();
    let send_fut = client::send(&http_client, &state.inner().cookie_jar, req);
    let send_result = match cancel_rx {
        Some(rx) => {
            tokio::select! {
                res = send_fut => res,
                _ = rx => {
                    // Cancelled: dropping `send_fut` happens as the select arm
                    // is taken, aborting the reqwest request.
                    take_cancel();
                    return Err(CANCELLED_SENTINEL.to_string());
                }
            }
        }
        None => send_fut.await,
    };
    // Whether the send succeeded or errored, the request is done — clear the id.
    take_cancel();
    let mut response = send_result.map_err(|e| e.to_string())?;

    // 4. Record to history (best-effort — never fail the request on history errors).
    let _ = state.inner().history.record(
        &original_url,
        &original_method,
        response.status,
        response.elapsed_ms,
        response.size_bytes,
        &response.headers,
        response.body_text.as_deref(),
    );

    // 5. Post-response script. Runs with the response exposed as
    // `lancer.response` so the user can assert on status/body/headers via
    // `lancer.test(...)`. Collected tests/logs/errors ride back on the
    // response; the HTTP send itself already succeeded.
    let mut tests = Vec::new();
    if let Some(code) = post_response_script
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        let env_seed = ctx_opt.as_ref().map(collect_env_seed).unwrap_or_default();
        let sctx = crate::scripting::ScriptContext {
            env: env_seed,
            request: crate::scripting::RequestContext {
                url: original_url.clone(),
                method: original_method.to_uppercase(),
                headers: sent_headers,
            },
            response: Some(crate::scripting::ResponseContext {
                status: response.status,
                body: response.body_text.clone().unwrap_or_default(),
                headers: response.headers.clone(),
            }),
        };
        let res = crate::scripting::run_script(code, &sctx).await;
        tests = res.tests;
        script_logs.extend(res.logs);
        if let Some(e) = res.error {
            // Keep an existing pre-request error if one fired; otherwise record.
            let msg = format!("post-response: {e}");
            script_error = Some(match script_error.take() {
                Some(prev) => format!("{prev}\n{msg}"),
                None => msg,
            });
        }
    }

    response.tests = tests;
    response.script_logs = script_logs;
    response.script_error = script_error;

    Ok(response)
}

/// Abort an in-flight HTTP request started with the given `request_id`.
///
/// Best-effort: looks up and removes the cancel sender from the registry, then
/// fires it. A no-op (returns `Ok`) if the id is unknown — the request may have
/// already completed, never been cancellable, or been cancelled already.
#[tauri::command]
pub fn cancel_request(request_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let sender = state
        .cancellations
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&request_id);
    if let Some(tx) = sender {
        // Receiver may already be gone if the send finished in the same tick.
        let _ = tx.send(());
    }
    Ok(())
}

/// Snapshot the resolved plain-var + secret context as a flat `(name, value)`
/// list to seed `lancer.env` in a script. Secrets win over plain vars of the
/// same name (matching `Ctx::lookup`).
fn collect_env_seed(ctx: &crate::env::substitute::Ctx) -> Vec<(String, String)> {
    let mut map: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for (k, v) in &ctx.vars {
        map.insert(k.clone(), v.clone());
    }
    for (k, v) in &ctx.secrets {
        map.insert(k.clone(), v.clone());
    }
    map.into_iter().collect()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedVar {
    pub name: String,
    pub value: String,
    /// Which layer the value came from: "folder" | "env" | "overlay" | "secret".
    pub source: &'static str,
    pub is_secret: bool,
}

/// Resolve the full active variable context (folder.bru chain + env file +
/// runtime overlay/captures) for a request, returning each variable with the
/// layer it resolved from. Powers the live "resolved value" preview in the UI.
/// Mirrors the precedence in `send_request` exactly: among plain vars,
/// folder < env < overlay (later wins); secrets always win (matching
/// `Ctx::lookup`, which checks secrets before vars).
#[tauri::command]
pub fn resolve_vars(
    workspace_root: Option<PathBuf>,
    env_name: Option<String>,
    request_path: Option<PathBuf>,
    extra_vars: Option<Vec<(String, String)>>,
) -> Result<Vec<ResolvedVar>, String> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, (String, &'static str, bool)> = BTreeMap::new();

    // Plain-var layers, low → high precedence.
    if let (Some(root), Some(req_path)) = (workspace_root.as_ref(), request_path.as_ref()) {
        for (k, v) in crate::collection::folder::collect_chain(root, req_path) {
            map.insert(k, (v, "folder", false));
        }
    }
    let mut secrets: Vec<(String, String)> = Vec::new();
    if let (Some(root), Some(name)) = (workspace_root.as_ref(), env_name.as_ref()) {
        let env_ctx = load_ctx_from_disk(root, name).map_err(|e| e.to_string())?;
        for (k, v) in env_ctx.vars {
            map.insert(k, (v, "env", false));
        }
        secrets = env_ctx.secrets.into_iter().collect();
    }
    if let Some(extra) = extra_vars {
        for (k, v) in extra {
            map.insert(k, (v, "overlay", false));
        }
    }
    // Secrets win over any plain var of the same name (mirrors Ctx::lookup).
    for (k, v) in secrets {
        map.insert(k, (v, "secret", true));
    }

    Ok(map
        .into_iter()
        .map(|(name, (value, source, is_secret))| ResolvedVar {
            name,
            value,
            source,
            is_secret,
        })
        .collect())
}

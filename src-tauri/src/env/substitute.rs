//! M6.2 — Variable substitution engine. Single-pass, non-recursive.

use std::collections::HashMap;

use crate::collection::schema::{Auth, Request, RequestBody};

#[derive(Debug, Default, Clone)]
pub struct Ctx {
    pub vars: HashMap<String, String>,
    pub secrets: HashMap<String, String>,
}

impl Ctx {
    pub fn lookup(&self, name: &str) -> Option<&str> {
        // secrets win on collision (user marked secret = intent)
        self.secrets
            .get(name)
            .or_else(|| self.vars.get(name))
            .map(String::as_str)
    }
}

/// Single-pass `{{name}}` substitution. Unknown names are left as the literal
/// `{{name}}` text. Tolerates whitespace inside braces.
pub fn substitute(input: &str, ctx: &Ctx) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(close_rel) = input[i + 2..].find("}}") {
                let name = input[i + 2..i + 2 + close_rel].trim();
                if let Some(value) = ctx.lookup(name) {
                    out.push_str(value);
                } else {
                    // Preserve original literal so re-substitution later still works
                    out.push_str(&input[i..i + 2 + close_rel + 2]);
                }
                i += 2 + close_rel + 2;
                continue;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// M6.2.2 — walk a Request and substitute every templatable field.

pub fn substitute_request(req: &mut Request, ctx: &Ctx) {
    req.url = substitute(&req.url, ctx);
    for kv in req.headers.iter_mut() {
        kv.key = substitute(&kv.key, ctx);
        kv.value = substitute(&kv.value, ctx);
    }
    for kv in req.params.iter_mut() {
        kv.key = substitute(&kv.key, ctx);
        kv.value = substitute(&kv.value, ctx);
    }
    if let Some(body) = req.body.as_mut() {
        match body {
            RequestBody::Json { value } => *value = substitute(value, ctx),
            RequestBody::Text {
                value,
                content_type,
            } => {
                *value = substitute(value, ctx);
                *content_type = substitute(content_type, ctx);
            }
            RequestBody::FormUrlencoded { fields } | RequestBody::MultipartForm { fields } => {
                for kv in fields.iter_mut() {
                    kv.key = substitute(&kv.key, ctx);
                    kv.value = substitute(&kv.value, ctx);
                }
            }
            RequestBody::GraphQl { query, variables } => {
                *query = substitute(query, ctx);
                *variables = substitute(variables, ctx);
            }
        }
    }
}

// ---- Wire-form (http::types) substitution ----
//
// Today's frontend sends http::types::HttpRequest directly (not via a
// CollectionRequest → materialize path). To enable env-aware sending NOW,
// without forcing a frontend refactor, we provide a parallel walker over
// the wire form. Once a body editor lands and the frontend transitions to
// constructing CollectionRequest, callers should migrate to
// substitute_request (above) + materialize.

use crate::http::types::{HttpRequest as WireRequest, RequestBody as WireBody};

pub fn substitute_http_request(req: &mut WireRequest, ctx: &Ctx) {
    req.url = substitute(&req.url, ctx);
    for (k, v) in req.headers.iter_mut() {
        *k = substitute(k, ctx);
        *v = substitute(v, ctx);
    }
    for (k, v) in req.query.iter_mut() {
        *k = substitute(k, ctx);
        *v = substitute(v, ctx);
    }
    if let Some(body) = req.body.as_mut() {
        match body {
            WireBody::Text {
                value,
                content_type,
            } => {
                *value = substitute(value, ctx);
                *content_type = substitute(content_type, ctx);
            }
            WireBody::Form { fields } => {
                for (k, v) in fields.iter_mut() {
                    *k = substitute(k, ctx);
                    *v = substitute(v, ctx);
                }
            }
            // JSON body substitution on a Value tree is deferred. The wire
            // JSON is already parsed (serde_json::Value), so any {{var}}
            // text appears only in string leaves. Walk the tree and
            // substitute strings only.
            WireBody::Json { value } => substitute_json_value(value, ctx),
            WireBody::None => {}
        }
    }
}

fn substitute_json_value(v: &mut serde_json::Value, ctx: &Ctx) {
    match v {
        serde_json::Value::String(s) => *s = substitute(s, ctx),
        serde_json::Value::Array(items) => {
            for item in items.iter_mut() {
                substitute_json_value(item, ctx);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, val) in map.iter_mut() {
                substitute_json_value(val, ctx);
            }
        }
        _ => {}
    }
}

// ---- Ctx loader from disk + keyring ----

use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum CtxError {
    #[error("env io: {0}")]
    EnvIo(#[from] crate::env::io::EnvIoError),
    #[error("secret unavailable: {0}")]
    SecretUnavailable(String),
}

impl serde::Serialize for CtxError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Load an environment file from `workspace_root/environments/<env_name>.bru`
/// and build a `Ctx` populated with its vars + keyring-resolved secrets.
///
/// If the keyring is unavailable (locked, no platform support), this function
/// returns an error rather than silently falling through. That prevents
/// leaking literal `{{secret}}` text to the upstream API.
pub fn load_ctx_from_disk(workspace_root: &Path, env_name: &str) -> Result<Ctx, CtxError> {
    let env = crate::env::io::read_env(workspace_root, env_name)?;
    let mut ctx = Ctx::default();
    for (k, v) in &env.vars {
        ctx.vars.insert(k.clone(), v.clone());
    }
    for secret_name in &env.secret_names {
        match crate::env::secrets::get(workspace_root, env_name, secret_name) {
            Ok(Some(value)) => {
                ctx.secrets.insert(secret_name.clone(), value);
            }
            Ok(None) => {
                // Secret declared but not set — leave the var unresolved;
                // substitute will leave the literal `{{secret_name}}`.
                // This is intentionally non-fatal (user may not have set
                // every secret on a fresh machine).
            }
            Err(crate::env::secrets::SecretError::Unavailable(msg)) => {
                return Err(CtxError::SecretUnavailable(msg));
            }
            Err(e) => return Err(CtxError::SecretUnavailable(e.to_string())),
        }
    }
    Ok(ctx)
}

pub fn substitute_auth(auth: &mut Auth, ctx: &Ctx) {
    match auth {
        Auth::None => {}
        Auth::Bearer { token } => *token = substitute(token, ctx),
        Auth::Basic { username, password } => {
            *username = substitute(username, ctx);
            *password = substitute(password, ctx);
        }
        Auth::ApiKey {
            key,
            value,
            location,
        } => {
            *key = substitute(key, ctx);
            *value = substitute(value, ctx);
            *location = substitute(location, ctx);
        }
        Auth::OAuth2Cc {
            token_url,
            client_id,
            client_secret,
            scope,
            audience,
        } => {
            *token_url = substitute(token_url, ctx);
            *client_id = substitute(client_id, ctx);
            *client_secret = substitute(client_secret, ctx);
            *scope = substitute(scope, ctx);
            *audience = substitute(audience, ctx);
        }
        Auth::AwsSigV4 {
            access_key_id,
            secret_access_key,
            session_token,
            region,
            service,
        } => {
            *access_key_id = substitute(access_key_id, ctx);
            *secret_access_key = substitute(secret_access_key, ctx);
            if let Some(t) = session_token.as_mut() {
                *t = substitute(t, ctx);
            }
            *region = substitute(region, ctx);
            *service = substitute(service, ctx);
        }
    }
}

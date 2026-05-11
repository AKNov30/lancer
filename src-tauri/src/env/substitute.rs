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

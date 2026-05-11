use crate::collection::lexer;
use crate::collection::schema::{Auth, KvEnabled, Request, RequestBody};
use crate::http::types::Method;

#[derive(Debug, thiserror::Error)]
pub enum BruError {
    #[error("missing block: {0}")]
    MissingBlock(&'static str),
    #[error("unknown method block; expected one of get/post/put/patch/delete/head/options")]
    NoMethodBlock,
    #[error("lex error: {0}")]
    Lex(#[from] lexer::LexError),
    #[error("unknown auth kind: {0}")]
    UnknownAuth(String),
}

/// Parse a complete `.bru` document into a [`Request`].
pub fn parse(input: &str) -> Result<Request, BruError> {
    let blocks = lexer::split_blocks(input)?;

    let meta_text = blocks
        .map
        .get("meta")
        .ok_or(BruError::MissingBlock("meta"))?;
    let meta = lexer::parse_kv_block(meta_text)?;
    let name = meta.get("name").cloned().unwrap_or_default();
    let seq = meta.get("seq").and_then(|s| s.parse().ok());

    // Method block — find the first one that exists.
    const METHODS: &[(&str, Method)] = &[
        ("get", Method::Get),
        ("post", Method::Post),
        ("put", Method::Put),
        ("patch", Method::Patch),
        ("delete", Method::Delete),
        ("head", Method::Head),
        ("options", Method::Options),
    ];
    let (method_text, method) = METHODS
        .iter()
        .find_map(|(name, m)| blocks.map.get(*name).map(|t| (t.clone(), *m)))
        .ok_or(BruError::NoMethodBlock)?;
    let method_kv = lexer::parse_kv_block(&method_text)?;
    let url = method_kv.get("url").cloned().unwrap_or_default();
    let body_marker = method_kv.get("body").cloned();
    let auth_marker = method_kv.get("auth").cloned();

    let headers = blocks
        .map
        .get("headers")
        .map(|s| lexer::parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();
    let params = blocks
        .map
        .get("params:query")
        .map(|s| lexer::parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();
    let vars = blocks
        .map
        .get("vars:pre-request")
        .map(|s| lexer::parse_kv_list(s))
        .transpose()?
        .unwrap_or_default();

    let auth = match auth_marker.as_deref() {
        None | Some("none") => Some(Auth::None),
        Some("bearer") => {
            let kv = lexer::parse_kv_block(
                blocks
                    .map
                    .get("auth:bearer")
                    .ok_or(BruError::MissingBlock("auth:bearer"))?,
            )?;
            Some(Auth::Bearer {
                token: kv.get("token").cloned().unwrap_or_default(),
            })
        }
        Some("basic") => {
            let kv = lexer::parse_kv_block(
                blocks
                    .map
                    .get("auth:basic")
                    .ok_or(BruError::MissingBlock("auth:basic"))?,
            )?;
            Some(Auth::Basic {
                username: kv.get("username").cloned().unwrap_or_default(),
                password: kv.get("password").cloned().unwrap_or_default(),
            })
        }
        Some("apikey") => {
            let kv = lexer::parse_kv_block(
                blocks
                    .map
                    .get("auth:apikey")
                    .ok_or(BruError::MissingBlock("auth:apikey"))?,
            )?;
            Some(Auth::ApiKey {
                key: kv.get("key").cloned().unwrap_or_default(),
                value: kv.get("value").cloned().unwrap_or_default(),
                location: kv.get("in").cloned().unwrap_or_else(|| "header".into()),
            })
        }
        Some("oauth2") => {
            let kv = lexer::parse_kv_block(
                blocks
                    .map
                    .get("auth:oauth2")
                    .ok_or(BruError::MissingBlock("auth:oauth2"))?,
            )?;
            Some(Auth::OAuth2Cc {
                token_url: kv.get("access_token_url").cloned().unwrap_or_default(),
                client_id: kv.get("client_id").cloned().unwrap_or_default(),
                client_secret: kv.get("client_secret").cloned().unwrap_or_default(),
                scope: kv.get("scope").cloned().unwrap_or_default(),
                audience: kv.get("audience").cloned().unwrap_or_default(),
            })
        }
        Some("awsv4") => {
            let kv = lexer::parse_kv_block(
                blocks
                    .map
                    .get("auth:awsv4")
                    .ok_or(BruError::MissingBlock("auth:awsv4"))?,
            )?;
            let session_token = kv.get("session_token").filter(|s| !s.is_empty()).cloned();
            Some(Auth::AwsSigV4 {
                access_key_id: kv.get("access_key_id").cloned().unwrap_or_default(),
                secret_access_key: kv.get("secret_access_key").cloned().unwrap_or_default(),
                session_token,
                region: kv.get("region").cloned().unwrap_or_default(),
                service: kv.get("service").cloned().unwrap_or_default(),
            })
        }
        Some(other) => return Err(BruError::UnknownAuth(other.to_string())),
    };

    let body = match body_marker.as_deref() {
        Some("json") => blocks.map.get("body:json").map(|s| RequestBody::Json {
            value: s.trim().to_string(),
        }),
        Some("text") => blocks.map.get("body:text").map(|s| RequestBody::Text {
            value: s.trim().to_string(),
            content_type: "text/plain".into(),
        }),
        Some("form-urlencoded") => blocks
            .map
            .get("body:form-urlencoded")
            .map(|s| lexer::parse_kv_list(s))
            .transpose()?
            .map(|fields| RequestBody::FormUrlencoded { fields }),
        Some("multipart-form") => blocks
            .map
            .get("body:multipart-form")
            .map(|s| lexer::parse_kv_list(s))
            .transpose()?
            .map(|fields| RequestBody::MultipartForm { fields }),
        Some("graphql") => {
            let block = blocks
                .map
                .get("body:graphql")
                .map(String::as_str)
                .unwrap_or("");
            let variables = blocks
                .map
                .get("body:graphql:vars")
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            Some(RequestBody::GraphQl {
                query: block.trim().to_string(),
                variables,
            })
        }
        _ => None,
    };

    Ok(Request {
        name,
        seq,
        method,
        url,
        headers,
        params,
        body,
        auth,
        vars,
    })
}

pub fn serialize(req: &Request) -> String {
    let mut out = String::new();

    // meta block
    out.push_str("meta {\n");
    out.push_str(&format!("  name: {}\n", req.name));
    out.push_str("  type: http\n");
    if let Some(seq) = req.seq {
        out.push_str(&format!("  seq: {seq}\n"));
    }
    out.push_str("}\n\n");

    // method block — controls the body and auth markers
    let method_str = match req.method {
        Method::Get => "get",
        Method::Post => "post",
        Method::Put => "put",
        Method::Patch => "patch",
        Method::Delete => "delete",
        Method::Head => "head",
        Method::Options => "options",
    };
    out.push_str(&format!("{method_str} {{\n"));
    out.push_str(&format!("  url: {}\n", req.url));
    let body_marker = match &req.body {
        Some(RequestBody::Json { .. }) => "json",
        Some(RequestBody::Text { .. }) => "text",
        Some(RequestBody::FormUrlencoded { .. }) => "form-urlencoded",
        Some(RequestBody::MultipartForm { .. }) => "multipart-form",
        Some(RequestBody::GraphQl { .. }) => "graphql",
        None => "none",
    };
    out.push_str(&format!("  body: {body_marker}\n"));
    let auth_marker = match &req.auth {
        Some(Auth::None) | None => "none",
        Some(Auth::Bearer { .. }) => "bearer",
        Some(Auth::Basic { .. }) => "basic",
        Some(Auth::ApiKey { .. }) => "apikey",
        Some(Auth::OAuth2Cc { .. }) => "oauth2",
        Some(Auth::AwsSigV4 { .. }) => "awsv4",
    };
    out.push_str(&format!("  auth: {auth_marker}\n"));
    out.push_str("}\n\n");

    if !req.headers.is_empty() {
        out.push_str("headers {\n");
        write_kv_list(&mut out, &req.headers);
        out.push_str("}\n\n");
    }

    if !req.params.is_empty() {
        out.push_str("params:query {\n");
        write_kv_list(&mut out, &req.params);
        out.push_str("}\n\n");
    }

    match &req.auth {
        Some(Auth::Bearer { token }) => {
            out.push_str("auth:bearer {\n");
            out.push_str(&format!("  token: {token}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::Basic { username, password }) => {
            out.push_str("auth:basic {\n");
            out.push_str(&format!("  username: {username}\n"));
            out.push_str(&format!("  password: {password}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::ApiKey {
            key,
            value,
            location,
        }) => {
            out.push_str("auth:apikey {\n");
            out.push_str(&format!("  key: {key}\n"));
            out.push_str(&format!("  value: {value}\n"));
            out.push_str(&format!("  in: {location}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::None) | None => {}
        Some(Auth::OAuth2Cc {
            token_url,
            client_id,
            client_secret,
            scope,
            audience,
        }) => {
            out.push_str("auth:oauth2 {\n");
            out.push_str("  grant_type: client_credentials\n");
            out.push_str(&format!("  access_token_url: {token_url}\n"));
            out.push_str(&format!("  client_id: {client_id}\n"));
            out.push_str(&format!("  client_secret: {client_secret}\n"));
            out.push_str(&format!("  scope: {scope}\n"));
            out.push_str(&format!("  audience: {audience}\n"));
            out.push_str("}\n\n");
        }
        Some(Auth::AwsSigV4 {
            access_key_id,
            secret_access_key,
            session_token,
            region,
            service,
        }) => {
            out.push_str("auth:awsv4 {\n");
            out.push_str(&format!("  access_key_id: {access_key_id}\n"));
            out.push_str(&format!("  secret_access_key: {secret_access_key}\n"));
            if let Some(token) = session_token {
                out.push_str(&format!("  session_token: {token}\n"));
            }
            out.push_str(&format!("  region: {region}\n"));
            out.push_str(&format!("  service: {service}\n"));
            out.push_str("}\n\n");
        }
    }

    match &req.body {
        Some(RequestBody::Json { value }) => {
            out.push_str("body:json {\n");
            out.push_str(value.trim());
            out.push_str("\n}\n\n");
        }
        Some(RequestBody::Text { value, .. }) => {
            out.push_str("body:text {\n");
            out.push_str(value.trim());
            out.push_str("\n}\n\n");
        }
        Some(RequestBody::FormUrlencoded { fields }) => {
            out.push_str("body:form-urlencoded {\n");
            write_kv_list(&mut out, fields);
            out.push_str("}\n\n");
        }
        Some(RequestBody::MultipartForm { fields }) => {
            out.push_str("body:multipart-form {\n");
            write_kv_list(&mut out, fields);
            out.push_str("}\n\n");
        }
        Some(RequestBody::GraphQl { query, variables }) => {
            out.push_str("body:graphql {\n");
            out.push_str(query.trim());
            out.push_str("\n}\n\n");
            if !variables.trim().is_empty() {
                out.push_str("body:graphql:vars {\n");
                out.push_str(variables.trim());
                out.push_str("\n}\n\n");
            }
        }
        None => {}
    }

    if !req.vars.is_empty() {
        out.push_str("vars:pre-request {\n");
        write_kv_list(&mut out, &req.vars);
        out.push_str("}\n");
    }

    out
}

fn write_kv_list(out: &mut String, list: &[KvEnabled]) {
    for kv in list {
        let prefix = if kv.enabled { "" } else { "~" };
        out.push_str(&format!("  {prefix}{}: {}\n", kv.key, kv.value));
    }
}

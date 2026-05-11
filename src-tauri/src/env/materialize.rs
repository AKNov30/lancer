//! M6.2.3 — Convert a (post-substitution) collection::schema::Request to
//! http::types::HttpRequest, ready for the wire.

use crate::collection::schema::{Auth, Request as SchemaRequest, RequestBody as SchemaBody};
use crate::http::types::{HttpRequest, Method, RequestBody as WireBody};

#[derive(Debug, thiserror::Error)]
pub enum MaterializeError {
    #[error("invalid JSON body after substitution: {0}")]
    InvalidJson(#[from] serde_json::Error),
}

impl serde::Serialize for MaterializeError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Take a post-substitution `collection::schema::Request` and produce an
/// `http::types::HttpRequest` ready to hit the wire. JSON bodies are parsed
/// here — if substitution injected invalid JSON (e.g., a templated value
/// broke the structure), this is where we catch it cleanly.
pub fn materialize(req: &SchemaRequest) -> Result<HttpRequest, MaterializeError> {
    let headers = req
        .headers
        .iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key.clone(), kv.value.clone()))
        .collect();
    let query = req
        .params
        .iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key.clone(), kv.value.clone()))
        .collect();

    let body = req
        .body
        .as_ref()
        .map(|b| match b {
            SchemaBody::Json { value } => {
                let json: serde_json::Value = serde_json::from_str(value)?;
                Ok::<WireBody, MaterializeError>(WireBody::Json { value: json })
            }
            SchemaBody::Text {
                value,
                content_type,
            } => Ok(WireBody::Text {
                value: value.clone(),
                content_type: content_type.clone(),
            }),
            SchemaBody::FormUrlencoded { fields } => {
                let kept = fields
                    .iter()
                    .filter(|kv| kv.enabled)
                    .map(|kv| (kv.key.clone(), kv.value.clone()))
                    .collect();
                Ok(WireBody::Form { fields: kept })
            }
            SchemaBody::Binary { path, content_type } => Ok(WireBody::Binary {
                path: std::path::PathBuf::from(path),
                content_type: content_type.clone(),
            }),
            // Multipart and GraphQL not yet supported on the wire — fall back to None.
            SchemaBody::MultipartForm { .. } | SchemaBody::GraphQl { .. } => Ok(WireBody::None),
        })
        .transpose()?;

    Ok(HttpRequest {
        url: req.url.clone(),
        method: req.method,
        headers,
        query,
        body,
    })
}

/// Convenience: the schema::Auth IS the same shape used for wire-side
/// `apply_auth`, so no conversion is needed today. This function returns the
/// auth unchanged (clone). It exists as a seam for future divergence.
pub fn materialize_auth(auth: &Auth) -> Auth {
    auth.clone()
}

// Suppress unused import warning — Method is part of the public contract
// expressed in the return type of `materialize`.
const _: fn() = || {
    let _: Method = Method::Get;
};

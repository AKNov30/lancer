use base64::Engine;
use thiserror::Error;

use crate::collection::schema::Auth;
use crate::http::types::HttpRequest;
use crate::state::AppState;

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("oauth2 token fetch failed: {0}")]
    OAuth2(String),
    #[error("aws sigv4 signing failed: {0}")]
    AwsSigV4(String),
    #[error("invalid value: {0}")]
    Invalid(String),
}

impl serde::Serialize for AuthError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub async fn apply_auth(
    mut req: HttpRequest,
    auth: &Auth,
    _state: &AppState,
) -> Result<HttpRequest, AuthError> {
    match auth {
        Auth::None => Ok(req),
        Auth::Bearer { token } => {
            req.headers
                .push(("Authorization".into(), format!("Bearer {token}")));
            Ok(req)
        }
        Auth::Basic { username, password } => {
            let raw = format!("{username}:{password}");
            let b64 = base64::engine::general_purpose::STANDARD.encode(raw);
            req.headers
                .push(("Authorization".into(), format!("Basic {b64}")));
            Ok(req)
        }
        Auth::ApiKey {
            key,
            value,
            location,
        } => {
            match location.as_str() {
                "header" => req.headers.push((key.clone(), value.clone())),
                "query" => req.query.push((key.clone(), value.clone())),
                other => {
                    return Err(AuthError::Invalid(format!(
                        "ApiKey location must be 'header' or 'query', got '{other}'"
                    )));
                }
            }
            Ok(req)
        }
        Auth::OAuth2Cc { .. } => Err(AuthError::OAuth2(
            "OAuth 2 not yet implemented (M5.5)".into(),
        )),
        Auth::AwsSigV4 { .. } => Err(AuthError::AwsSigV4(
            "AWS SigV4 not yet implemented (M5.6)".into(),
        )),
    }
}

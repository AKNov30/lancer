use base64::Engine;
use std::time::{Duration, SystemTime};
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

async fn fetch_oauth2_token(
    token_url: &str,
    client_id: &str,
    client_secret: &str,
    scope: &str,
    audience: &str,
) -> Result<crate::state::OAuth2Entry, AuthError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AuthError::OAuth2(e.to_string()))?;
    let mut form: Vec<(&str, &str)> = vec![
        ("grant_type", "client_credentials"),
        ("client_id", client_id),
        ("client_secret", client_secret),
    ];
    if !scope.is_empty() {
        form.push(("scope", scope));
    }
    if !audience.is_empty() {
        form.push(("audience", audience));
    }

    let resp = client
        .post(token_url)
        .form(&form)
        .send()
        .await
        .map_err(|e| AuthError::OAuth2(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(AuthError::OAuth2(format!(
            "token endpoint returned {}",
            resp.status()
        )));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AuthError::OAuth2(e.to_string()))?;

    let access_token = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AuthError::OAuth2("token response missing access_token".into()))?
        .to_string();
    let expires_in = body
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(3600);
    Ok(crate::state::OAuth2Entry {
        access_token,
        expires_at: SystemTime::now() + Duration::from_secs(expires_in.saturating_sub(60)),
    })
}

pub async fn apply_auth(
    mut req: HttpRequest,
    auth: &Auth,
    state: &AppState,
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
        Auth::OAuth2Cc {
            token_url,
            client_id,
            client_secret,
            scope,
            audience,
        } => {
            let key = format!("{token_url}|{client_id}|{scope}|{audience}");
            let entry = if let Some(e) = state.oauth2_cache.get(&key).await {
                e
            } else {
                let fresh =
                    fetch_oauth2_token(token_url, client_id, client_secret, scope, audience)
                        .await?;
                state.oauth2_cache.put(key, fresh.clone()).await;
                fresh
            };
            req.headers.push((
                "Authorization".into(),
                format!("Bearer {}", entry.access_token),
            ));
            Ok(req)
        }
        Auth::AwsSigV4 { .. } => Err(AuthError::AwsSigV4(
            "AWS SigV4 not yet implemented (M5.6)".into(),
        )),
    }
}

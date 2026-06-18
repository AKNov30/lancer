use aws_credential_types::Credentials;
use aws_sigv4::http_request::{sign, SignableBody, SignableRequest, SigningSettings};
use aws_sigv4::sign::v4;
use base64::Engine;
use sha2::{Digest, Sha256};
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

/// Returns a hex SHA-256 digest of the five OAuth2 CC fields, separated by
/// the ASCII Unit Separator (0x1F) which cannot appear in normal config strings.
/// Includes client_secret so that rotated secrets invalidate the cached token.
pub(crate) fn oauth2_cache_key(
    token_url: &str,
    client_id: &str,
    client_secret: &str,
    scope: &str,
    audience: &str,
) -> String {
    let mut h = Sha256::new();
    for part in [token_url, client_id, client_secret, scope, audience] {
        h.update(part.as_bytes());
        h.update(b"\x1f"); // unit separator — won't appear in inputs
    }
    format!("{:x}", h.finalize())
}

/// Rejects any header value that contains control characters (0x00–0x1F or
/// 0x7F). These are unsafe and forbidden in HTTP/1.1 header field values.
fn validate_header_safe(value: &str, field: &str) -> Result<(), AuthError> {
    if value.bytes().any(|b| matches!(b, 0..=0x1F | 0x7F)) {
        return Err(AuthError::Invalid(format!(
            "{field} contains control characters; this is unsafe in HTTP headers"
        )));
    }
    Ok(())
}

async fn fetch_oauth2_token(
    client: &reqwest::Client,
    token_url: &str,
    client_id: &str,
    client_secret: &str,
    scope: &str,
    audience: &str,
) -> Result<crate::state::OAuth2Entry, AuthError> {
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

fn sign_aws(
    req: &mut HttpRequest,
    access_key_id: &str,
    secret_access_key: &str,
    session_token: &Option<String>,
    region: &str,
    service: &str,
) -> Result<(), AuthError> {
    let creds = Credentials::new(
        access_key_id,
        secret_access_key,
        session_token.clone(),
        None,
        "lancer",
    );

    let identity = creds.into();

    let signing_params = v4::SigningParams::builder()
        .identity(&identity)
        .region(region)
        .name(service)
        .time(SystemTime::now())
        .settings(SigningSettings::default())
        .build()
        .map_err(|e| AuthError::AwsSigV4(e.to_string()))?
        .into();

    let body_bytes: Vec<u8> = match &req.body {
        None | Some(crate::http::types::RequestBody::None) => Vec::new(),
        Some(crate::http::types::RequestBody::Json { value }) => {
            serde_json::to_vec(value).map_err(|e| AuthError::AwsSigV4(e.to_string()))?
        }
        Some(crate::http::types::RequestBody::Text { value, .. }) => value.as_bytes().to_vec(),
        Some(crate::http::types::RequestBody::Form { fields }) => fields
            .iter()
            .enumerate()
            .fold(String::new(), |mut acc, (i, (k, v))| {
                if i > 0 {
                    acc.push('&');
                }
                acc.push_str(k);
                acc.push('=');
                acc.push_str(v);
                acc
            })
            .into_bytes(),
        Some(crate::http::types::RequestBody::Binary { path, .. }) => {
            use std::io::Read as _;
            let mut file = std::fs::File::open(path)
                .map_err(|e| AuthError::AwsSigV4(format!("binary body open: {e}")))?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| AuthError::AwsSigV4(format!("binary body read: {e}")))?;
            bytes
        }
        Some(crate::http::types::RequestBody::Multipart { .. }) => {
            // The multipart boundary is generated by reqwest at send time, so
            // we can't reproduce the exact signed body here — signing the wrong
            // bytes would yield a request the server rejects. Fail loudly rather
            // than send a silently-broken signature.
            return Err(AuthError::AwsSigV4(
                "AWS SigV4 signing of multipart/form-data bodies is not supported".into(),
            ));
        }
    };

    let headers_ref: Vec<(&str, &str)> = req
        .headers
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let method_str = match req.method {
        crate::http::types::Method::Get => "GET",
        crate::http::types::Method::Post => "POST",
        crate::http::types::Method::Put => "PUT",
        crate::http::types::Method::Patch => "PATCH",
        crate::http::types::Method::Delete => "DELETE",
        crate::http::types::Method::Head => "HEAD",
        crate::http::types::Method::Options => "OPTIONS",
    };

    let signable = SignableRequest::new(
        method_str,
        req.url.as_str(),
        headers_ref.into_iter(),
        SignableBody::Bytes(&body_bytes),
    )
    .map_err(|e| AuthError::AwsSigV4(e.to_string()))?;

    let signing_output =
        sign(signable, &signing_params).map_err(|e| AuthError::AwsSigV4(e.to_string()))?;
    let (instructions, _signature) = signing_output.into_parts();

    for (name, value) in instructions.headers() {
        req.headers.push((name.to_string(), value.to_string()));
    }

    Ok(())
}

pub async fn apply_auth(
    mut req: HttpRequest,
    auth: &Auth,
    state: &AppState,
) -> Result<HttpRequest, AuthError> {
    match auth {
        Auth::None => Ok(req),
        Auth::Bearer { token } => {
            validate_header_safe(token, "Bearer token")?;
            req.headers
                .push(("Authorization".into(), format!("Bearer {token}")));
            Ok(req)
        }
        Auth::Basic { username, password } => {
            validate_header_safe(username, "Basic username")?;
            validate_header_safe(password, "Basic password")?;
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
                "header" => {
                    validate_header_safe(key, "ApiKey key")?;
                    validate_header_safe(value, "ApiKey value")?;
                    req.headers.push((key.clone(), value.clone()));
                }
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
            let key = oauth2_cache_key(token_url, client_id, client_secret, scope, audience);
            let entry = if let Some(e) = state.oauth2_cache.get(&key).await {
                e
            } else {
                let client = state.http_client();
                let fresh = fetch_oauth2_token(
                    &client,
                    token_url,
                    client_id,
                    client_secret,
                    scope,
                    audience,
                )
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
        Auth::AwsSigV4 {
            access_key_id,
            secret_access_key,
            session_token,
            region,
            service,
        } => {
            sign_aws(
                &mut req,
                access_key_id,
                secret_access_key,
                session_token,
                region,
                service,
            )?;
            Ok(req)
        }
    }
}

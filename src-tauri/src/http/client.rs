use crate::http::types::{HttpRequest, HttpResponse, Method, RequestBody};
use std::time::{Duration, Instant};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid header value: {0}")]
    InvalidHeader(String),
}

impl serde::Serialize for HttpError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

const REQUEST_TIMEOUT_SECS: u64 = 30;
const CONNECT_TIMEOUT_SECS: u64 = 10;

pub async fn send(req: HttpRequest) -> Result<HttpResponse, HttpError> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Lancer/", env!("CARGO_PKG_VERSION")))
        .cookie_store(true)
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;

    let method = match req.method {
        Method::Get => reqwest::Method::GET,
        Method::Post => reqwest::Method::POST,
        Method::Put => reqwest::Method::PUT,
        Method::Patch => reqwest::Method::PATCH,
        Method::Delete => reqwest::Method::DELETE,
        Method::Head => reqwest::Method::HEAD,
        Method::Options => reqwest::Method::OPTIONS,
    };

    let mut builder = client.request(method, &req.url);

    for (k, v) in &req.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    if !req.query.is_empty() {
        builder = builder.query(&req.query);
    }

    builder = match req.body {
        Some(RequestBody::Json { value }) => builder.json(&value),
        Some(RequestBody::Text {
            value,
            content_type,
        }) => builder
            .header("content-type", content_type.as_str())
            .body(value),
        Some(RequestBody::Form { fields }) => builder.form(&fields),
        Some(RequestBody::None) | None => builder,
    };

    let start = Instant::now();
    let resp = builder.send().await?;
    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_bytes = resp.bytes().await?.to_vec();
    let elapsed_ms = start.elapsed().as_millis();
    let size_bytes = body_bytes.len();
    let body_text = std::str::from_utf8(&body_bytes).ok().map(String::from);

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body: body_bytes,
        body_text,
        elapsed_ms,
        size_bytes,
    })
}

use crate::http::types::{HttpRequest, HttpResponse, Method, RequestBody};
use std::io::Read as _;
use std::time::Instant;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("invalid header value: {0}")]
    InvalidHeader(String),
    #[error("binary body io error: {0}")]
    BinaryIo(String),
}

impl serde::Serialize for HttpError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub async fn send(client: &reqwest::Client, req: HttpRequest) -> Result<HttpResponse, HttpError> {
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
        Some(RequestBody::Binary { path, content_type }) => {
            let mut file =
                std::fs::File::open(&path).map_err(|e| HttpError::BinaryIo(e.to_string()))?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| HttpError::BinaryIo(e.to_string()))?;
            builder
                .header("content-type", content_type.as_str())
                .body(bytes)
        }
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

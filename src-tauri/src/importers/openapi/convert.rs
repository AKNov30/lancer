use openapiv3::{
    OpenAPI, Operation, Parameter, ParameterSchemaOrContent, ReferenceOr, RequestBody,
    SecurityScheme,
};

use crate::collection::schema::{Auth, KvEnabled, Request as BruRequest, RequestBody as BruBody};
use crate::http::types::Method;

#[derive(Debug, thiserror::Error)]
pub enum ConvertError {
    #[error("unsupported HTTP method: {0}")]
    UnsupportedMethod(String),
    #[error("failed to serialize example to JSON: {0}")]
    ExampleJson(#[from] serde_json::Error),
}

/// Convert a single OpenAPI operation into a Lancer `.bru` [`BruRequest`].
///
/// - `path`: the URL path template, e.g. `/pets/{id}`
/// - `method`: lowercase HTTP method string, e.g. `"get"`
/// - `op`: the parsed [`Operation`]
/// - `spec`: the full spec (needed for `$ref` resolution of security schemes)
pub fn convert_operation(
    path: &str,
    method: &str,
    op: &Operation,
    spec: &OpenAPI,
) -> Result<BruRequest, ConvertError> {
    let bru_method = parse_method(method)?;

    // URL: prepend {{baseUrl}} so it picks up the env var at runtime.
    let url = format!("{{{{baseUrl}}}}{path}");

    // Name: prefer operationId, fall back to "METHOD /path".
    let name = op
        .operation_id
        .clone()
        .unwrap_or_else(|| format!("{} {path}", method.to_uppercase()));

    // Query params and headers from parameters list.
    let mut params: Vec<KvEnabled> = Vec::new();
    let mut headers: Vec<KvEnabled> = Vec::new();

    for param_ref in &op.parameters {
        let param = match param_ref {
            ReferenceOr::Item(p) => p,
            ReferenceOr::Reference { .. } => continue, // skip unresolved refs
        };

        match param {
            Parameter::Query { parameter_data, .. } => {
                let value = extract_param_example(parameter_data);
                params.push(KvEnabled {
                    key: parameter_data.name.clone(),
                    value,
                    enabled: true,
                });
            }
            Parameter::Header { parameter_data, .. } => {
                let value = extract_param_example(parameter_data);
                headers.push(KvEnabled {
                    key: parameter_data.name.clone(),
                    value,
                    enabled: true,
                });
            }
            Parameter::Path { .. } => {
                // Path params are baked into the URL template — skip.
            }
            Parameter::Cookie { .. } => {
                // Cookies not representable in .bru — skip.
            }
        }
    }

    // Request body.
    let body = extract_body(op)?;

    // Auth: look at the operation-level security requirement first, then
    // fall back to the global security. Map the first scheme found.
    let auth = resolve_auth(op, spec);

    Ok(BruRequest {
        name,
        seq: None,
        method: bru_method,
        url,
        headers,
        params,
        body,
        auth,
        vars: Vec::new(),
        pre_request_script: None,
        post_response_script: None,
    })
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn parse_method(method: &str) -> Result<Method, ConvertError> {
    match method.to_ascii_lowercase().as_str() {
        "get" => Ok(Method::Get),
        "post" => Ok(Method::Post),
        "put" => Ok(Method::Put),
        "patch" => Ok(Method::Patch),
        "delete" => Ok(Method::Delete),
        "head" => Ok(Method::Head),
        "options" => Ok(Method::Options),
        other => Err(ConvertError::UnsupportedMethod(other.to_string())),
    }
}

fn extract_param_example(data: &openapiv3::ParameterData) -> String {
    // Try the example directly on the parameter first.
    if let Some(ex) = &data.example {
        return json_value_to_string(ex);
    }
    // Then check schema examples.
    match &data.format {
        ParameterSchemaOrContent::Schema(schema_ref) => {
            if let ReferenceOr::Item(schema) = schema_ref {
                if let Some(ex) = &schema.schema_data.example {
                    return json_value_to_string(ex);
                }
            }
        }
        ParameterSchemaOrContent::Content(_) => {}
    }
    String::new()
}

fn json_value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn extract_body(op: &Operation) -> Result<Option<BruBody>, ConvertError> {
    let body_ref = match &op.request_body {
        Some(b) => b,
        None => return Ok(None),
    };

    let body: &RequestBody = match body_ref {
        ReferenceOr::Item(b) => b,
        ReferenceOr::Reference { .. } => return Ok(None),
    };

    // Look for application/json media type.
    if let Some(media) = body.content.get("application/json") {
        // Try to pull an example from the media type.
        let example_str = if let Some(ex) = &media.example {
            serde_json::to_string_pretty(ex)?
        } else if !media.examples.is_empty() {
            // Take the first named example.
            let first = media.examples.values().next();
            match first {
                Some(ReferenceOr::Item(ex_obj)) => {
                    if let Some(val) = &ex_obj.value {
                        serde_json::to_string_pretty(val)?
                    } else {
                        String::new()
                    }
                }
                _ => String::new(),
            }
        } else {
            String::new()
        };

        return Ok(Some(BruBody::Json { value: example_str }));
    }

    Ok(None)
}

fn resolve_auth(op: &Operation, spec: &OpenAPI) -> Option<Auth> {
    // Prefer operation-level security, then global.
    let security_reqs = if let Some(s) = &op.security {
        s.as_slice()
    } else if let Some(s) = &spec.security {
        s.as_slice()
    } else {
        return None;
    };

    // Empty array means "no auth required".
    if security_reqs.is_empty() {
        return None;
    }

    // Take the first non-empty requirement and look up the scheme name.
    for req in security_reqs {
        for scheme_name in req.keys() {
            if let Some(scheme) = lookup_security_scheme(spec, scheme_name) {
                if let Some(auth) = map_scheme_to_auth(scheme) {
                    return Some(auth);
                }
            }
        }
    }

    None
}

fn lookup_security_scheme<'a>(spec: &'a OpenAPI, name: &str) -> Option<&'a SecurityScheme> {
    let components = spec.components.as_ref()?;
    let scheme_ref = components.security_schemes.get(name)?;
    match scheme_ref {
        ReferenceOr::Item(s) => Some(s),
        ReferenceOr::Reference { .. } => None,
    }
}

fn map_scheme_to_auth(scheme: &SecurityScheme) -> Option<Auth> {
    match scheme {
        SecurityScheme::HTTP { scheme, .. } => match scheme.to_ascii_lowercase().as_str() {
            "bearer" => Some(Auth::Bearer {
                token: String::new(),
            }),
            "basic" => Some(Auth::Basic {
                username: String::new(),
                password: String::new(),
            }),
            _ => None,
        },
        SecurityScheme::APIKey { location, name, .. } => {
            use openapiv3::APIKeyLocation;
            let loc = match location {
                APIKeyLocation::Header => "header",
                APIKeyLocation::Query => "query",
                APIKeyLocation::Cookie => "cookie",
            };
            Some(Auth::ApiKey {
                key: name.clone(),
                value: String::new(),
                location: loc.to_string(),
            })
        }
        SecurityScheme::OAuth2 { flows, .. } => {
            // Only client_credentials grant maps directly to our OAuth2Cc type.
            flows.client_credentials.as_ref().map(|cc| Auth::OAuth2Cc {
                token_url: cc.token_url.clone(),
                client_id: String::new(),
                client_secret: String::new(),
                scope: String::new(),
                audience: String::new(),
            })
        }
        SecurityScheme::OpenIDConnect { .. } => None,
    }
}

use axum::{
    response::{IntoResponse, Json},
    routing::MethodRouter,
    Router,
};
use openapiv3::{OpenAPI, ReferenceOr};
use tower_http::cors::{Any, CorsLayer};

/// Build an axum `Router` from an OpenAPI spec.
///
/// - Every `path × method` in `spec.paths` gets a route handler that returns
///   the chosen example body as JSON with status 200.
/// - OAS path templates (`/pets/{id}`) are converted to axum's syntax (`/pets/:id`).
/// - A permissive CORS layer is applied so browser dev pages can reach the mock.
pub fn build(spec: &OpenAPI) -> Router {
    let mut router = Router::new();

    for (path_str, path_ref) in &spec.paths.paths {
        let path_item = match path_ref {
            ReferenceOr::Item(item) => item,
            ReferenceOr::Reference { .. } => continue,
        };

        let axum_path = convert_path(path_str);

        let method_router = collect_methods(path_item, spec);
        if let Some(mr) = method_router {
            router = router.route(&axum_path, mr);
        }
    }

    router.layer(
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any),
    )
}

/// Convert an OAS path template to axum's colon-param syntax.
/// `/pets/{id}` → `/pets/:id`
fn convert_path(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            out.push(':');
            for inner in chars.by_ref() {
                if inner == '}' {
                    break;
                }
                out.push(inner);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Build a `MethodRouter` for all methods defined on a path item.
fn collect_methods(item: &openapiv3::PathItem, spec: &OpenAPI) -> Option<MethodRouter> {
    let mut mr: Option<MethodRouter> = None;

    macro_rules! add {
        ($field:ident, $method:ident) => {
            if let Some(op) = &item.$field {
                let example = super::responses::pick_example(op, spec);
                let handler = move || {
                    let v = example.clone();
                    async move { Json(v).into_response() }
                };
                mr = Some(match mr.take() {
                    None => axum::routing::$method(handler),
                    Some(existing) => existing.$method(handler),
                });
            }
        };
    }

    add!(get, get);
    add!(post, post);
    add!(put, put);
    add!(patch, patch);
    add!(delete, delete);
    add!(head, head);
    add!(options, options);

    mr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn petstore_spec() -> OpenAPI {
        crate::importers::openapi::load::load_spec(std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/tests/fixtures/petstore-3.0.yaml"
        )))
        .expect("load petstore fixture")
    }

    #[test]
    fn convert_path_braces_to_colon() {
        assert_eq!(convert_path("/pets/{id}"), "/pets/:id");
        assert_eq!(
            convert_path("/users/{userId}/orders/{orderId}"),
            "/users/:userId/orders/:orderId"
        );
        assert_eq!(convert_path("/pets"), "/pets");
    }

    #[tokio::test]
    async fn router_serves_get_pets() {
        use tower::ServiceExt;
        let spec = petstore_spec();
        let router = build(&spec);
        let req = http::Request::builder()
            .uri("/pets")
            .body(axum::body::Body::empty())
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), 200);
    }

    #[tokio::test]
    async fn router_404_unmapped_path() {
        use tower::ServiceExt;
        let spec = petstore_spec();
        let router = build(&spec);
        let req = http::Request::builder()
            .uri("/unknown-path-xyz")
            .body(axum::body::Body::empty())
            .unwrap();
        let resp = router.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), 404);
    }
}

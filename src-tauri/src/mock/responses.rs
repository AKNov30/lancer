use openapiv3::{OpenAPI, Operation, ReferenceOr, Schema, SchemaKind, StatusCode, Type};
use serde_json::Value;

/// Pick the best example value to return for a given operation.
///
/// Priority:
/// 1. `content["application/json"].example` on the first 2xx (or "default") response
/// 2. `schema_data.example` on that media type's schema
/// 3. Skeleton value generated from the schema type
/// 4. `Value::Null` as the ultimate fallback
pub fn pick_example(op: &Operation, spec: &OpenAPI) -> Value {
    let responses = &op.responses;

    // Build a priority list: explicit 2xx codes first (sorted), then "default".
    let mut two_xx: Vec<(&StatusCode, &ReferenceOr<openapiv3::Response>)> = responses
        .responses
        .iter()
        .filter(|(sc, _)| match sc {
            StatusCode::Code(n) => *n >= 200 && *n < 300,
            StatusCode::Range(n) => *n == 2,
        })
        .collect();
    two_xx.sort_by_key(|(sc, _)| match sc {
        StatusCode::Code(n) => *n,
        StatusCode::Range(_) => 200,
    });

    let mut candidates: Vec<&ReferenceOr<openapiv3::Response>> =
        two_xx.into_iter().map(|(_, r)| r).collect();

    if let Some(default_resp) = &responses.default {
        candidates.push(default_resp);
    }

    for resp_ref in candidates {
        let response: &openapiv3::Response = match resp_ref {
            ReferenceOr::Item(r) => r,
            ReferenceOr::Reference { reference } => {
                if let Some(resolved) = resolve_response_ref(reference, spec) {
                    resolved
                } else {
                    continue;
                }
            }
        };

        if let Some(media) = response.content.get("application/json") {
            // 1. Inline example on the media type object.
            if let Some(ex) = &media.example {
                return ex.clone();
            }

            // 2. First named example.
            if !media.examples.is_empty() {
                for ex_ref in media.examples.values() {
                    if let ReferenceOr::Item(ex_obj) = ex_ref {
                        if let Some(val) = &ex_obj.value {
                            return val.clone();
                        }
                    }
                }
            }

            // 3. Example / skeleton from schema.
            if let Some(schema_ref) = &media.schema {
                let schema: &Schema = match schema_ref {
                    ReferenceOr::Item(s) => s,
                    ReferenceOr::Reference { reference } => {
                        if let Some(s) = resolve_schema_ref(reference, spec) {
                            s
                        } else {
                            continue;
                        }
                    }
                };
                if let Some(ex) = &schema.schema_data.example {
                    return ex.clone();
                }
                return example_from_schema(schema, spec, 0);
            }
        }
    }

    Value::Null
}

/// Recursively generate a skeletal example value from a schema.
/// `depth` guards against infinite recursion in circular $refs.
pub fn example_from_schema(schema: &Schema, spec: &OpenAPI, depth: u8) -> Value {
    if depth > 5 {
        return Value::Null;
    }

    // schema_data.example takes priority.
    if let Some(ex) = &schema.schema_data.example {
        return ex.clone();
    }

    match &schema.schema_kind {
        SchemaKind::Type(t) => match t {
            Type::String(_) => Value::String("string".into()),
            Type::Integer(_) => Value::from(0_i64),
            Type::Number(_) => Value::from(0.0_f64),
            Type::Boolean(_) => Value::Bool(false),
            Type::Array(arr) => {
                if let Some(items_ref) = &arr.items {
                    // items_ref is &ReferenceOr<Box<Schema>>
                    let item_schema: Option<&Schema> = match items_ref {
                        ReferenceOr::Item(boxed) => Some(boxed.as_ref()),
                        ReferenceOr::Reference { reference } => resolve_schema_ref(reference, spec),
                    };
                    if let Some(s) = item_schema {
                        return Value::Array(vec![example_from_schema(s, spec, depth + 1)]);
                    }
                }
                Value::Array(vec![])
            }
            Type::Object(obj) => {
                let mut map = serde_json::Map::new();
                for (k, prop_ref) in &obj.properties {
                    // prop_ref is &ReferenceOr<Box<Schema>>
                    let prop_schema: Option<&Schema> = match prop_ref {
                        ReferenceOr::Item(boxed) => Some(boxed.as_ref()),
                        ReferenceOr::Reference { reference } => resolve_schema_ref(reference, spec),
                    };
                    if let Some(s) = prop_schema {
                        map.insert(k.clone(), example_from_schema(s, spec, depth + 1));
                    }
                }
                Value::Object(map)
            }
        },
        SchemaKind::AllOf { all_of } => {
            let mut merged = serde_json::Map::new();
            for sub_ref in all_of {
                // sub_ref is &ReferenceOr<Schema> (not boxed)
                let sub: Option<&Schema> = match sub_ref {
                    ReferenceOr::Item(s) => Some(s),
                    ReferenceOr::Reference { reference } => resolve_schema_ref(reference, spec),
                };
                if let Some(s) = sub {
                    if let Value::Object(obj) = example_from_schema(s, spec, depth + 1) {
                        merged.extend(obj);
                    }
                }
            }
            if merged.is_empty() {
                Value::Null
            } else {
                Value::Object(merged)
            }
        }
        SchemaKind::OneOf { one_of } | SchemaKind::AnyOf { any_of: one_of } => {
            for sub_ref in one_of {
                let sub: Option<&Schema> = match sub_ref {
                    ReferenceOr::Item(s) => Some(s),
                    ReferenceOr::Reference { reference } => resolve_schema_ref(reference, spec),
                };
                if let Some(s) = sub {
                    let v = example_from_schema(s, spec, depth + 1);
                    if v != Value::Null {
                        return v;
                    }
                }
            }
            Value::Null
        }
        SchemaKind::Not { .. } => Value::Null,
        SchemaKind::Any(any) => match any.typ.as_deref() {
            Some("string") => Value::String("string".into()),
            Some("integer") => Value::from(0_i64),
            Some("number") => Value::from(0.0_f64),
            Some("boolean") => Value::Bool(false),
            Some("array") => Value::Array(vec![]),
            Some("object") => {
                let mut map = serde_json::Map::new();
                for (k, prop_ref) in &any.properties {
                    // prop_ref is &ReferenceOr<Box<Schema>>
                    let prop_schema: Option<&Schema> = match prop_ref {
                        ReferenceOr::Item(boxed) => Some(boxed.as_ref()),
                        ReferenceOr::Reference { reference } => resolve_schema_ref(reference, spec),
                    };
                    if let Some(s) = prop_schema {
                        map.insert(k.clone(), example_from_schema(s, spec, depth + 1));
                    }
                }
                Value::Object(map)
            }
            _ => Value::Null,
        },
    }
}

// ── $ref resolution helpers ──────────────────────────────────────────────────

fn resolve_response_ref<'a>(reference: &str, spec: &'a OpenAPI) -> Option<&'a openapiv3::Response> {
    let name = reference.strip_prefix("#/components/responses/")?;
    let components = spec.components.as_ref()?;
    match components.responses.get(name)? {
        ReferenceOr::Item(r) => Some(r),
        ReferenceOr::Reference { .. } => None,
    }
}

fn resolve_schema_ref<'a>(reference: &str, spec: &'a OpenAPI) -> Option<&'a Schema> {
    let name = reference.strip_prefix("#/components/schemas/")?;
    let components = spec.components.as_ref()?;
    match components.schemas.get(name)? {
        ReferenceOr::Item(s) => Some(s),
        ReferenceOr::Reference { .. } => None,
    }
}

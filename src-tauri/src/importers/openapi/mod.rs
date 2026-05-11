//! OpenAPI 3.0/3.1 → Lancer `.bru` collection importer.
//!
//! Crate choice: `openapiv3 = "2"` (supports OAS 3.0.x, well-maintained, stable
//! deserialization API). Handles both YAML and JSON input via `serde_yaml`.
//!
//! Entry point: [`walk::import_spec`].

pub mod convert;
pub mod load;
pub mod walk;

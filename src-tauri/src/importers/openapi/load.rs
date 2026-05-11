use openapiv3::OpenAPI;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("yaml parse: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("json parse: {0}")]
    Json(#[from] serde_json::Error),
    #[error("unsupported file extension (expected .yaml, .yml, or .json)")]
    UnsupportedExtension,
}

/// Load an OpenAPI 3.x spec from a YAML or JSON file.
pub fn load_spec(path: &Path) -> Result<OpenAPI, LoadError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let text = std::fs::read_to_string(path)?;

    match ext.as_str() {
        "yaml" | "yml" => {
            let spec: OpenAPI = serde_yaml::from_str(&text)?;
            Ok(spec)
        }
        "json" => {
            let spec: OpenAPI = serde_json::from_str(&text)?;
            Ok(spec)
        }
        _ => Err(LoadError::UnsupportedExtension),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/tests/fixtures")
            .join(name)
    }

    #[test]
    fn load_petstore_30_yaml_parses() {
        let spec = load_spec(&fixture("petstore-3.0.yaml")).expect("load");
        assert!(
            spec.paths.paths.contains_key("/pets"),
            "/pets not found in paths"
        );
        assert_eq!(spec.info.title, "Petstore");
    }
}

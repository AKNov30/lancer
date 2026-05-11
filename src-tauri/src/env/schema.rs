use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub name: String,
    pub vars: Vec<(String, String)>,
    pub secret_names: Vec<String>,
}

impl Environment {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            vars: Vec::new(),
            secret_names: Vec::new(),
        }
    }
}

use std::fs;
use std::path::Path;

use crate::env::bru;
use crate::env::schema::Environment;

#[derive(Debug, thiserror::Error)]
pub enum EnvIoError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse: {0}")]
    Parse(#[from] crate::env::bru::EnvBruError),
}

impl serde::Serialize for EnvIoError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub fn list_envs(workspace_root: &Path) -> Result<Vec<String>, EnvIoError> {
    let envs_dir = workspace_root.join("environments");
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&envs_dir) else {
        return Ok(out);
    };
    for entry in entries.filter_map(Result::ok) {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("bru") {
            continue;
        }
        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
            out.push(stem.to_string());
        }
    }
    out.sort();
    Ok(out)
}

pub fn read_env(workspace_root: &Path, name: &str) -> Result<Environment, EnvIoError> {
    let path = workspace_root
        .join("environments")
        .join(format!("{name}.bru"));
    let text = fs::read_to_string(&path)?;
    Ok(bru::parse(name, &text)?)
}

pub fn write_env(workspace_root: &Path, env: &Environment) -> Result<(), EnvIoError> {
    let dir = workspace_root.join("environments");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.bru", env.name));
    fs::write(path, bru::serialize(env))?;
    Ok(())
}

pub fn delete_env(workspace_root: &Path, name: &str) -> Result<(), EnvIoError> {
    let path = workspace_root
        .join("environments")
        .join(format!("{name}.bru"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

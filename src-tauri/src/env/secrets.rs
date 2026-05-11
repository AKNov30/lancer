//! M6.4 — OS keyring CRUD for secret variables.
//!
//! Windows Credential Manager has a 256-char target-name limit, so we
//! SHA-256 hash the workspace root path and use the first 16 hex chars as
//! the workspace identifier in the keyring service name.

use std::path::Path;

use keyring::Entry;
use sha2::{Digest, Sha256};

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("keyring unavailable: {0}")]
    Unavailable(String),
    #[error("invalid workspace path: {0}")]
    InvalidPath(String),
}

impl serde::Serialize for SecretError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

const SERVICE_PREFIX: &str = "dev.lancer.app";

fn workspace_hash(workspace_root: &Path) -> Result<String, SecretError> {
    let root_str = workspace_root
        .to_str()
        .ok_or_else(|| SecretError::InvalidPath(format!("{workspace_root:?}")))?;
    let mut h = Sha256::new();
    h.update(root_str.as_bytes());
    let hex = format!("{:x}", h.finalize());
    Ok(hex[..16].to_string())
}

fn entry_for(workspace_root: &Path, env_name: &str, var_name: &str) -> Result<Entry, SecretError> {
    let hash = workspace_hash(workspace_root)?;
    let service = format!("{SERVICE_PREFIX}:{hash}:{env_name}");
    Ok(Entry::new(&service, var_name)?)
}

pub fn get(
    workspace_root: &Path,
    env_name: &str,
    var_name: &str,
) -> Result<Option<String>, SecretError> {
    let entry = entry_for(workspace_root, env_name, var_name)?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(keyring::Error::PlatformFailure(e)) => Err(SecretError::Unavailable(e.to_string())),
        Err(keyring::Error::NoStorageAccess(e)) => Err(SecretError::Unavailable(e.to_string())),
        Err(e) => Err(SecretError::Keyring(e)),
    }
}

pub fn set(
    workspace_root: &Path,
    env_name: &str,
    var_name: &str,
    value: &str,
) -> Result<(), SecretError> {
    let entry = entry_for(workspace_root, env_name, var_name)?;
    entry.set_password(value)?;
    Ok(())
}

pub fn delete(workspace_root: &Path, env_name: &str, var_name: &str) -> Result<(), SecretError> {
    let entry = entry_for(workspace_root, env_name, var_name)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecretError::Keyring(e)),
    }
}

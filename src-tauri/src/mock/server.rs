use tokio::sync::oneshot;

/// Live mock server handle. Dropped when the server is stopped.
pub struct MockHandle {
    pub port: u16,
    pub spec_path: String,
    /// Sending on this channel signals the axum task to shut down gracefully.
    pub shutdown: oneshot::Sender<()>,
}

impl std::fmt::Debug for MockHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MockHandle")
            .field("port", &self.port)
            .field("spec_path", &self.spec_path)
            .finish_non_exhaustive()
    }
}

/// Serialisable status snapshot — returned by all three Tauri commands.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub spec_path: Option<String>,
    pub error: Option<String>,
}

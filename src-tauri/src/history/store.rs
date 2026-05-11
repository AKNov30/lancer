//! On-disk SQLite history of sent requests.
//!
//! Capped at 500 entries — older entries are evicted on insert.
//! Schema is intentionally simple (no joins, no foreign keys); columns are
//! JSON-serialized blobs for headers/body so we don't migrate when the
//! request shape changes.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

const MAX_ROWS: i64 = 500;

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

impl serde::Serialize for HistoryError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub timestamp: i64, // unix epoch seconds
    pub url: String,
    pub method: String,
    pub status: u16,
    pub elapsed_ms: u128,
    pub size_bytes: usize,
    pub headers_json: String,
    pub body_text_preview: Option<String>, // first 4 KB
}

pub struct HistoryDb {
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for HistoryDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HistoryDb").finish_non_exhaustive()
    }
}

impl HistoryDb {
    pub fn open(path: PathBuf) -> Result<Self, HistoryError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                url TEXT NOT NULL,
                method TEXT NOT NULL,
                status INTEGER NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                headers_json TEXT NOT NULL,
                body_text_preview TEXT
            );
            CREATE INDEX IF NOT EXISTS history_timestamp ON history(timestamp DESC);",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn open_in_memory() -> Result<Self, HistoryError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                url TEXT NOT NULL,
                method TEXT NOT NULL,
                status INTEGER NOT NULL,
                elapsed_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL,
                headers_json TEXT NOT NULL,
                body_text_preview TEXT
            );
            CREATE INDEX IF NOT EXISTS history_timestamp ON history(timestamp DESC);",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &self,
        url: &str,
        method: &str,
        status: u16,
        elapsed_ms: u128,
        size_bytes: usize,
        headers: &[(String, String)],
        body_text: Option<&str>,
    ) -> Result<(), HistoryError> {
        let conn = self.conn.lock().unwrap();
        // Redact sensitive headers before persisting
        let safe_headers: Vec<(String, String)> = headers
            .iter()
            .map(|(k, v)| {
                let lk = k.to_ascii_lowercase();
                if lk.contains("auth")
                    || lk.contains("cookie")
                    || lk.contains("token")
                    || lk.contains("key")
                    || lk.contains("secret")
                    || lk.contains("password")
                {
                    (k.clone(), "[redacted]".to_string())
                } else {
                    (k.clone(), v.clone())
                }
            })
            .collect();
        let headers_json = serde_json::to_string(&safe_headers)?;
        let preview: Option<String> = body_text.map(|t| t.chars().take(4096).collect());
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO history (timestamp, url, method, status, elapsed_ms, size_bytes, headers_json, body_text_preview)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![ts, url, method, status, elapsed_ms as i64, size_bytes as i64, headers_json, preview],
        )?;
        // Evict old rows
        conn.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)",
            rusqlite::params![MAX_ROWS],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: i64) -> Result<Vec<HistoryEntry>, HistoryError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, url, method, status, elapsed_ms, size_bytes, headers_json, body_text_preview
             FROM history ORDER BY id DESC LIMIT ?",
        )?;
        let rows = stmt.query_map(rusqlite::params![limit], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                url: row.get(2)?,
                method: row.get(3)?,
                status: row.get::<_, i64>(4)? as u16,
                elapsed_ms: row.get::<_, i64>(5)? as u128,
                size_bytes: row.get::<_, i64>(6)? as usize,
                headers_json: row.get(7)?,
                body_text_preview: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(HistoryError::from)
    }

    pub fn clear(&self) -> Result<(), HistoryError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }
}

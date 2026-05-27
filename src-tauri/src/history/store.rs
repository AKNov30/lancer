//! On-disk SQLite history of sent requests.
//!
//! Capped at 500 entries — older entries are evicted on insert, EXCEPT for
//! pinned entries which are kept regardless of recency.
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
    /// True when the user has explicitly pinned this entry.
    /// Pinned entries skip the LRU eviction cap.
    pub pinned: bool,
}

pub struct HistoryDb {
    conn: Arc<Mutex<Connection>>,
}

impl std::fmt::Debug for HistoryDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HistoryDb").finish_non_exhaustive()
    }
}

const INIT_SQL: &str = "CREATE TABLE IF NOT EXISTS history (
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
CREATE INDEX IF NOT EXISTS history_timestamp ON history(timestamp DESC);";

/// Idempotent migration — adds the `pinned` column to existing v1 databases.
/// Uses PRAGMA introspection so it's safe to re-run on already-migrated dbs.
fn ensure_pinned_column(conn: &Connection) -> Result<(), rusqlite::Error> {
    let mut stmt = conn.prepare("PRAGMA table_info(history)")?;
    let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
    let names: Vec<String> = cols.filter_map(Result::ok).collect();
    drop(stmt);
    if !names.iter().any(|c| c == "pinned") {
        conn.execute(
            "ALTER TABLE history ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

impl HistoryDb {
    pub fn open(path: PathBuf) -> Result<Self, HistoryError> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(INIT_SQL)?;
        ensure_pinned_column(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn open_in_memory() -> Result<Self, HistoryError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(INIT_SQL)?;
        ensure_pinned_column(&conn)?;
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
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
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
            "INSERT INTO history (timestamp, url, method, status, elapsed_ms, size_bytes, headers_json, body_text_preview, pinned)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
            rusqlite::params![ts, url, method, status, elapsed_ms as i64, size_bytes as i64, headers_json, preview],
        )?;
        // Evict UNpinned old rows, keeping the most recent MAX_ROWS unpinned entries.
        conn.execute(
            "DELETE FROM history
             WHERE pinned = 0
               AND id NOT IN (
                   SELECT id FROM history WHERE pinned = 0 ORDER BY id DESC LIMIT ?
               )",
            rusqlite::params![MAX_ROWS],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: i64) -> Result<Vec<HistoryEntry>, HistoryError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        // Pinned rows sort to the top; within each group, newest first.
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, url, method, status, elapsed_ms, size_bytes, headers_json, body_text_preview, pinned
             FROM history ORDER BY pinned DESC, id DESC LIMIT ?",
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
                pinned: row.get::<_, i64>(9)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(HistoryError::from)
    }

    /// Full-text search across url + method. Case-insensitive substring match.
    /// Pinned rows still sort to the top.
    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<HistoryEntry>, HistoryError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, timestamp, url, method, status, elapsed_ms, size_bytes, headers_json, body_text_preview, pinned
             FROM history
             WHERE url LIKE ?1 COLLATE NOCASE OR method LIKE ?1 COLLATE NOCASE
             ORDER BY pinned DESC, id DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(rusqlite::params![pattern, limit], |row| {
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
                pinned: row.get::<_, i64>(9)? != 0,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(HistoryError::from)
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<(), HistoryError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "UPDATE history SET pinned = ? WHERE id = ?",
            rusqlite::params![pinned as i64, id],
        )?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), HistoryError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM history", [])?;
        Ok(())
    }
}

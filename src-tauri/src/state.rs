//! SQLite 状态库。
//!
//! 存储：API Key 元数据、Asset Library、Generation History、Workflow Templates、
//! 任意 KV（前端 localStorage 镜像）。所有时间戳用毫秒（i64）。
//!
//! 路径：`app_data_dir/flovart-state.db`，由 lib.rs 在 setup() 中提供。

use crate::errors::{FlovartError, FlovartResult};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Arc;

pub struct StateDb {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kv_updated ON kv(updated_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  href TEXT,
  mime_type TEXT,
  name TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  prompt TEXT,
  element_id TEXT,
  result_kind TEXT,
  result_href TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity, entity_id, timestamp);
"#;

impl StateDb {
    pub fn open(path: &Path) -> FlovartResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ── KV ─────────────────────────────────────────────────────

    pub fn kv_set(&self, key: &str, value: &str) -> FlovartResult<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn kv_get(&self, key: &str) -> FlovartResult<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn kv_delete(&self, key: &str) -> FlovartResult<bool> {
        let conn = self.conn.lock();
        let n = conn.execute("DELETE FROM kv WHERE key = ?1", params![key])?;
        Ok(n > 0)
    }

    pub fn kv_keys(&self) -> FlovartResult<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT key FROM kv ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn kv_list_prefix(&self, prefix: &str) -> FlovartResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT key, value FROM kv WHERE key LIKE ?1 ORDER BY updated_at DESC",
        )?;
        let pattern = format!("{prefix}%");
        let rows = stmt.query_map(params![pattern], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn kv_dump(&self) -> FlovartResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM kv")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    // ── Sync log ──────────────────────────────────────────────

    pub fn sync_log(
        &self,
        entity: &str,
        entity_id: &str,
        action: &str,
        source: &str,
        payload: Option<&str>,
    ) -> FlovartResult<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sync_log(entity, entity_id, action, source, payload, timestamp)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            params![entity, entity_id, action, source, payload, now],
        )?;
        Ok(())
    }
}

// ── Tauri commands ─────────────────────────────────────────

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct StateKv {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn state_set(
    ctx: tauri::State<'_, std::sync::Arc<crate::FlovartContext>>,
    key: String,
    value: String,
    source: Option<String>,
) -> FlovartResult<()> {
    ctx.state_db.kv_set(&key, &value)?;
    let _ = ctx
        .state_db
        .sync_log("kv", &key, "set", source.as_deref().unwrap_or("webui"), Some(&value));
    Ok(())
}

#[tauri::command]
pub fn state_get(
    ctx: tauri::State<'_, std::sync::Arc<crate::FlovartContext>>,
    key: String,
) -> FlovartResult<Option<String>> {
    ctx.state_db.kv_get(&key)
}

#[tauri::command]
pub fn state_delete(
    ctx: tauri::State<'_, std::sync::Arc<crate::FlovartContext>>,
    key: String,
) -> FlovartResult<bool> {
    let n = ctx.state_db.kv_delete(&key)?;
    let _ = ctx
        .state_db
        .sync_log("kv", &key, "delete", "webui", None);
    Ok(n)
}

#[tauri::command]
pub fn state_keys(
    ctx: tauri::State<'_, std::sync::Arc<crate::FlovartContext>>,
    prefix: Option<String>,
) -> FlovartResult<Vec<String>> {
    match prefix.as_deref() {
        Some(p) if !p.is_empty() => {
            let pairs = ctx.state_db.kv_list_prefix(p)?;
            Ok(pairs.into_iter().map(|(k, _)| k).collect())
        }
        _ => ctx.state_db.kv_keys(),
    }
}

#[tauri::command]
pub fn state_dump(
    ctx: tauri::State<'_, std::sync::Arc<crate::FlovartContext>>,
) -> FlovartResult<Vec<StateKv>> {
    let pairs = ctx.state_db.kv_dump()?;
    Ok(pairs
        .into_iter()
        .map(|(key, value)| StateKv { key, value })
        .collect())
}

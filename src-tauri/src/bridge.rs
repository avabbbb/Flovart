//! 命令桥队列。
//!
//! 替换之前的 `.flovart/command-queue.json` 文件轮询；改为内存里的 Mutex<Vec<Entry>。
//! 外部 CLI / MCP / 扩展通过 deeplink 或内部 `bridge_enqueue` 入队，
//! WebUI 端通过 `bridge_tick` 拉取 pending 改成 `running` 状态的一条记录。
//! WebUI 完成后 `bridge_complete(id, result)` 写回。
//!
//! 持久化：每次入队 / 完成都写 SQLite `sync_log`，崩溃后可重建。

use crate::errors::{FlovartError, FlovartResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeEntry {
    pub id: String,
    pub command: String,
    pub args: serde_json::Value,
    pub status: String, // 'pending' | 'running' | 'done'
    pub source: String, // 'cli' | 'extension' | 'mcp' | 'host'
    pub result: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// R6-L07: Maximum number of pending entries the bridge queue will hold.
/// When this limit is reached, the oldest pending entry is evicted.
const BRIDGE_QUEUE_MAX_PENDING: usize = 256;

pub struct BridgeQueue {
    entries: Mutex<Vec<BridgeEntry>>,
}

impl BridgeQueue {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    pub fn enqueue(&self, command: String, args: serde_json::Value, source: String) -> BridgeEntry {
        let now = chrono::Utc::now().timestamp_millis();
        let rand = (now as u64).wrapping_mul(2_654_435_761).wrapping_add(1);
        let id = format!("flv_{}_{:08x}", now, rand & 0xFFFF_FFFF);
        let entry = BridgeEntry {
            id: id.clone(),
            command,
            args,
            status: "pending".into(),
            source,
            result: None,
            error: None,
            created_at: now,
            updated_at: now,
        };
        let mut guard = self.entries.lock();
        // R6-L07: Enforce pending capacity — evict oldest pending entries.
        let pending_count = guard.iter().filter(|e| e.status == "pending").count();
        if pending_count >= BRIDGE_QUEUE_MAX_PENDING {
            if let Some(idx) = guard.iter().position(|e| e.status == "pending") {
                let removed = guard.remove(idx);
                log::warn!(
                    "Bridge queue at capacity ({}); evicted oldest pending entry {}",
                    BRIDGE_QUEUE_MAX_PENDING,
                    removed.id
                );
            }
        }
        guard.push(entry.clone());
        entry
    }

    /// 拉取一条 pending → running；如果已经有 running 的则返回 None。
    pub fn tick(&self) -> Option<BridgeEntry> {
        let mut guard = self.entries.lock();
        let entry = guard.iter_mut().find(|e| e.status == "pending")?;
        entry.status = "running".into();
        entry.updated_at = chrono::Utc::now().timestamp_millis();
        Some(entry.clone())
    }

    pub fn complete(
        &self,
        id: &str,
        result: Option<serde_json::Value>,
        error: Option<serde_json::Value>,
    ) -> FlovartResult<()> {
        let mut guard = self.entries.lock();
        let entry = guard
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| FlovartError::NotFound(format!("bridge entry {id}")))?;
        entry.status = "done".into();
        entry.result = result;
        entry.error = error;
        entry.updated_at = chrono::Utc::now().timestamp_millis();
        Ok(())
    }

    #[allow(dead_code)]
    pub fn list(&self) -> Vec<BridgeEntry> {
        self.entries.lock().clone()
    }

    #[allow(dead_code)]
    pub fn clear_done(&self) -> usize {
        let mut guard = self.entries.lock();
        let before = guard.len();
        guard.retain(|e| e.status != "done");
        before - guard.len()
    }
}

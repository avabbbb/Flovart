use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskReceipt {
    pub kind: String,
    pub command_id: String,
    pub task_id: String,
    pub status: String,
    pub poll_interval_ms: u64,
    pub event_id: i64,
    pub links: TaskLinks,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct TaskLinks {
    pub task: String,
    pub events: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTask {
    pub id: String,
    pub command_id: String,
    pub kind: String,
    pub status: String,
    pub progress: Option<Value>,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<i64>,
    pub cancel_requested_at: Option<i64>,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTaskPage {
    pub tasks: Vec<RuntimeTask>,
    pub next_cursor: Option<String>,
}

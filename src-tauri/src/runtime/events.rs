use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct RuntimeEntityRef {
    #[serde(rename = "type")]
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEvent {
    pub event_id: i64,
    pub event_version: String,
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<RuntimeEntityRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub occurred_at: i64,
    pub data: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEventPage {
    pub events: Vec<RuntimeEvent>,
    pub next_event_id: i64,
}

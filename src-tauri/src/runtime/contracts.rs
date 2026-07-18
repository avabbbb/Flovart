use serde::{Deserialize, Serialize};

pub const COMMAND_ENVELOPE_SCHEMA: &str =
    include_str!("../../../tools/flovart/contracts/runtime/schemas/command-envelope.v1.json");
pub const COMMAND_ENVELOPE_SCHEMA_ID: &str =
    "https://flovart.local/schemas/runtime/command-envelope.v1.json";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub protocol_version: String,
    pub runtime_version: String,
    pub runtime_instance_id: String,
    pub registry_hash: String,
    pub authority: String,
    pub state: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub details: Option<serde_json::Value>,
    pub action_url: Option<String>,
}

impl RuntimeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
            retryable: false,
            details: None,
            action_url: None,
        }
    }
}

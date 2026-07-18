mod contracts;
mod error;
mod registry;

pub use contracts::{RuntimeError, RuntimeStatus};
pub use error::RuntimeContractError;
pub use registry::CanonicalRegistry;

use contracts::{COMMAND_ENVELOPE_SCHEMA, COMMAND_ENVELOPE_SCHEMA_ID};
use registry::load_registry;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

pub struct ProductionRuntime {
    runtime_version: String,
    registry: CanonicalRegistry,
    envelope_validator: jsonschema::Validator,
}

impl ProductionRuntime {
    pub fn new(runtime_version: impl Into<String>) -> Result<Self, RuntimeContractError> {
        let schema: Value = serde_json::from_str(COMMAND_ENVELOPE_SCHEMA)?;
        if schema.get("$id").and_then(Value::as_str) != Some(COMMAND_ENVELOPE_SCHEMA_ID) {
            return Err(RuntimeContractError::InvalidSchema(format!(
                "expected {COMMAND_ENVELOPE_SCHEMA_ID}"
            )));
        }
        let envelope_validator = jsonschema::validator_for(&schema)
            .map_err(|error| RuntimeContractError::InvalidSchema(error.to_string()))?;
        Ok(Self {
            runtime_version: runtime_version.into(),
            registry: load_registry()?,
            envelope_validator,
        })
    }

    pub fn registry(&self) -> &CanonicalRegistry {
        &self.registry
    }

    pub fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            protocol_version: self.registry.protocol_version.clone(),
            runtime_version: self.runtime_version.clone(),
            authority: "desktop-runtime".to_owned(),
            state: "ready".to_owned(),
        }
    }

    pub fn new_id(prefix: &str) -> String {
        format!("{prefix}_{}", Uuid::now_v7())
    }

    pub fn hash_payload(payload: &Value) -> Result<String, RuntimeContractError> {
        let canonical = serde_json_canonicalizer::to_vec(payload)?;
        Ok(hex::encode(Sha256::digest(canonical)))
    }

    pub fn validate_envelope(&self, envelope: &Value) -> Result<(), RuntimeError> {
        if envelope
            .get("protocolVersion")
            .is_some_and(|version| version != self.registry.protocol_version.as_str())
        {
            return Err(RuntimeError::new(
                "PROTOCOL_MISMATCH",
                format!(
                    "Unsupported protocol version: {}",
                    envelope["protocolVersion"]
                ),
            ));
        }
        self.envelope_validator
            .validate(envelope)
            .map_err(|error| RuntimeError::new("INVALID_ARGUMENT", error.to_string()))?;
        let command = envelope["command"].as_str().unwrap_or_default();
        if !self.registry.commands.contains_key(command) {
            return Err(RuntimeError::new(
                "UNKNOWN_COMMAND",
                format!("Unknown Flovart command: {command}"),
            ));
        }
        Ok(())
    }
}

#[tauri::command]
pub fn runtime_status(runtime: tauri::State<'_, Arc<ProductionRuntime>>) -> RuntimeStatus {
    runtime.status()
}

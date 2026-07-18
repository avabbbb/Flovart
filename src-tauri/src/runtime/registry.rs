use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

use super::error::RuntimeContractError;

const REGISTRY_JSON: &str =
    include_str!("../../../tools/flovart/contracts/runtime/command-registry.v1.json");
const REGISTRY_SCHEMA_JSON: &str =
    include_str!("../../../tools/flovart/contracts/runtime/schemas/command-registry.v1.json");
const REGISTRY_SCHEMA_ID: &str = "https://flovart.local/schemas/runtime/command-registry.v1.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalRegistry {
    pub schema_version: String,
    pub protocol_version: String,
    pub registry_hash: String,
    pub commands: BTreeMap<String, CommandDefinition>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDefinition {
    pub summary: String,
    pub args: BTreeMap<String, String>,
    pub availability: CommandAvailability,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CommandAvailability {
    Available,
    LegacyOnly,
}

pub fn load_registry() -> Result<CanonicalRegistry, RuntimeContractError> {
    let document: serde_json::Value = serde_json::from_str(REGISTRY_JSON)?;
    let schema: serde_json::Value = serde_json::from_str(REGISTRY_SCHEMA_JSON)?;
    if schema.get("$id").and_then(serde_json::Value::as_str) != Some(REGISTRY_SCHEMA_ID) {
        return Err(RuntimeContractError::InvalidSchema(format!(
            "expected {REGISTRY_SCHEMA_ID}"
        )));
    }
    jsonschema::validator_for(&schema)
        .map_err(|error| RuntimeContractError::InvalidSchema(error.to_string()))?
        .validate(&document)
        .map_err(|error| RuntimeContractError::InvalidRegistryContract(error.to_string()))?;
    let wire: WireRegistry = serde_json::from_value(document.clone())?;
    let mut hash_document = document;
    hash_document
        .as_object_mut()
        .expect("registry schema requires an object")
        .remove("registryHash");
    let computed_hash = hex::encode(Sha256::digest(serde_json_canonicalizer::to_vec(
        &hash_document,
    )?));
    if computed_hash != wire.registry_hash {
        return Err(RuntimeContractError::RegistryHashMismatch {
            declared: wire.registry_hash,
            computed: computed_hash,
        });
    }
    let mut commands = BTreeMap::new();
    for command in wire.commands {
        let name = command.name.clone();
        let definition = CommandDefinition {
            summary: command.summary,
            args: command.args,
            availability: command.availability,
        };
        if commands.insert(name.clone(), definition).is_some() {
            return Err(RuntimeContractError::DuplicateCommand(name));
        }
    }
    Ok(CanonicalRegistry {
        schema_version: wire.schema_version,
        protocol_version: wire.protocol_version,
        registry_hash: wire.registry_hash,
        commands,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireRegistry {
    schema_version: String,
    protocol_version: String,
    registry_hash: String,
    commands: Vec<WireCommandDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireCommandDefinition {
    name: String,
    summary: String,
    args: BTreeMap<String, String>,
    availability: CommandAvailability,
}

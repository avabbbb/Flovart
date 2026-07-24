mod auth;
mod contracts;
mod control_server;
mod discovery;
mod error;
mod events;
mod google_veo;
mod registry;
mod runninghub;
mod store;
mod tasks;
mod worker;

pub use contracts::{RuntimeError, RuntimeStatus};
pub use control_server::ControlServer;
pub use discovery::{default_discovery_path, DiscoveryRecord};
pub use error::RuntimeContractError;
pub use events::{RuntimeEvent, RuntimeEventPage};
pub use registry::CanonicalRegistry;
pub use tasks::{RuntimeTask, RuntimeTaskPage, TaskReceipt};

use contracts::{COMMAND_ENVELOPE_SCHEMA, COMMAND_ENVELOPE_SCHEMA_ID};
use registry::load_registry;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use store::RuntimeStore;
use uuid::Uuid;

pub struct ProductionRuntime {
    runtime_version: String,
    runtime_instance_id: String,
    registry: CanonicalRegistry,
    envelope_validator: jsonschema::Validator,
    store: Arc<RuntimeStore>,
    _worker: worker::RuntimeWorker,
}

impl ProductionRuntime {
    pub fn new(runtime_version: impl Into<String>) -> Result<Self, RuntimeContractError> {
        Self::build(runtime_version, RuntimeStore::in_memory()?, None)
    }

    pub fn open(
        runtime_version: impl Into<String>,
        database_path: &Path,
    ) -> Result<Self, RuntimeContractError> {
        let artifact_root = database_path
            .parent()
            .map(|parent| parent.join("runtime-artifacts"));
        Self::build(
            runtime_version,
            RuntimeStore::open(database_path)?,
            artifact_root,
        )
    }

    fn build(
        runtime_version: impl Into<String>,
        store: RuntimeStore,
        artifact_root: Option<PathBuf>,
    ) -> Result<Self, RuntimeContractError> {
        let schema: Value = serde_json::from_str(COMMAND_ENVELOPE_SCHEMA)?;
        if schema.get("$id").and_then(Value::as_str) != Some(COMMAND_ENVELOPE_SCHEMA_ID) {
            return Err(RuntimeContractError::InvalidSchema(format!(
                "expected {COMMAND_ENVELOPE_SCHEMA_ID}"
            )));
        }
        let envelope_validator = jsonschema::validator_for(&schema)
            .map_err(|error| RuntimeContractError::InvalidSchema(error.to_string()))?;
        let store = Arc::new(store);
        let worker = worker::RuntimeWorker::start(store.clone(), artifact_root);
        Ok(Self {
            runtime_version: runtime_version.into(),
            runtime_instance_id: Self::new_id("runtime"),
            registry: load_registry()?,
            envelope_validator,
            store,
            _worker: worker,
        })
    }

    pub fn registry(&self) -> &CanonicalRegistry {
        &self.registry
    }

    pub fn status(&self) -> RuntimeStatus {
        RuntimeStatus {
            protocol_version: self.registry.protocol_version.clone(),
            runtime_version: self.runtime_version.clone(),
            runtime_instance_id: self.runtime_instance_id.clone(),
            registry_hash: self.registry.registry_hash.clone(),
            authority: "desktop-runtime".to_owned(),
            state: "ready".to_owned(),
        }
    }

    pub fn get_task(&self, task_id: &str) -> Result<RuntimeTask, RuntimeError> {
        self.store.get_task(task_id)
    }

    pub fn list_tasks(
        &self,
        status: Option<&str>,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<RuntimeTaskPage, RuntimeError> {
        if status.is_some_and(|status| {
            ![
                "queued",
                "working",
                "input_required",
                "completed",
                "failed",
                "cancelled",
            ]
            .contains(&status)
        }) {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "task status filter is invalid",
            ));
        }
        if !(1..=100).contains(&limit) {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "task list limit must be between 1 and 100",
            ));
        }
        self.store.list_tasks(status, cursor, limit)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn cancel_task(
        &self,
        command_id: &str,
        actor_kind: &str,
        actor_instance_id: &str,
        idempotency_key: &str,
        task_id: &str,
        reason: Option<&str>,
    ) -> Result<RuntimeTask, RuntimeError> {
        let payload_hash = Self::hash_payload(&serde_json::json!({
            "command": "task.cancel",
            "args": { "taskId": task_id, "reason": reason },
        }))
        .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
        self.store.request_cancel(
            command_id,
            actor_kind,
            actor_instance_id,
            idempotency_key,
            &payload_hash,
            task_id,
            reason,
        )
    }

    pub fn stream_events(
        &self,
        after_event_id: i64,
        task_id: Option<&str>,
        limit: u32,
    ) -> Result<RuntimeEventPage, RuntimeError> {
        if after_event_id < 0 {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "event cursor must not be negative",
            ));
        }
        if !(1..=500).contains(&limit) {
            return Err(RuntimeError::new(
                "INVALID_ARGUMENT",
                "event limit must be between 1 and 500",
            ));
        }
        self.store.list_events(after_event_id, task_id, limit)
    }

    pub fn execute(&self, envelope: &Value) -> Result<Value, RuntimeError> {
        self.validate_envelope(envelope)?;
        match envelope["command"].as_str().unwrap_or_default() {
            "runtime.status" => serde_json::to_value(self.status())
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string())),
            "command.list" => serde_json::to_value(&self.registry)
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string())),
            "command.schema" => {
                let requested = envelope["args"].get("command").and_then(Value::as_str);
                match requested {
                    Some(command) => self
                        .registry
                        .commands
                        .get(command)
                        .map(|definition| {
                            serde_json::json!({
                                "command": command,
                                "schema": definition,
                            })
                        })
                        .ok_or_else(|| {
                            RuntimeError::new(
                                "UNKNOWN_COMMAND",
                                format!("Unknown Flovart command: {command}"),
                            )
                        }),
                    None => serde_json::to_value(&self.registry).map_err(|error| {
                        RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string())
                    }),
                }
            }
            "provider.status" => {
                let args = &envelope["args"];
                validate_exact_args(args, &[])?;
                let google_credentials = self.store.list_provider_credentials(Some("google"))?;
                let runninghub_credentials =
                    self.store.list_provider_credentials(Some("runningHub"))?;
                Ok(serde_json::json!({
                    "providers": [
                        {
                            "provider": "google",
                            "ready": !google_credentials.is_empty(),
                            "capabilities": ["video"],
                            "productModels": ["flovart:veo-3.1-lite"],
                            "route": {
                                "model": google_veo::VEO_LITE_MODEL,
                                "resolution": "720p",
                                "durationsSec": [4, 6, 8],
                                "nativeAudio": true
                            },
                            "credentials": google_credentials
                        },
                        {
                            "provider": "runningHub",
                            "ready": !runninghub_credentials.is_empty(),
                            "capabilities": ["video"],
                            "productModels": ["flovart:veo-3.1-lite"],
                            "route": {
                                "routeId": runninghub::VEO_LITE_ROUTE,
                                "channelTier": "official-stable",
                                "resolution": "720p",
                                "durationsSec": [4, 6, 8],
                                "nativeAudio": true,
                                "pricePreview": true
                            },
                            "credentials": runninghub_credentials
                        }
                    ]
                }))
            }
            "runtime.test.delay" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "runtime.test.delay requires idempotencyKey",
                        )
                    })?;
                let args = &envelope["args"];
                validate_exact_args(args, &["delayMs"])?;
                let delay_ms = args.get("delayMs").and_then(Value::as_u64).ok_or_else(|| {
                    RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "runtime.test.delay requires an integer delayMs",
                    )
                })?;
                if delay_ms > 30_000 {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "runtime.test.delay delayMs must not exceed 30000",
                    ));
                }
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "runtime.test.delay",
                    "args": args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store
                    .submit_delay(
                        envelope["commandId"].as_str().unwrap_or_default(),
                        envelope["actor"]["kind"].as_str().unwrap_or_default(),
                        envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                        idempotency_key,
                        &payload_hash,
                        args,
                    )
                    .and_then(to_value)
            }
            "generate.video" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "generate.video requires idempotencyKey",
                        )
                    })?;
                let args = &envelope["args"];
                validate_exact_args(
                    args,
                    &[
                        "prompt",
                        "provider",
                        "credentialId",
                        "productModel",
                        "sourceImageIds",
                        "sourceVideoIds",
                        "slots",
                        "durationSec",
                        "aspectRatio",
                        "resolution",
                        "generateAudio",
                        "watermark",
                        "seed",
                    ],
                )?;
                let prompt = args.get("prompt").and_then(Value::as_str).ok_or_else(|| {
                    RuntimeError::new("INVALID_ARGUMENT", "generate.video requires prompt")
                })?;
                if prompt.trim().is_empty() || prompt.len() > 8_000 {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "generate.video prompt must contain 1 to 8000 bytes",
                    ));
                }
                for unsupported in [
                    "sourceImageIds",
                    "sourceVideoIds",
                    "slots",
                    "watermark",
                    "seed",
                ] {
                    if args.get(unsupported).is_some_and(|value| {
                        !value.is_null()
                            && value.as_array().is_none_or(|items| !items.is_empty())
                            && value.as_bool() != Some(false)
                    }) {
                        return Err(RuntimeError::new(
                            "INVALID_ARGUMENT",
                            format!(
                                "The current Google Veo Lite tracer bullet does not support {unsupported}"
                            ),
                        ));
                    }
                }
                let product_model =
                    optional_string(args, "productModel")?.unwrap_or("flovart:veo-3.1-lite");
                if product_model != "flovart:veo-3.1-lite" {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "Only flovart:veo-3.1-lite is enabled in Production Runtime.",
                    ));
                }
                let provider = optional_string(args, "provider")?.unwrap_or("google");
                if !["google", "runningHub"].contains(&provider) {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "Veo 3.1 Lite is enabled only for google or runningHub.",
                    ));
                }
                let duration_sec = optional_i64(args, "durationSec")?.unwrap_or(8);
                if ![4, 6, 8].contains(&duration_sec) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "Google Veo Lite durationSec must be 4, 6, or 8",
                    ));
                }
                let aspect_ratio = optional_string(args, "aspectRatio")?.unwrap_or("16:9");
                if !["16:9", "9:16"].contains(&aspect_ratio) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "Google Veo Lite aspectRatio must be 16:9 or 9:16",
                    ));
                }
                let resolution = optional_string(args, "resolution")?.unwrap_or("720p");
                if resolution != "720p" {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "Google Veo Lite tracer bullet is capped at 720p",
                    ));
                }
                let credential_id = optional_string(args, "credentialId")?;
                let generate_audio = optional_bool(args, "generateAudio")?.unwrap_or(true);
                let normalized_args = serde_json::json!({
                    "prompt": prompt,
                    "provider": provider,
                    "productModel": product_model,
                    "durationSec": duration_sec,
                    "aspectRatio": aspect_ratio,
                    "resolution": resolution,
                    "generateAudio": generate_audio,
                    "credentialId": credential_id
                });
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "generate.video",
                    "args": normalized_args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store
                    .submit_video(
                        envelope["commandId"].as_str().unwrap_or_default(),
                        envelope["actor"]["kind"].as_str().unwrap_or_default(),
                        envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                        idempotency_key,
                        &payload_hash,
                        &normalized_args,
                    )
                    .and_then(to_value)
            }
            "task.get" => {
                let args = &envelope["args"];
                validate_exact_args(args, &["taskId"])?;
                let task_id = args.get("taskId").and_then(Value::as_str).ok_or_else(|| {
                    RuntimeError::new("INVALID_ARGUMENT", "task.get requires taskId")
                })?;
                self.get_task(task_id).and_then(to_value)
            }
            "task.list" => {
                let args = &envelope["args"];
                validate_exact_args(args, &["status", "cursor", "limit"])?;
                let status = optional_string(args, "status")?;
                if status.is_some_and(|status| {
                    ![
                        "queued",
                        "working",
                        "input_required",
                        "completed",
                        "failed",
                        "cancelled",
                    ]
                    .contains(&status)
                }) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "task.list status is invalid",
                    ));
                }
                let cursor = optional_string(args, "cursor")?;
                let limit = optional_i64(args, "limit")?.unwrap_or(50);
                if !(1..=100).contains(&limit) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "task.list limit must be between 1 and 100",
                    ));
                }
                self.list_tasks(status, cursor, limit as u32)
                    .and_then(to_value)
            }
            "task.cancel" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new("INVALID_ARGUMENT", "task.cancel requires idempotencyKey")
                    })?;
                let args = &envelope["args"];
                validate_exact_args(args, &["taskId", "reason"])?;
                let task_id = args.get("taskId").and_then(Value::as_str).ok_or_else(|| {
                    RuntimeError::new("INVALID_ARGUMENT", "task.cancel requires taskId")
                })?;
                let reason = match args.get("reason") {
                    Some(Value::String(reason)) => Some(reason.as_str()),
                    Some(_) => {
                        return Err(RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "task.cancel reason must be a string",
                        ))
                    }
                    None => None,
                };
                self.cancel_task(
                    envelope["commandId"].as_str().unwrap_or_default(),
                    envelope["actor"]["kind"].as_str().unwrap_or_default(),
                    envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                    idempotency_key,
                    task_id,
                    reason,
                )
                .and_then(to_value)
            }
            "event.stream" => {
                let args = &envelope["args"];
                validate_exact_args(args, &["afterEventId", "taskId", "limit"])?;
                let after_event_id = optional_i64(args, "afterEventId")?.unwrap_or(0);
                if after_event_id < 0 {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "event.stream afterEventId must not be negative",
                    ));
                }
                let task_id = optional_string(args, "taskId")?;
                let limit = optional_i64(args, "limit")?.unwrap_or(100);
                if !(1..=500).contains(&limit) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "event.stream limit must be between 1 and 500",
                    ));
                }
                self.stream_events(after_event_id, task_id, limit as u32)
                    .and_then(to_value)
            }
            command => Err(RuntimeError {
                code: "RUNTIME_UNAVAILABLE".to_owned(),
                message: format!("Command is not available in Production Runtime: {command}"),
                retryable: false,
                details: Some(serde_json::json!({ "availability": "legacy-only" })),
                action_url: None,
            }),
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

fn validate_exact_args(args: &Value, allowed: &[&str]) -> Result<(), RuntimeError> {
    let object = args
        .as_object()
        .ok_or_else(|| RuntimeError::new("INVALID_ARGUMENT", "args must be an object"))?;
    if let Some(field) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("Unknown argument: {field}"),
        ));
    }
    Ok(())
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))
}

fn optional_i64(args: &Value, field: &str) -> Result<Option<i64>, RuntimeError> {
    match args.get(field) {
        Some(Value::Number(value)) => value.as_i64().map(Some).ok_or_else(|| {
            RuntimeError::new("INVALID_ARGUMENT", format!("{field} must be an integer"))
        }),
        Some(_) => Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("{field} must be an integer"),
        )),
        None => Ok(None),
    }
}

fn optional_string<'a>(args: &'a Value, field: &str) -> Result<Option<&'a str>, RuntimeError> {
    match args.get(field) {
        Some(Value::String(value)) => Ok(Some(value)),
        Some(_) => Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("{field} must be a string"),
        )),
        None => Ok(None),
    }
}

fn optional_bool(args: &Value, field: &str) -> Result<Option<bool>, RuntimeError> {
    match args.get(field) {
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("{field} must be a boolean"),
        )),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn runtime_status(runtime: tauri::State<'_, Arc<ProductionRuntime>>) -> RuntimeStatus {
    runtime.status()
}

#[tauri::command]
pub fn runtime_execute(
    runtime: tauri::State<'_, Arc<ProductionRuntime>>,
    envelope: Value,
) -> Result<Value, RuntimeError> {
    if envelope["actor"]["kind"] != "ui" {
        return Err(RuntimeError::new(
            "PERMISSION_DENIED",
            "Tauri IPC accepts UI actors only",
        ));
    }
    runtime.execute(&envelope)
}

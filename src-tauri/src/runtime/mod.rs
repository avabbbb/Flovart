mod auth;
mod agent_text;
mod contracts;
mod control_server;
mod discovery;
mod error;
mod events;
mod google_veo;
mod production;
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

    pub fn open_agent_text_stream(
        &self,
        request: &Value,
    ) -> Result<agent_text::AgentTextStream, RuntimeError> {
        let request = agent_text::parse_request(request)?;
        let routes = self.store.list_agent_text_routes()?;
        if routes.is_empty() {
            return Err(RuntimeError::new(
                "ROUTE_UNAVAILABLE",
                "No agent-text route is configured",
            ));
        }
        for route in routes {
            let secret = crate::keyring::read_secret(&route.provider, &route.credential_id)
                .map_err(|_| {
                    RuntimeError::new(
                        "RUNTIME_UNAVAILABLE",
                        "The operating-system keyring could not be read",
                    )
                })?;
            if let Some(secret) = secret {
                return agent_text::open_provider_stream(&route, &secret, &request);
            }
        }
        Err(RuntimeError::new(
            "ROUTE_UNAVAILABLE",
            "No configured agent-text credential is available",
        ))
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
                            "capabilities": ["image", "video"],
                            "productModels": [
                                "flovart:gpt-image-2",
                                "flovart:grok-imagine-video-1.5",
                                "flovart:veo-3.1-lite"
                            ],
                            "routes": [
                                {
                                    "productModel": "flovart:gpt-image-2",
                                    "routeId": runninghub::GPT_IMAGE_2_ROUTE,
                                    "channelTier": "low-price",
                                    "resolution": "1k",
                                    "pricePreview": true
                                },
                                {
                                    "productModel": "flovart:grok-imagine-video-1.5",
                                    "routeId": runninghub::GROK_VIDEO_ROUTE,
                                    "channelTier": "low-price",
                                    "resolution": "720p",
                                    "durationsSec": [6],
                                    "pricePreview": true
                                },
                                {
                                    "productModel": "flovart:veo-3.1-lite",
                                    "routeId": runninghub::VEO_LITE_ROUTE,
                                    "channelTier": "official-stable",
                                    "resolution": "720p",
                                    "durationsSec": [4, 6, 8],
                                    "nativeAudio": true,
                                    "pricePreview": true
                                },
                                {
                                    "productModel": "flovart:grok-imagine-video-1.5",
                                    "routeId": runninghub::GROK_VIDEO_IMAGE_ROUTE,
                                    "channelTier": "low-price",
                                    "mode": "image-to-video",
                                    "resolution": "720p",
                                    "durationsSec": [6],
                                    "maxSourceImages": 10,
                                    "pricePreview": true
                                }
                            ],
                            "credentials": runninghub_credentials
                        }
                    ]
                }))
            }
            "agent-text.route.sync" => {
                let routes = agent_text::validate_routes(&envelope["args"])?;
                self.store.replace_agent_text_routes(&routes)?;
                Ok(serde_json::json!({
                    "target": "runtime-capability:agent-text",
                    "routes": routes,
                    "secretFieldsStored": false
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
            "production.dry-run" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "production.dry-run requires idempotencyKey",
                        )
                    })?;
                let args = &envelope["args"];
                validate_exact_args(
                    args,
                    &["projectId", "title", "reviewPolicy", "director", "spec"],
                )?;
                production::compile_production_plan(args)?;
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "production.dry-run",
                    "args": args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store
                    .submit_production_plan(
                        envelope["commandId"].as_str().unwrap_or_default(),
                        envelope["actor"]["kind"].as_str().unwrap_or_default(),
                        envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                        idempotency_key,
                        &payload_hash,
                        args,
                    )
                    .and_then(to_value)
            }
            "production.status" => {
                let args = &envelope["args"];
                validate_exact_args(args, &["runId"])?;
                let run_id = args
                    .get("runId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        RuntimeError::new("INVALID_ARGUMENT", "production.status requires runId")
                    })?;
                self.store.get_production_status(run_id)
            }
            "production.approve" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "production.approve requires idempotencyKey",
                        )
                    })?;
                let args = &envelope["args"];
                validate_exact_args(
                    args,
                    &["runId", "gateType", "decision", "hardLimitMicros", "note"],
                )?;
                let run_id = args
                    .get("runId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        RuntimeError::new("INVALID_ARGUMENT", "production.approve requires runId")
                    })?;
                let gate_type = args
                    .get("gateType")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "production.approve requires gateType",
                        )
                    })?;
                let decision = optional_string(args, "decision")?.unwrap_or("approved");
                let hard_limit_micros = optional_i64(args, "hardLimitMicros")?;
                let note = optional_string(args, "note")?;
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "production.approve",
                    "args": args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store.approve_production_gate(
                    envelope["commandId"].as_str().unwrap_or_default(),
                    envelope["actor"]["kind"].as_str().unwrap_or_default(),
                    envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                    idempotency_key,
                    &payload_hash,
                    run_id,
                    gate_type,
                    decision,
                    hard_limit_micros,
                    note,
                )
            }
            "production.run" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "production.run requires idempotencyKey",
                        )
                    })?;
                let args = &envelope["args"];
                validate_exact_args(args, &["runId"])?;
                let run_id = args
                    .get("runId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        RuntimeError::new("INVALID_ARGUMENT", "production.run requires runId")
                    })?;
                // Fail fast when the run has not cleared its system gates.
                let status = self.store.get_production_status(run_id)?;
                let run_status = status.get("status").and_then(Value::as_str).unwrap_or("");
                if !["queued", "running", "recovering"].contains(&run_status) {
                    return Err(RuntimeError {
                        code: "PRECONDITION_FAILED".to_owned(),
                        message: format!(
                            "ProductionRun must be approved before execution (status: {run_status})."
                        ),
                        retryable: false,
                        details: Some(serde_json::json!({
                            "runStatus": run_status,
                            "blockers": status.get("blockers")
                        })),
                        action_url: None,
                    });
                }
                let normalized_args = serde_json::json!({ "runId": run_id });
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "production.run",
                    "args": normalized_args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store
                    .submit_production_run(
                        envelope["commandId"].as_str().unwrap_or_default(),
                        envelope["actor"]["kind"].as_str().unwrap_or_default(),
                        envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                        idempotency_key,
                        &payload_hash,
                        &normalized_args,
                    )
                    .and_then(to_value)
            }
            "workflow.projection.get" => {
                let args = &envelope["args"];
                validate_exact_args(args, &["projectId"])?;
                let project_id = args
                    .get("projectId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "workflow.projection.get requires projectId",
                        )
                    })?;
                self.store.get_workflow_projection(project_id)
            }
            "generate.image" => {
                let idempotency_key = envelope
                    .get("idempotencyKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "generate.image requires idempotencyKey",
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
                        "aspectRatio",
                        "resolution",
                    ],
                )?;
                let prompt = args.get("prompt").and_then(Value::as_str).ok_or_else(|| {
                    RuntimeError::new("INVALID_ARGUMENT", "generate.image requires prompt")
                })?;
                if prompt.trim().is_empty() || prompt.len() > 8_000 {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "generate.image prompt must contain 1 to 8000 bytes",
                    ));
                }
                let provider = optional_string(args, "provider")?.unwrap_or("runningHub");
                let product_model =
                    optional_string(args, "productModel")?.unwrap_or("flovart:gpt-image-2");
                if provider != "runningHub" || product_model != "flovart:gpt-image-2" {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "GPT Image 2 is currently enabled only through the trusted RunningHub low-price route.",
                    ));
                }
                let aspect_ratio = optional_string(args, "aspectRatio")?.unwrap_or("16:9");
                if !["1:1", "16:9", "9:16", "4:3", "3:4"].contains(&aspect_ratio) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "GPT Image 2 aspectRatio is not enabled by the trusted route profile.",
                    ));
                }
                let resolution = optional_string(args, "resolution")?.unwrap_or("1k");
                if resolution != "1k" {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "GPT Image 2 low-price tracer bullet is capped at 1k.",
                    ));
                }
                let credential_id = optional_string(args, "credentialId")?;
                let normalized_args = serde_json::json!({
                    "prompt": prompt,
                    "provider": provider,
                    "productModel": product_model,
                    "aspectRatio": aspect_ratio,
                    "resolution": resolution,
                    "credentialId": credential_id
                });
                let payload_hash = Self::hash_payload(&serde_json::json!({
                    "command": "generate.image",
                    "args": normalized_args,
                }))
                .map_err(|error| RuntimeError::new("RUNTIME_UNAVAILABLE", error.to_string()))?;
                self.store
                    .submit_image(
                        envelope["commandId"].as_str().unwrap_or_default(),
                        envelope["actor"]["kind"].as_str().unwrap_or_default(),
                        envelope["actor"]["instanceId"].as_str().unwrap_or_default(),
                        idempotency_key,
                        &payload_hash,
                        &normalized_args,
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
                let product_model =
                    optional_string(args, "productModel")?.unwrap_or("flovart:veo-3.1-lite");
                let source_image_ids = optional_string_array(args, "sourceImageIds")?;
                if source_image_ids.len() > 10 {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "Grok image-to-video accepts at most 10 sourceImageIds.",
                    ));
                }
                if !source_image_ids.is_empty() && product_model != "flovart:grok-imagine-video-1.5"
                {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "sourceImageIds are currently enabled only for Grok Imagine Video 1.5 image-to-video.",
                    ));
                }
                for unsupported in ["sourceVideoIds", "slots", "watermark", "seed"] {
                    if args.get(unsupported).is_some_and(|value| {
                        !value.is_null()
                            && value.as_array().is_none_or(|items| !items.is_empty())
                            && value.as_bool() != Some(false)
                    }) {
                        return Err(RuntimeError::new(
                            "INVALID_ARGUMENT",
                            format!(
                                "The current text-to-video tracer bullet does not support {unsupported}"
                            ),
                        ));
                    }
                }
                if !["flovart:veo-3.1-lite", "flovart:grok-imagine-video-1.5"]
                    .contains(&product_model)
                {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "The requested video Product Model is not enabled in Production Runtime.",
                    ));
                }
                let provider = optional_string(args, "provider")?.unwrap_or(
                    if product_model == "flovart:grok-imagine-video-1.5" {
                        "runningHub"
                    } else {
                        "google"
                    },
                );
                if product_model == "flovart:grok-imagine-video-1.5" && provider != "runningHub" {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "Grok Imagine Video is enabled only through the trusted RunningHub low-price route.",
                    ));
                }
                if product_model == "flovart:veo-3.1-lite"
                    && !["google", "runningHub"].contains(&provider)
                {
                    return Err(RuntimeError::new(
                        "ROUTE_UNAVAILABLE",
                        "Veo 3.1 Lite is enabled only for google or runningHub.",
                    ));
                }
                let default_duration = if product_model == "flovart:grok-imagine-video-1.5" {
                    6
                } else {
                    8
                };
                let duration_sec = optional_i64(args, "durationSec")?.unwrap_or(default_duration);
                let allowed_duration = if product_model == "flovart:grok-imagine-video-1.5" {
                    duration_sec == 6
                } else {
                    [4, 6, 8].contains(&duration_sec)
                };
                if !allowed_duration {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "durationSec is not enabled by the trusted Product Model route profile.",
                    ));
                }
                let aspect_ratio = optional_string(args, "aspectRatio")?.unwrap_or("16:9");
                if !["16:9", "9:16"].contains(&aspect_ratio) {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "The trusted video route profile supports 16:9 or 9:16.",
                    ));
                }
                let resolution = optional_string(args, "resolution")?.unwrap_or("720p");
                if resolution != "720p" {
                    return Err(RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "The trusted video route profile is capped at 720p.",
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
                    "sourceImageIds": source_image_ids,
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

fn optional_string_array(args: &Value, field: &str) -> Result<Vec<String>, RuntimeError> {
    match args.get(field) {
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| match value {
                Value::String(value) if !value.trim().is_empty() => Ok(value.to_owned()),
                _ => Err(RuntimeError::new(
                    "INVALID_ARGUMENT",
                    format!("{field} must contain non-empty strings"),
                )),
            })
            .collect(),
        Some(_) => Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("{field} must be an array of strings"),
        )),
        None => Ok(Vec::new()),
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

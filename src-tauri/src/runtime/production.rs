use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use super::RuntimeError;

#[derive(Clone, Debug)]
pub struct CompiledStage {
    pub stage_key: String,
    pub capability_id: String,
    pub spec_path: String,
    pub title: String,
    pub summary: String,
    pub status: String,
    pub blocked_reason: Option<Value>,
    pub dependencies: Vec<String>,
    pub input: Value,
    pub input_hash: String,
}

#[derive(Clone, Debug)]
pub struct ProductionPlanDraft {
    pub project_id: String,
    pub title: String,
    pub review_policy: String,
    pub director: Value,
    pub schema_version: String,
    pub core: Value,
    pub extensions: Value,
    pub spec_hash: String,
    pub stages: Vec<CompiledStage>,
    pub blockers: Vec<String>,
    pub gates: Vec<Value>,
}

// Static reservation estimates (micros, CNY) for the proposed Route Plan.
// Actual cost is confirmed per task from the provider price preview.
const EST_IMAGE_GPT2_MICROS: i64 = 100_000;
const EST_VIDEO_GROK_I2V_MICROS: i64 = 240_000;
const EST_VIDEO_VEO_LITE_MICROS: i64 = 2_560_000;
const GROK_I2V_MAX_SHOT_MS: i64 = 6_000;

pub fn compile_production_plan(args: &Value) -> Result<ProductionPlanDraft, RuntimeError> {
    let args = record(args, "production.dry-run args")?;
    let project_id = required_string(args.get("projectId"), "projectId", 200)?;
    let title = optional_string(args.get("title"), "title", 200)?
        .unwrap_or_else(|| "Production Plan".to_owned());
    let review_policy = optional_string(args.get("reviewPolicy"), "reviewPolicy", 32)?
        .unwrap_or_else(|| "balanced".to_owned());
    if !["guided", "balanced", "autonomous"].contains(&review_policy.as_str()) {
        return Err(invalid(
            "reviewPolicy must be guided, balanced, or autonomous",
        ));
    }

    let director = args
        .get("director")
        .ok_or_else(|| invalid("production.dry-run requires director"))?;
    let director_record = record(director, "director")?;
    for field in ["skillId", "version", "contentHash"] {
        required_string(
            director_record.get(field),
            &format!("director.{field}"),
            200,
        )?;
    }

    let spec = args
        .get("spec")
        .ok_or_else(|| invalid("production.dry-run requires spec"))?;
    let spec_record = record(spec, "spec")?;
    let schema_version =
        required_string(spec_record.get("schemaVersion"), "spec.schemaVersion", 100)?;
    if schema_version != "flovart.production-spec/1" {
        return Err(invalid(
            "spec.schemaVersion must be flovart.production-spec/1",
        ));
    }
    let delivery = record(
        spec_record.get("delivery").unwrap_or(&Value::Null),
        "spec.delivery",
    )?;
    let duration_ms = required_positive_i64(
        delivery.get("durationMs"),
        "spec.delivery.durationMs",
        3_600_000,
    )?;
    let aspect_ratio =
        optional_string(delivery.get("aspectRatio"), "spec.delivery.aspectRatio", 16)?
            .unwrap_or_else(|| "16:9".to_owned());
    let language = optional_string(delivery.get("language"), "spec.delivery.language", 32)?
        .unwrap_or_else(|| "zh-CN".to_owned());
    let style_prompt = spec_record
        .get("visual")
        .and_then(|visual| visual.get("stylePrompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let narrative = record(
        spec_record.get("narrative").unwrap_or(&Value::Null),
        "spec.narrative",
    )?;
    let beats = array(
        narrative.get("beats").unwrap_or(&Value::Null),
        "spec.narrative.beats",
    )?;
    if beats.is_empty() || beats.len() > 50 {
        return Err(invalid("spec.narrative.beats must contain 1 to 50 beats"));
    }

    let mut ids = HashSet::new();
    let mut stages = Vec::new();
    let mut motion_stage_keys = Vec::new();
    let mut timeline = Vec::new();
    let mut narration_lines = Vec::new();
    let mut shot_count = 0usize;
    let mut shot_duration_ms = 0i64;
    let mut beat_start_ms = 0i64;
    for (beat_index, beat) in beats.iter().enumerate() {
        let beat = record(beat, &format!("spec.narrative.beats[{beat_index}]"))?;
        let beat_id = required_string(
            beat.get("id"),
            &format!("spec.narrative.beats[{beat_index}].id"),
            100,
        )?;
        if !ids.insert(format!("beat:{beat_id}")) {
            return Err(invalid("ProductionSpec beat IDs must be unique"));
        }
        let shots = array(
            beat.get("shots").unwrap_or(&Value::Null),
            &format!("spec.narrative.beats[{beat_index}].shots"),
        )?;
        if shots.is_empty() {
            return Err(invalid(
                "Every ProductionSpec beat must contain at least one shot",
            ));
        }
        let mut beat_duration_ms = 0i64;
        for (shot_index, shot) in shots.iter().enumerate() {
            shot_count += 1;
            if shot_count > 200 {
                return Err(invalid("ProductionSpec supports at most 200 shots"));
            }
            let path = format!("/narrative/beats/{beat_index}/shots/{shot_index}");
            let shot = record(shot, &format!("spec{path}"))?;
            let shot_id = required_string(shot.get("id"), &format!("spec{path}.id"), 100)?;
            if !ids.insert(format!("shot:{shot_id}")) {
                return Err(invalid("ProductionSpec shot IDs must be unique"));
            }
            let duration = required_positive_i64(
                shot.get("durationMs"),
                &format!("spec{path}.durationMs"),
                60_000,
            )?;
            shot_duration_ms += duration;
            beat_duration_ms += duration;
            let scene = required_string(shot.get("scene"), &format!("spec{path}.scene"), 8_000)?;
            let shot_prompt =
                optional_string(shot.get("prompt"), &format!("spec{path}.prompt"), 8_000)?
                    .unwrap_or_else(|| scene.clone());
            let keyframe_prompt = match &style_prompt {
                Some(style) => format!("{style}\n{shot_prompt}"),
                None => shot_prompt.clone(),
            };
            let motion_prompt = optional_string(
                shot.get("motionPrompt"),
                &format!("spec{path}.motionPrompt"),
                8_000,
            )?
            .unwrap_or_else(|| shot_prompt.clone());
            let summary = truncate(&scene, 180);
            let keyframe_key = format!("shot:{shot_id}:keyframe");
            let motion_key = format!("shot:{shot_id}:motion");
            stages.push(stage(
                &keyframe_key,
                "image.generate",
                &format!("{path}/keyframe"),
                &format!("关键帧 · {shot_id}"),
                &summary,
                "ready",
                None,
                Vec::new(),
                json!({
                    "kind": "keyframe",
                    "shotId": shot_id,
                    "scene": scene,
                    "prompt": keyframe_prompt,
                    "aspectRatio": aspect_ratio,
                    "resolution": "1k"
                }),
            )?);
            stages.push(stage(
                &motion_key,
                "video.generate",
                &format!("{path}/motion"),
                &format!("动态镜头 · {shot_id}"),
                &summary,
                "pending",
                None,
                vec![keyframe_key.clone()],
                json!({
                    "kind": "motion",
                    "shotId": shot_id,
                    "scene": scene,
                    "prompt": motion_prompt,
                    "durationMs": duration,
                    "aspectRatio": aspect_ratio,
                    "sourceStageKey": keyframe_key
                }),
            )?);
            timeline.push(json!({
                "shotId": shot_id,
                "stageKey": motion_key,
                "durationMs": duration
            }));
            motion_stage_keys.push(motion_key);
        }
        if let Some(narration) = beat.get("narration").and_then(Value::as_str) {
            let narration = narration.trim();
            if !narration.is_empty() {
                narration_lines.push(json!({
                    "beatId": beat_id,
                    "text": narration,
                    "startMs": beat_start_ms,
                    "durationMs": beat_duration_ms
                }));
            }
        }
        beat_start_ms += beat_duration_ms;
    }
    if shot_duration_ms > duration_ms.saturating_mul(2) {
        return Err(invalid(
            "ProductionSpec shot duration exceeds the delivery duration envelope",
        ));
    }

    let mut capability_blocked = false;
    let mut render_dependencies = motion_stage_keys;
    let mut narration_stage_key = None;
    if let Some(audio) = spec_record.get("audio").and_then(Value::as_object) {
        if let Some(narration) = audio.get("narration") {
            let voice_profile = narration
                .get("voiceProfile")
                .and_then(Value::as_str)
                .unwrap_or("documentary-neutral");
            stages.push(stage(
                "audio:narration",
                "audio.tts",
                "/audio/narration",
                "旁白",
                "本地 TTS 旁白合成",
                "ready",
                None,
                Vec::new(),
                json!({
                    "kind": "narration",
                    "voiceProfile": voice_profile,
                    "language": language,
                    "lines": narration_lines,
                    "targetDurationMs": duration_ms
                }),
            )?);
            render_dependencies.push("audio:narration".to_owned());
            narration_stage_key = Some("audio:narration");
        }
        if audio.get("music").is_some() {
            capability_blocked = true;
            stages.push(stage(
                "audio:music",
                "audio.music",
                "/audio/music",
                "音乐与环境声",
                "等待一等音乐 Runtime Capability",
                "blocked",
                Some(json!({ "code": "CAPABILITY_UNAVAILABLE", "capabilityId": "audio.music" })),
                Vec::new(),
                audio.get("music").cloned().unwrap_or(Value::Null),
            )?);
        }
    }
    stages.push(stage(
        "delivery:render",
        "media.render",
        "/delivery",
        "成片合成",
        "受控 ffmpeg 字幕、旁白与拼接合成",
        "pending",
        None,
        render_dependencies,
        json!({
            "kind": "render",
            "delivery": Value::Object(delivery.clone()),
            "timeline": timeline,
            "narrationStageKey": narration_stage_key,
            "captions": narration_lines
        }),
    )?);
    stages.push(stage(
        "delivery:verify",
        "media.verify",
        "/delivery",
        "交付验证",
        "受控 ffprobe 媒体与结构验证",
        "pending",
        None,
        vec!["delivery:render".to_owned()],
        json!({
            "kind": "verify",
            "delivery": Value::Object(delivery.clone()),
            "sourceStageKey": "delivery:render"
        }),
    )?);

    let mut gates = vec![
        json!({ "gateKind": "system", "gateType": "route-plan", "status": "required" }),
        json!({ "gateKind": "system", "gateType": "run-budget", "status": "required" }),
    ];
    if let Some(spec_gates) = spec_record.get("gates").and_then(Value::as_array) {
        for (gate_index, gate) in spec_gates.iter().enumerate() {
            let gate = record(gate, &format!("spec.gates[{gate_index}]"))?;
            let gate_type = required_string(
                gate.get("type"),
                &format!("spec.gates[{gate_index}].type"),
                64,
            )?;
            let status = optional_string(
                gate.get("status"),
                &format!("spec.gates[{gate_index}].status"),
                32,
            )?
            .unwrap_or_else(|| "required".to_owned());
            if !["required", "approved", "waived"].contains(&status.as_str()) {
                return Err(invalid(format!(
                    "spec.gates[{gate_index}].status must be required, approved, or waived"
                )));
            }
            gates.push(json!({
                "gateKind": "director",
                "gateType": gate_type,
                "status": status
            }));
        }
    }

    let extensions = spec_record
        .get("extensions")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut core = spec_record.clone();
    core.remove("extensions");
    let core = Value::Object(core);
    let spec_hash = hash_json(spec)?;
    let mut blockers = Vec::new();
    if capability_blocked {
        blockers.push("CAPABILITY_UNAVAILABLE".to_owned());
    }
    blockers.push("ROUTE_PLAN_REQUIRED".to_owned());
    blockers.push("RUN_BUDGET_REQUIRED".to_owned());
    Ok(ProductionPlanDraft {
        project_id,
        title,
        review_policy,
        director: director.clone(),
        schema_version,
        core,
        extensions,
        spec_hash,
        stages,
        blockers,
        gates,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn build_workflow_projection(
    draft: &ProductionPlanDraft,
    projection_id: &str,
    production_session_id: &str,
    spec_revision_id: &str,
    production_run_id: &str,
    stage_run_ids: &[(String, String)],
) -> Result<Value, RuntimeError> {
    let stage_ids = stage_run_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashMap<_, _>>();
    let root_node_id = format!(
        "production-plan-{}",
        stable_projection_token(production_session_id)
    );
    let stage_node_id = |stage_key: &str| {
        format!(
            "production-stage-{}",
            stable_projection_token(&format!("{production_session_id}:{stage_key}"))
        )
    };
    let projection_metadata = |stage: Option<&CompiledStage>, stage_run_id: Option<&String>| {
        json!({
            "projectionId": projection_id,
            "projectionVersion": 1,
            "productionSessionId": production_session_id,
            "specRevisionId": spec_revision_id,
            "productionRunId": production_run_id,
            "stageRunId": stage_run_id,
            "stageKey": stage.map(|item| item.stage_key.as_str()),
            "capabilityId": stage.map(|item| item.capability_id.as_str())
        })
    };
    let mut nodes = vec![json!({
        "id": root_node_id,
        "type": "text",
        "title": draft.title,
        "position": { "x": 40, "y": 120 },
        "width": 320,
        "height": 220,
        "isVisible": true,
        "isLocked": false,
        "metadata": {
            "content": format!(
                "ProductionRun 等待处理：{}",
                draft.blockers.join(" · ")
            ),
            "status": "idle",
            "productionProjection": projection_metadata(None, None)
        }
    })];
    for (index, stage) in draft.stages.iter().enumerate() {
        let stage_run_id = stage_ids.get(&stage.stage_key).ok_or_else(|| {
            RuntimeError::new(
                "RUNTIME_UNAVAILABLE",
                format!("StageRun ID is missing for {}", stage.stage_key),
            )
        })?;
        nodes.push(json!({
            "id": stage_node_id(&stage.stage_key),
            "type": "text",
            "title": stage.title,
            "position": {
                "x": 420 + (index % 4) as i64 * 360,
                "y": 120 + (index / 4) as i64 * 280
            },
            "width": 320,
            "height": 220,
            "isVisible": true,
            "isLocked": false,
            "metadata": {
                "content": format!("{}\\n状态：{}\\n能力：{}", stage.summary, stage.status, stage.capability_id),
                "status": "idle",
                "productionProjection": projection_metadata(Some(stage), Some(stage_run_id))
            }
        }));
    }
    let connections = draft
        .stages
        .iter()
        .flat_map(|stage| {
            stage.dependencies.iter().map(|dependency| {
                let from_node_id = stage_node_id(dependency);
                let to_node_id = stage_node_id(&stage.stage_key);
                json!({
                    "id": format!(
                        "production-dependency-{}",
                        stable_projection_token(&format!("{from_node_id}:{to_node_id}"))
                    ),
                    "fromNodeId": from_node_id,
                    "toNodeId": to_node_id
                })
            })
        })
        .collect::<Vec<_>>();
    let mut projection = json!({
        "schemaVersion": "flovart.workflow-projection/1",
        "projectionId": projection_id,
        "projectionVersion": 1,
        "projectId": draft.project_id,
        "productionSessionId": production_session_id,
        "specRevisionId": spec_revision_id,
        "productionRunId": production_run_id,
        "nodes": nodes,
        "connections": connections
    });
    let projection_hash = hash_json(&projection)?;
    projection["projectionHash"] = json!(projection_hash);
    Ok(projection)
}

#[allow(clippy::too_many_arguments)]
fn stage(
    stage_key: &str,
    capability_id: &str,
    spec_path: &str,
    title: &str,
    summary: &str,
    status: &str,
    blocked_reason: Option<Value>,
    dependencies: Vec<String>,
    input: Value,
) -> Result<CompiledStage, RuntimeError> {
    Ok(CompiledStage {
        stage_key: stage_key.to_owned(),
        capability_id: capability_id.to_owned(),
        spec_path: spec_path.to_owned(),
        title: title.to_owned(),
        summary: summary.to_owned(),
        status: status.to_owned(),
        blocked_reason,
        dependencies,
        input_hash: hash_json(&input)?,
        input,
    })
}

fn record<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, RuntimeError> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{label} must be an object")))
}

fn array<'a>(value: &'a Value, label: &str) -> Result<&'a Vec<Value>, RuntimeError> {
    value
        .as_array()
        .ok_or_else(|| invalid(format!("{label} must be an array")))
}

fn required_string(value: Option<&Value>, label: &str, max: usize) -> Result<String, RuntimeError> {
    optional_string(value, label, max)?.ok_or_else(|| invalid(format!("{label} is required")))
}

fn optional_string(
    value: Option<&Value>,
    label: &str,
    max: usize,
) -> Result<Option<String>, RuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .ok_or_else(|| invalid(format!("{label} must be a string")))?
        .trim();
    if value.is_empty() || value.len() > max {
        return Err(invalid(format!("{label} must contain 1 to {max} bytes")));
    }
    Ok(Some(value.to_owned()))
}

fn required_positive_i64(
    value: Option<&Value>,
    label: &str,
    max: i64,
) -> Result<i64, RuntimeError> {
    let value = value
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid(format!("{label} must be an integer")))?;
    if !(1..=max).contains(&value) {
        return Err(invalid(format!("{label} must be between 1 and {max}")));
    }
    Ok(value)
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

/// Build the proposed Route Plan for a compiled run: one entry per provider-priced
/// stage with a static reservation estimate. Local capabilities cost zero.
pub fn build_route_plan(stages: &[(String, String, Value)]) -> Value {
    let mut entries = Vec::new();
    let mut total_micros = 0i64;
    for (stage_key, capability_id, input) in stages {
        let (product_model, estimate_micros) = match capability_id.as_str() {
            "image.generate" => ("flovart:gpt-image-2", EST_IMAGE_GPT2_MICROS),
            "video.generate" => {
                let duration_ms = input
                    .get("durationMs")
                    .and_then(Value::as_i64)
                    .unwrap_or(GROK_I2V_MAX_SHOT_MS);
                if duration_ms <= GROK_I2V_MAX_SHOT_MS {
                    ("flovart:grok-imagine-video-1.5", EST_VIDEO_GROK_I2V_MICROS)
                } else {
                    ("flovart:veo-3.1-lite", EST_VIDEO_VEO_LITE_MICROS)
                }
            }
            "audio.tts" | "media.render" | "media.verify" => ("flovart:local", 0),
            _ => continue,
        };
        total_micros += estimate_micros;
        entries.push(json!({
            "stageKey": stage_key,
            "capabilityId": capability_id,
            "productModel": product_model,
            "estimateMicros": estimate_micros,
            "unitCode": "CNY"
        }));
    }
    json!({
        "entries": entries,
        "totalEstimateMicros": total_micros,
        "unitCode": "CNY"
    })
}

fn hash_json(value: &Value) -> Result<String, RuntimeError> {
    let canonical = serde_json_canonicalizer::to_vec(value)
        .map_err(|error| RuntimeError::new("INVALID_ARGUMENT", error.to_string()))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

fn stable_projection_token(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))[..24].to_owned()
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new("INVALID_ARGUMENT", message)
}

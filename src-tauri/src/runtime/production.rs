use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

use super::RuntimeError;

#[derive(Clone, Debug)]
struct VoxDirection {
    theme_candidates: Vec<String>,
    selected_theme: String,
    stable_look_prompt: String,
    shot_directives: Map<String, Value>,
}

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
    let director_skill_id =
        required_string(director_record.get("skillId"), "director.skillId", 200)?;
    for field in ["version", "contentHash"] {
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
    // Language is later interpolated into a PowerShell script (audio.tts), so
    // restrict it to BCP-47-style tags before it can reach a command string.
    if !language
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err(invalid(
            "spec.delivery.language must contain only ASCII letters, digits, or hyphens (e.g. zh-CN)",
        ));
    }
    let style_prompt = spec_record
        .get("visual")
        .and_then(|visual| visual.get("stylePrompt"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let mut extensions = spec_record
        .get("extensions")
        .map(|value| record(value, "spec.extensions").cloned())
        .transpose()?
        .unwrap_or_default();
    if extensions.contains_key("flovart.workflow-draft") {
        return Err(invalid(
            "spec.extensions.flovart.workflow-draft is Runtime-reserved",
        ));
    }
    let draft_binding = validate_draft_binding(args.get("draftBinding"), &project_id)?;
    if let Some(binding) = &draft_binding {
        extensions.insert("flovart.workflow-draft".to_owned(), binding.clone());
    }
    let extensions = Value::Object(extensions);
    let vox = if director_skill_id == "community.vox-director" {
        Some(parse_vox_direction(&extensions)?)
    } else {
        None
    };
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
    let style_bakeoff_keys = if let Some(vox) = &vox {
        let representative_shot = beats
            .first()
            .and_then(Value::as_object)
            .and_then(|beat| beat.get("shots"))
            .and_then(Value::as_array)
            .and_then(|shots| shots.first())
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("VOX style bake-off requires one representative shot"))?;
        let scene = required_string(
            representative_shot.get("scene"),
            "VOX representative shot scene",
            8_000,
        )?;
        let headline = representative_shot
            .get("headline")
            .and_then(Value::as_str)
            .unwrap_or("");
        let mut keys = Vec::new();
        for theme in &vox.theme_candidates {
            let key = format!("style:bakeoff:{theme}");
            let prompt = compile_vox_bakeoff_prompt(vox, theme, &scene, headline);
            stages.push(stage(
                &key,
                "image.generate",
                "/extensions/community.vox-director/themeCandidates",
                &format!("风格样张 · {theme}"),
                if theme == &vox.selected_theme {
                    "同一代表镜头的 VOX 剪纸推荐候选"
                } else {
                    "同一代表镜头的 VOX 剪纸主题候选"
                },
                "ready",
                None,
                Vec::new(),
                json!({
                    "kind": "style-bakeoff",
                    "theme": theme,
                    "prompt": prompt,
                    "aspectRatio": aspect_ratio,
                    "resolution": "1k",
                    "requiredGates": ["spec"]
                }),
            )?);
            keys.push(key);
        }
        keys
    } else {
        Vec::new()
    };
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
            let supplied_motion_prompt = optional_string(
                shot.get("motionPrompt"),
                &format!("spec{path}.motionPrompt"),
                8_000,
            )?
            .unwrap_or_else(|| shot_prompt.clone());
            let (keyframe_prompt, motion_prompt, keyframe_required_gates, motion_required_gates) =
                if let Some(vox) = &vox {
                    let directive = vox.shot_directives.get(&shot_id).ok_or_else(|| {
                        invalid(format!("VOX shotDirectives is missing {shot_id}"))
                    })?;
                    (
                        compile_vox_keyframe_prompt(vox, shot, directive, &shot_prompt)?,
                        compile_vox_motion_prompt(shot, directive, &supplied_motion_prompt)?,
                        json!(["style-reference"]),
                        json!(["keyframe-review", "ocr"]),
                    )
                } else {
                    (
                        match &style_prompt {
                            Some(style) => format!("{style}\n{shot_prompt}"),
                            None => shot_prompt.clone(),
                        },
                        supplied_motion_prompt,
                        json!([]),
                        json!([]),
                    )
                };
            let summary = truncate(&scene, 180);
            let keyframe_key = format!("shot:{shot_id}:keyframe");
            let motion_key = format!("shot:{shot_id}:motion");
            stages.push(stage(
                &keyframe_key,
                "image.generate",
                &format!("{path}/keyframe"),
                &format!("关键帧 · {shot_id}"),
                &summary,
                if vox.is_some() { "pending" } else { "ready" },
                None,
                style_bakeoff_keys.clone(),
                json!({
                    "kind": "keyframe",
                    "shotId": shot_id,
                    "scene": scene,
                    "prompt": keyframe_prompt,
                    "aspectRatio": aspect_ratio,
                    "resolution": "1k",
                    "requiredGates": keyframe_required_gates,
                    "styleReferenceGate": vox.as_ref().map(|_| "style-reference")
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
                    "sourceStageKey": keyframe_key,
                    "requiredGates": motion_required_gates
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

    let mut core = spec_record.clone();
    core.remove("extensions");
    let core = Value::Object(core);
    let spec_hash = match &draft_binding {
        Some(binding) => hash_json(&json!({ "spec": spec, "draftBinding": binding }))?,
        None => hash_json(spec)?,
    };
    let mut blockers = Vec::new();
    if capability_blocked {
        blockers.push("CAPABILITY_UNAVAILABLE".to_owned());
    }
    blockers.push("ROUTE_PLAN_REQUIRED".to_owned());
    blockers.push("RUN_BUDGET_REQUIRED".to_owned());
    for gate in &gates {
        if gate.get("gateKind").and_then(Value::as_str) == Some("director")
            && gate.get("status").and_then(Value::as_str) == Some("required")
        {
            if let Some(gate_type) = gate.get("gateType").and_then(Value::as_str) {
                blockers.push(format!("DIRECTOR_GATE_REQUIRED:{gate_type}"));
            }
        }
    }
    if vox.is_some() {
        validate_vox_gates(&gates)?;
    }
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

fn string_array(
    value: Option<&Value>,
    label: &str,
    minimum: usize,
) -> Result<Vec<String>, RuntimeError> {
    let values = array(value.unwrap_or(&Value::Null), label)?;
    if values.len() < minimum {
        return Err(invalid(format!(
            "{label} must contain at least {minimum} items"
        )));
    }
    values
        .iter()
        .enumerate()
        .map(|(index, value)| required_string(Some(value), &format!("{label}[{index}]"), 200))
        .collect()
}

fn validate_draft_binding(
    value: Option<&Value>,
    project_id: &str,
) -> Result<Option<Value>, RuntimeError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let binding = record(value, "draftBinding")?;
    let allowed = [
        "schemaVersion",
        "projectId",
        "draftVersion",
        "sourceNodeIds",
        "objectVersions",
        "changeSetIds",
        "snapshotHash",
    ];
    if let Some(field) = binding
        .keys()
        .find(|field| !allowed.contains(&field.as_str()))
    {
        return Err(invalid(format!(
            "draftBinding contains unknown field: {field}"
        )));
    }
    if required_string(
        binding.get("schemaVersion"),
        "draftBinding.schemaVersion",
        64,
    )? != "flovart.workflow-draft-binding/1"
    {
        return Err(invalid(
            "draftBinding.schemaVersion must be flovart.workflow-draft-binding/1",
        ));
    }
    if required_string(binding.get("projectId"), "draftBinding.projectId", 200)? != project_id {
        return Err(invalid("draftBinding.projectId must match projectId"));
    }
    let draft_version = binding
        .get("draftVersion")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| invalid("draftBinding.draftVersion must be a positive integer"))?;
    let source_node_ids = string_array(
        binding.get("sourceNodeIds"),
        "draftBinding.sourceNodeIds",
        1,
    )?;
    if source_node_ids.len() > 200
        || source_node_ids.iter().collect::<HashSet<_>>().len() != source_node_ids.len()
    {
        return Err(invalid(
            "draftBinding.sourceNodeIds must contain 1 to 200 unique node IDs",
        ));
    }
    let object_versions = record(
        binding.get("objectVersions").unwrap_or(&Value::Null),
        "draftBinding.objectVersions",
    )?;
    if source_node_ids.iter().any(|id| {
        object_versions
            .get(id)
            .and_then(Value::as_u64)
            .filter(|version| *version > 0)
            .is_none()
    }) {
        return Err(invalid(
            "draftBinding.objectVersions must contain a positive version for every source node",
        ));
    }
    let change_set_ids = string_array(binding.get("changeSetIds"), "draftBinding.changeSetIds", 0)?;
    if change_set_ids.len() > 100 {
        return Err(invalid(
            "draftBinding.changeSetIds supports at most 100 IDs",
        ));
    }
    let snapshot_hash =
        required_string(binding.get("snapshotHash"), "draftBinding.snapshotHash", 64)?;
    if snapshot_hash.len() != 64
        || !snapshot_hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(invalid(
            "draftBinding.snapshotHash must be a lowercase SHA-256 hex digest",
        ));
    }
    Ok(Some(json!({
        "schemaVersion": "flovart.workflow-draft-binding/1",
        "projectId": project_id,
        "draftVersion": draft_version,
        "sourceNodeIds": source_node_ids,
        "objectVersions": object_versions,
        "changeSetIds": change_set_ids,
        "snapshotHash": snapshot_hash
    })))
}

fn parse_vox_direction(extensions: &Value) -> Result<VoxDirection, RuntimeError> {
    let extensions = record(extensions, "spec.extensions")?;
    let extension = extensions
        .get("community.vox-director")
        .ok_or_else(|| invalid("VOX requires extensions.community.vox-director"))?;
    let extension = record(extension, "extensions.community.vox-director")?;
    if required_string(extension.get("schemaVersion"), "VOX schemaVersion", 16)? != "1" {
        return Err(invalid("VOX schemaVersion must be 1"));
    }
    let theme_candidates =
        string_array(extension.get("themeCandidates"), "VOX themeCandidates", 3)?;
    if theme_candidates.len() > 4 {
        return Err(invalid("VOX themeCandidates must contain 3 or 4 items"));
    }
    let unique = theme_candidates.iter().collect::<HashSet<_>>();
    if unique.len() != theme_candidates.len() {
        return Err(invalid("VOX themeCandidates must be unique"));
    }
    let selected_theme = required_string(extension.get("selectedTheme"), "VOX selectedTheme", 200)?;
    if !theme_candidates.contains(&selected_theme) {
        return Err(invalid("VOX selectedTheme must be one of themeCandidates"));
    }
    let look = record(extension.get("look").unwrap_or(&Value::Null), "VOX look")?;
    let idiom = required_string(look.get("idiom"), "VOX look.idiom", 500)?;
    if !idiom.to_ascii_lowercase().contains("paper")
        || !idiom.to_ascii_lowercase().contains("collage")
    {
        return Err(invalid(
            "VOX look.idiom must explicitly lock a paper collage",
        ));
    }
    let palette = string_array(look.get("palette"), "VOX look.palette", 3)?;
    let type_style = required_string(look.get("typeStyle"), "VOX look.typeStyle", 500)?;
    let finish = string_array(look.get("finish"), "VOX look.finish", 4)?;
    let constraints = required_string(look.get("constraints"), "VOX look.constraints", 32)?;
    if constraints != "strict" {
        return Err(invalid("VOX look.constraints must be strict"));
    }
    required_string(look.get("motionStyle"), "VOX look.motionStyle", 32)?;
    let shot_directives = record(
        extension.get("shotDirectives").unwrap_or(&Value::Null),
        "VOX shotDirectives",
    )?
    .clone();
    if shot_directives.is_empty() {
        return Err(invalid("VOX shotDirectives must not be empty"));
    }
    let stable_look_prompt = format!(
        "VOX editorial hand-cut paper collage, straight-on scanned-flat 2D poster composition. \
Every subject is a separate printed paper cut-out with visibly torn or scissor-cut edges, physical paper thickness, small contact shadows, and rigid layer separation. \
Look idiom: {idiom}. Palette: {}. Typography: {type_style}. Print finish: {}. \
Use real newsprint fibers, halftone dots, ink misregistration, tape, photocopy grain, and tactile torn edges. \
Never render a unified photorealistic scene, smooth vector illustration, glossy CGI, clay, soft 3D forms, painterly blending, or synthetic depth-of-field.",
        palette.join(", "),
        finish.join(", "),
    );
    Ok(VoxDirection {
        theme_candidates,
        selected_theme,
        stable_look_prompt,
        shot_directives,
    })
}

fn vox_theme_direction(theme: &str) -> &'static str {
    match theme {
        "american-retro" => "aged American editorial print, slab and wood type, warm cream, deep red, ink black, cold blue, bold primary blocks",
        "swiss-modern" => "Swiss editorial grid, condensed grotesque type, restrained duotone, precise modular paper blocks",
        "punk-zine" => "photocopied punk zine, ransom-note typography, rough black ink, one aggressive spot color, ripped margins",
        "soviet-constructivist" => "constructivist diagonal geometry, red black and cream newsprint, monumental cut-out type",
        "wpa-propaganda" => "WPA screenprint poster, muted public-history palette, stencil lettering, coarse paper stock",
        "70s-groovy" => "1970s editorial collage, mustard rust and avocado, chunky display serif, riso grain",
        "chinese-ink" => "Chinese woodblock and ink collage, rice-paper fibers, vermilion seal, hand-cut silhouette layers",
        "atomic-age" => "atomic-age editorial print, teal orange and cream, retro-futurist cut-paper geometry, halftone",
        _ => "topic-specific editorial paper-collage art direction with a distinct limited palette and print-era typography",
    }
}

fn compile_vox_bakeoff_prompt(
    vox: &VoxDirection,
    theme: &str,
    scene: &str,
    headline: &str,
) -> String {
    format!(
        "{}\nSTYLE BAKE-OFF — render the exact same representative shot for visual comparison. Candidate theme: {theme}. Theme direction: {}. \
Scene pieces: {scene}. Exact headline text: \"{headline}\". Keep the same composition and subject arrangement across all candidates; vary only theme palette, typography, and print finish. \
Headline must be legible and spelled exactly; do not invent any other text.",
        vox.stable_look_prompt,
        vox_theme_direction(theme),
    )
}

fn compile_vox_keyframe_prompt(
    vox: &VoxDirection,
    shot: &Map<String, Value>,
    directive: &Value,
    shot_prompt: &str,
) -> Result<String, RuntimeError> {
    let directive = record(directive, "VOX shot directive")?;
    let shot_size = required_string(directive.get("shotSize"), "VOX shotSize", 32)?;
    let headline_locked = directive
        .get("headlineLocked")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("VOX headlineLocked must be boolean"))?;
    let headline = shot.get("headline").and_then(Value::as_str).unwrap_or("");
    if headline_locked && headline.trim().is_empty() {
        return Err(invalid(
            "VOX headlineLocked shots require an exact shot.headline",
        ));
    }
    Ok(format!(
        "{}\nAPPROVED STYLE LOCK: use the supplied approved bake-off image as the visual identity reference. Preserve its paper stock, edge treatment, halftone scale, palette behavior, typography family, lighting, and flat layer depth. \
The style-reference gate, not selectedTheme, determines the final visual identity. Shot size: {shot_size}. Scene pieces: {shot_prompt}. Exact headline text: \"{headline}\". \
Compose the scene from separable foreground, subject, labels, arrows, and background paper pieces; keep each piece visibly cut out and physically plausible. \
{} Do not invent letters, logos, labels, gradients, photoreal skin, smooth painted transitions, or 3D objects.",
        vox.stable_look_prompt,
        if headline_locked { "The headline is locked: render it once, exactly as written." } else { "If the headline is empty, render no text." },
    ))
}

fn compile_vox_motion_prompt(
    shot: &Map<String, Value>,
    directive: &Value,
    supplied_motion_prompt: &str,
) -> Result<String, RuntimeError> {
    let directive = record(directive, "VOX shot directive")?;
    let camera_move = required_string(directive.get("cameraMove"), "VOX cameraMove", 32)?;
    let element_motion =
        required_string(directive.get("elementMotion"), "VOX elementMotion", 1_000)?;
    let headline_locked = directive
        .get("headlineLocked")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let headline = shot.get("headline").and_then(Value::as_str).unwrap_or("");
    Ok(format!(
        "Animate the supplied approved keyframe only; do not redesign or redraw it. Preserve the exact composition, palette, headline, paper textures, torn edges, logos, and rigid paper layers. \
Use one continuous {camera_move} camera move that settles. Element motion: {element_motion}. Narrative motion intent: {supplied_motion_prompt}. \
Keep all collage pieces flat and mechanically layered with subtle physical parallax; no morphing, no internal cuts, no new objects, no new text, no spelling changes, no photoreal transformation. \
{} The supplied approved keyframe is the sole visual identity reference.",
        if headline_locked { format!("Locked headline must remain exactly \"{headline}\".") } else { "Any existing type must remain frozen and legible.".to_owned() },
    ))
}

fn validate_vox_gates(gates: &[Value]) -> Result<(), RuntimeError> {
    let gate_status = gates
        .iter()
        .filter_map(|gate| {
            Some((
                gate.get("gateType")?.as_str()?,
                gate.get("status")?.as_str()?,
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();
    for required in ["spec", "style-reference", "keyframe-review", "ocr"] {
        if !gate_status.contains_key(required) {
            return Err(invalid(format!(
                "VOX requires the {required} director gate"
            )));
        }
    }
    for required in ["style-reference", "keyframe-review", "ocr"] {
        if gate_status.get(required) != Some(&"required") {
            return Err(invalid(format!(
                "VOX {required} must remain required until its Runtime review is completed"
            )));
        }
    }
    Ok(())
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

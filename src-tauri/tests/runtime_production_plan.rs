use flovart_lib::runtime::ProductionRuntime;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

fn test_database_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("flovart-production-plan-{}", Uuid::now_v7()))
        .join("state.db")
}

fn envelope(command: &str, args: Value, idempotency_key: Option<&str>) -> Value {
    let mut envelope = json!({
        "protocolVersion": "1",
        "commandId": ProductionRuntime::new_id("cmd"),
        "command": command,
        "args": args,
        "actor": { "kind": "cli", "instanceId": "cli_production_plan_test" }
    });
    if let Some(key) = idempotency_key {
        envelope["idempotencyKey"] = json!(key);
    }
    envelope
}

fn approved_vox_spec() -> Value {
    json!({
        "schemaVersion": "flovart.production-spec/1",
        "delivery": {
            "durationMs": 10_000,
            "aspectRatio": "16:9",
            "container": "mp4"
        },
        "narrative": {
            "arc": "how_it_works",
            "beats": [{
                "id": "beat-1",
                "order": 1,
                "narration": "一段解释性旁白。",
                "shots": [
                    {
                        "id": "shot-1a",
                        "order": 1,
                        "durationMs": 5_000,
                        "scene": "纸张拼贴开场。"
                    },
                    {
                        "id": "shot-1b",
                        "order": 2,
                        "durationMs": 5_000,
                        "scene": "报纸纹理细节。"
                    }
                ]
            }]
        },
        "audio": {
            "narration": { "voiceProfile": "documentary" }
        },
        "extensions": {
            "vox-director": {
                "schemaVersion": "1",
                "selectedTheme": "american-retro"
            }
        }
    })
}

fn gated_community_vox_spec() -> Value {
    json!({
        "schemaVersion": "flovart.production-spec/1",
        "delivery": { "durationMs": 10_000, "aspectRatio": "16:9", "container": "mp4" },
        "narrative": {
            "arc": "hook_payoff",
            "beats": [{
                "id": "beat-1",
                "narration": "为什么一张纸，能让解释更有说服力？",
                "shots": [
                    { "id": "shot-wide", "durationMs": 5_000, "scene": "人物剪影站在层叠报纸和红色箭头之间。", "headline": "一张纸的力量" },
                    { "id": "shot-detail", "durationMs": 5_000, "scene": "撕纸边缘、印刷网点和胶带的近景。" }
                ]
            }]
        },
        "audio": { "narration": { "voiceProfile": "documentary-neutral" } },
        "gates": [
            { "id": "approve-spec", "type": "spec", "status": "approved" },
            { "id": "approve-style", "type": "style-reference", "status": "required" },
            { "id": "review-keyframes", "type": "keyframe-review", "status": "required" },
            { "id": "verify-ocr", "type": "ocr", "status": "required" }
        ],
        "extensions": {
            "community.vox-director": {
                "schemaVersion": "1",
                "themeCandidates": ["american-retro", "swiss-modern", "punk-zine"],
                "selectedTheme": "american-retro",
                "look": {
                    "idiom": "mixed-media hand-cut paper collage",
                    "palette": ["warm cream", "deep red", "ink black"],
                    "typeStyle": "bold condensed cut-out headline",
                    "finish": ["torn-edge", "halftone-print", "newsprint", "paper-tape", "print-grain"],
                    "motionStyle": "punchy",
                    "constraints": "strict"
                },
                "shotDirectives": {
                    "shot-wide": { "shotSize": "WIDE", "cameraMove": "push_in", "elementMotion": "标题纸片滑入，箭头逐层展开", "headlineLocked": true },
                    "shot-detail": { "shotSize": "DETAIL", "cameraMove": "parallax", "elementMotion": "纸层产生克制视差后稳定停住", "headlineLocked": false }
                }
            }
        }
    })
}

fn wait_for_task(runtime: &ProductionRuntime, task_id: &str) -> Value {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let task = runtime
            .execute(&envelope("task.get", json!({ "taskId": task_id }), None))
            .expect("production task");
        if task["status"] == "completed" {
            return task;
        }
        assert_ne!(task["status"], "failed", "production task failed: {task}");
        assert!(
            Instant::now() < deadline,
            "production task timed out: {task}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn production_spec_compiles_to_a_durable_run_stage_dag_and_workflow_projection() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");

    let (run_id, projection_hash) = {
        let runtime =
            ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime");
        let receipt = runtime
            .execute(&envelope(
                "production.dry-run",
                json!({
                    "projectId": "workflow-project-1",
                    "title": "VOX Production Plan",
                    "director": {
                        "skillId": "vox-director",
                        "version": "1.0.0",
                        "contentHash": "sha256:vox-director-test"
                    },
                    "spec": approved_vox_spec()
                }),
                Some("compile-vox-plan-v1"),
            ))
            .expect("production dry-run receipt");
        let task_id = receipt["taskId"].as_str().expect("task id");
        let completed = wait_for_task(&runtime, task_id);
        let result = &completed["result"];
        let run_id = result["productionRunId"]
            .as_str()
            .expect("production run id")
            .to_owned();

        let status = runtime
            .execute(&envelope(
                "production.status",
                json!({ "runId": run_id }),
                None,
            ))
            .expect("production status");
        assert_eq!(status["status"], "action_required");
        assert_eq!(status["stages"].as_array().expect("stages").len(), 7);
        // Narration-only audio compiles to the local audio.tts capability, so the
        // remaining blockers are the two unapproved system gates.
        assert_eq!(
            status["blockers"],
            json!(["ROUTE_PLAN_REQUIRED", "RUN_BUDGET_REQUIRED"])
        );

        // Approving the route-plan gate alone keeps the run blocked on budget.
        let route_decision = runtime
            .execute(&envelope(
                "production.approve",
                json!({ "runId": run_id, "gateType": "route-plan" }),
                Some("approve-route-plan-v1"),
            ))
            .expect("route-plan approval");
        assert_eq!(route_decision["runStatus"], "action_required");
        assert_eq!(route_decision["blockers"], json!(["RUN_BUDGET_REQUIRED"]));

        // production.run must refuse to execute an unapproved run.
        let premature = runtime.execute(&envelope(
            "production.run",
            json!({ "runId": run_id }),
            Some("premature-run-v1"),
        ));
        assert_eq!(
            premature.expect_err("premature run must fail").code,
            "PRECONDITION_FAILED"
        );

        // Approving the budget gate advances the run to queued.
        let budget_decision = runtime
            .execute(&envelope(
                "production.approve",
                json!({
                    "runId": run_id,
                    "gateType": "run-budget",
                    "hardLimitMicros": 5_000_000
                }),
                Some("approve-run-budget-v1"),
            ))
            .expect("run-budget approval");
        assert_eq!(budget_decision["runStatus"], "queued");
        assert_eq!(budget_decision["blockers"], json!([]));

        // Replaying the same approval with the same key returns the same result.
        let replay = runtime
            .execute(&envelope(
                "production.approve",
                json!({
                    "runId": run_id,
                    "gateType": "run-budget",
                    "hardLimitMicros": 5_000_000
                }),
                Some("approve-run-budget-v1"),
            ))
            .expect("idempotent approval replay");
        assert_eq!(replay["runStatus"], "queued");

        let connection = Connection::open(&database_path).expect("open projection test database");
        connection
            .execute(
                "UPDATE stage_runs
                    SET status = 'succeeded',
                        task_id = ?1,
                        result_json = ?2
                  WHERE run_id = ?3 AND stage_key = ?4",
                params![
                    "task_image_projection_test",
                    json!({
                        "artifact": {
                            "kind": "image",
                            "mimeType": "image/png",
                            "storeRelpath": "runtime-artifacts/images/task_image_projection_test.png",
                            "sha256": "a".repeat(64),
                            "byteSize": 12
                        }
                    })
                    .to_string(),
                    run_id,
                    "shot:shot-1a:keyframe"
                ],
            )
            .expect("seed completed image artifact");

        let projection_response = runtime
            .execute(&envelope(
                "workflow.projection.get",
                json!({ "projectId": "workflow-project-1" }),
                None,
            ))
            .expect("workflow projection");
        let projection = &projection_response["projection"];
        assert_eq!(projection["projectId"], "workflow-project-1");
        assert_eq!(projection["productionRunId"], run_id);
        let keyframe_node = projection["nodes"]
            .as_array()
            .expect("projection nodes")
            .iter()
            .find(|node| node["metadata"]["productionProjection"]["stageKey"] == "shot:shot-1a:keyframe")
            .expect("keyframe projection node");
        assert_eq!(keyframe_node["type"], "image");
        assert_eq!(
            keyframe_node["metadata"]["artifactRef"]["taskId"],
            "task_image_projection_test"
        );
        assert_eq!(keyframe_node["metadata"]["status"], "success");
        assert_eq!(
            projection["nodes"]
                .as_array()
                .expect("projection nodes")
                .len(),
            8
        );
        assert_eq!(
            projection["connections"]
                .as_array()
                .expect("projection connections")
                .len(),
            6
        );
        let projection_hash = projection["projectionHash"]
            .as_str()
            .expect("projection hash")
            .to_owned();
        assert_eq!(projection_hash.len(), 64);
        (run_id, projection_hash)
    };

    let restarted =
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("restart");
    let status = restarted
        .execute(&envelope(
            "production.status",
            json!({ "runId": run_id }),
            None,
        ))
        .expect("durable production status");
    // Gate decisions survive restart: the approved run stays queued.
    assert_eq!(status["status"], "queued");
    let projection_response = restarted
        .execute(&envelope(
            "workflow.projection.get",
            json!({ "projectId": "workflow-project-1" }),
            None,
        ))
        .expect("durable workflow projection");
    let projection = &projection_response["projection"];
    assert_eq!(projection["projectionHash"], projection_hash);

    drop(restarted);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn community_vox_compiler_creates_same_shot_bakeoff_and_blocks_motion_on_review_gates() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let runtime = ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path)
        .expect("runtime");
    let receipt = runtime.execute(&envelope(
        "production.dry-run",
        json!({
            "projectId": "workflow-vox-gated",
            "title": "VOX gated plan",
            "draftBinding": {
                "schemaVersion": "flovart.workflow-draft-binding/1",
                "projectId": "workflow-vox-gated",
                "draftVersion": 7,
                "sourceNodeIds": ["brief-node"],
                "objectVersions": { "brief-node": 4 },
                "changeSetIds": ["agent-turn-1"],
                "snapshotHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            },
            "director": {
                "skillId": "community.vox-director",
                "version": "1.0.0",
                "contentHash": "sha256:community-vox-test"
            },
            "spec": gated_community_vox_spec()
        }),
        Some("compile-community-vox-gated-v1"),
    )).expect("production dry-run receipt");
    let completed = wait_for_task(&runtime, receipt["taskId"].as_str().expect("task id"));
    let run_id = completed["result"]["productionRunId"].as_str().expect("run id");
    let status = runtime.execute(&envelope(
        "production.status",
        json!({ "runId": run_id }),
        None,
    )).expect("production status");

    let stages = status["stages"].as_array().expect("stages");
    assert_eq!(stages.len(), 10);
    let bakeoffs = stages.iter().filter(|stage| {
        stage["stageKey"].as_str().unwrap_or_default().starts_with("style:bakeoff:")
    }).collect::<Vec<_>>();
    assert_eq!(bakeoffs.len(), 3);
    assert!(bakeoffs.iter().all(|stage| {
        stage["input"]["prompt"].as_str().unwrap_or_default().contains("hand-cut paper")
    }));
    let keyframe = stages.iter().find(|stage| stage["stageKey"] == "shot:shot-wide:keyframe")
        .expect("keyframe stage");
    assert_eq!(keyframe["input"]["requiredGates"], json!(["style-reference"]));
    assert!(keyframe["input"]["prompt"].as_str().unwrap_or_default().contains("torn-edge"));
    let motion = stages.iter().find(|stage| stage["stageKey"] == "shot:shot-wide:motion")
        .expect("motion stage");
    assert_eq!(motion["input"]["requiredGates"], json!(["keyframe-review", "ocr"]));
    assert!(motion["input"]["prompt"].as_str().unwrap_or_default().contains("rigid paper layers"));
    assert!(status["gates"].as_array().expect("gates").iter().any(|gate| {
        gate["gateType"] == "style-reference" && gate["status"] == "required"
    }));
    assert_eq!(status["draftBinding"]["draftVersion"], 7);
    assert_eq!(status["draftBinding"]["sourceNodeIds"], json!(["brief-node"]));

    drop(runtime);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn community_vox_compiler_rejects_preapproved_keyframe_or_ocr_gates() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let runtime = ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path)
        .expect("runtime");
    let mut spec = gated_community_vox_spec();
    spec["gates"][2]["status"] = json!("approved");
    let error = runtime.execute(&envelope(
        "production.dry-run",
        json!({
            "projectId": "workflow-vox-premature-gates",
            "title": "VOX invalid review gates",
            "director": {
                "skillId": "community.vox-director",
                "version": "1.0.0",
                "contentHash": "sha256:community-vox-premature-gates"
            },
            "spec": spec
        }),
        Some("compile-community-vox-premature-gates-v1"),
    )).expect_err("preapproved keyframe gate must be rejected");
    assert!(error.message.contains("keyframe-review"));

    drop(runtime);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn community_vox_compiler_rejects_more_than_four_style_candidates() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let runtime = ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path)
        .expect("runtime");
    let mut spec = gated_community_vox_spec();
    spec["extensions"]["community.vox-director"]["themeCandidates"] = json!([
        "american-retro",
        "swiss-modern",
        "punk-zine",
        "documentary-archive",
        "bold-pop"
    ]);
    let error = runtime.execute(&envelope(
        "production.dry-run",
        json!({
            "projectId": "workflow-vox-too-many-themes",
            "title": "VOX oversized style review",
            "director": {
                "skillId": "community.vox-director",
                "version": "1.0.0",
                "contentHash": "sha256:community-vox-too-many-themes"
            },
            "spec": spec
        }),
        Some("compile-community-vox-too-many-themes-v1"),
    )).expect_err("more than four VOX style candidates must be rejected");
    assert!(error.message.contains("themeCandidates"));

    drop(runtime);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn running_vox_plan_waits_for_an_approved_bakeoff_and_forwards_that_artifact_to_keyframes() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let runtime = ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path)
        .expect("runtime");
    let receipt = runtime.execute(&envelope(
        "production.dry-run",
        json!({
            "projectId": "workflow-vox-reference",
            "title": "VOX approved reference",
            "director": {
                "skillId": "community.vox-director",
                "version": "1.0.0",
                "contentHash": "sha256:community-vox-reference"
            },
            "spec": gated_community_vox_spec()
        }),
        Some("compile-community-vox-reference-v1"),
    )).expect("production dry-run receipt");
    let completed = wait_for_task(&runtime, receipt["taskId"].as_str().expect("task id"));
    let run_id = completed["result"]["productionRunId"].as_str().expect("run id").to_owned();

    let connection = Connection::open(&database_path).expect("open runtime database");
    let selected_stage = "style:bakeoff:swiss-modern";
    for (index, stage_key) in [
        "style:bakeoff:american-retro",
        "style:bakeoff:swiss-modern",
        "style:bakeoff:punk-zine",
    ].iter().enumerate() {
        connection.execute(
            "UPDATE stage_runs SET status = 'succeeded', task_id = ?1, result_json = ?2
              WHERE run_id = ?3 AND stage_key = ?4",
            params![
                format!("task_style_reference_{index}"),
                json!({ "artifact": { "kind": "image", "mimeType": "image/png" } }).to_string(),
                run_id,
                stage_key,
            ],
        ).expect("seed bake-off result");
    }
    drop(connection);

    runtime.execute(&envelope(
        "production.approve",
        json!({ "runId": run_id, "gateType": "route-plan" }),
        Some("approve-reference-route-v1"),
    )).expect("approve route");
    runtime.execute(&envelope(
        "production.approve",
        json!({ "runId": run_id, "gateType": "run-budget", "hardLimitMicros": 8_000_000 }),
        Some("approve-reference-budget-v1"),
    )).expect("approve budget");
    runtime.execute(&envelope(
        "production.run",
        json!({ "runId": run_id }),
        Some("run-reference-plan-v1"),
    )).expect("start production run");

    let premature_review = runtime.execute(&envelope(
        "production.approve",
        json!({ "runId": run_id, "gateType": "keyframe-review" }),
        Some("approve-keyframes-too-early-v1"),
    ));
    assert_eq!(premature_review.expect_err("keyframes are not ready for review").code, "PRECONDITION_FAILED");

    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let status = runtime.execute(&envelope(
            "production.status",
            json!({ "runId": run_id }),
            None,
        )).expect("production status");
        let keyframe = status["stages"].as_array().expect("stages").iter()
            .find(|stage| stage["stageKey"] == "shot:shot-wide:keyframe")
            .expect("keyframe stage");
        if status["status"] == "running" && keyframe["status"] == "ready" {
            assert!(keyframe["taskId"].is_null());
            break;
        }
        assert!(Instant::now() < deadline, "keyframe did not wait at style gate: {status}");
        thread::sleep(Duration::from_millis(50));
    }

    let missing_selection = runtime.execute(&envelope(
        "production.approve",
        json!({ "runId": run_id, "gateType": "style-reference" }),
        Some("approve-style-without-selection-v1"),
    ));
    assert_eq!(missing_selection.expect_err("selection is required").code, "INVALID_ARGUMENT");

    let decision = runtime.execute(&envelope(
        "production.approve",
        json!({
            "runId": run_id,
            "gateType": "style-reference",
            "approvedStageKey": selected_stage
        }),
        Some("approve-style-selection-v1"),
    )).expect("approve selected style reference");
    assert_eq!(decision["runStatus"], "running");

    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let connection = Connection::open(&database_path).expect("open runtime database");
        let args = connection.query_row(
            "SELECT args_json FROM runtime_tasks
              WHERE kind = 'generate.image'
                AND json_extract(args_json, '$.sourceImageIds[0]') = 'task_style_reference_1'
              LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        ).optional().expect("query keyframe task");
        if let Some(args) = args {
            let args: Value = serde_json::from_str(&args).expect("keyframe args");
            assert_eq!(args["sourceImageIds"], json!(["task_style_reference_1"]));
            assert!(!args["prompt"].as_str().unwrap_or_default().contains("american-retro"));
            break;
        }
        assert!(Instant::now() < deadline, "approved style reference was not forwarded");
        thread::sleep(Duration::from_millis(50));
    }

    drop(runtime);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

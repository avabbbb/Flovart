use flovart_lib::runtime::ProductionRuntime;
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
        assert_eq!(
            status["blockers"],
            json!([
                "CAPABILITY_UNAVAILABLE",
                "ROUTE_PLAN_REQUIRED",
                "RUN_BUDGET_REQUIRED"
            ])
        );

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
    assert_eq!(status["status"], "action_required");
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

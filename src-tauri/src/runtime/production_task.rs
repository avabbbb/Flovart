use serde_json::{json, Map, Value};

pub const SCHEMA_VERSION: &str = "flovart.production-task/1";

/// Normalize the durable ProductionRun/StageRun records into the small
/// lifecycle object consumed by agents and host integrations. This is a
/// projection, not a second source of Workflow truth.
pub fn from_run(run: &Value, runtime_task: Option<&Value>) -> Value {
    let task_id = string_or_empty(run, "id");
    let stages = run
        .get("stages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current_step = stages
        .iter()
        .find(|stage| {
            matches!(
                stage.get("status").and_then(Value::as_str),
                Some("running" | "ready")
            )
        })
        .and_then(|stage| stage.get("stageKey"))
        .and_then(Value::as_str);
    let job_ids = stages
        .iter()
        .filter_map(|stage| stage.get("taskId").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let artifact_ids = stages
        .iter()
        .filter_map(|stage| stage.get("artifact").and_then(artifact_id))
        .collect::<Vec<_>>();
    let completed_stage_keys = stage_keys(&stages, "succeeded");
    let failed_stage_keys = stages
        .iter()
        .filter(|stage| {
            matches!(
                stage.get("status").and_then(Value::as_str),
                Some("failed" | "blocked")
            )
        })
        .filter_map(|stage| stage.get("stageKey").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();

    let mut checkpoint = Map::new();
    checkpoint.insert(
        "runStatus".to_owned(),
        json!(string_or_empty(run, "status")),
    );
    checkpoint.insert("completedStageKeys".to_owned(), json!(completed_stage_keys));
    checkpoint.insert("failedStageKeys".to_owned(), json!(failed_stage_keys));
    if let Some(current_step) = current_step {
        checkpoint.insert("activeStageKey".to_owned(), json!(current_step));
    }
    if let Some(revision) = run.get("specRevisionId").and_then(Value::as_str) {
        checkpoint.insert("productionRevision".to_owned(), json!(revision));
    }

    let mut normalized = json!({
        "schemaVersion": SCHEMA_VERSION,
        "taskId": task_id,
        "workflowId": string_or_empty(run, "projectId"),
        "productionRunId": string_or_empty(run, "id"),
        "intent": string_or_empty(run, "title"),
        "state": task_state(run.get("status").and_then(Value::as_str).unwrap_or_default()),
        "runIds": [string_or_empty(run, "id")],
        "jobIds": job_ids,
        "artifactIds": artifact_ids,
        "checkpoint": checkpoint,
        "retryPolicy": {
            "strategy": "stage-idempotent",
            "retryCompletedStages": false,
            "duplicateSubmission": "reject"
        },
        "createdBy": { "surface": "production-runtime" },
        "createdAt": run.get("createdAt").and_then(Value::as_i64).unwrap_or_default(),
        "updatedAt": run.get("updatedAt").and_then(Value::as_i64).unwrap_or_default()
    });
    if let Some(runtime_task) = runtime_task {
        normalized["runtimeTask"] = json!({
            "id": runtime_task.get("id"),
            "status": runtime_task.get("status")
        });
    }
    normalized
}

pub fn resume_result(task: &Value, runtime_task: &Value) -> Value {
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "taskId": task.get("taskId"),
        "resumed": true,
        "recoveryMode": "existing-runtime-task",
        "runtimeTaskId": runtime_task.get("id"),
        "task": task
    })
}

/// Return only the public identity/description fields of a media Artifact.
/// `storeRelpath` and all other private execution fields stay in Runtime.
pub fn artifact_reference(result: &Value) -> Option<Value> {
    let artifact = result.get("artifact")?.as_object()?;
    let mut reference = Map::new();
    for key in [
        "artifactId",
        "id",
        "kind",
        "mimeType",
        "sha256",
        "byteSize",
        "durationSec",
    ] {
        if let Some(value) = artifact.get(key) {
            reference.insert(key.to_owned(), value.clone());
        }
    }
    (!reference.is_empty()).then_some(Value::Object(reference))
}

fn artifact_id(artifact: &Value) -> Option<String> {
    if let Some(id) = artifact
        .get("artifactId")
        .or_else(|| artifact.get("id"))
        .and_then(Value::as_str)
    {
        return Some(id.to_owned());
    }
    artifact.get("sha256").and_then(Value::as_str).map(|hash| {
        if hash.starts_with("sha256:") {
            hash.to_owned()
        } else {
            format!("sha256:{hash}")
        }
    })
}

fn stage_keys(stages: &[Value], status: &str) -> Vec<String> {
    stages
        .iter()
        .filter(|stage| stage.get("status").and_then(Value::as_str) == Some(status))
        .filter_map(|stage| stage.get("stageKey").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

fn string_or_empty(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn task_state(status: &str) -> &'static str {
    match status {
        "preparing" => "planned",
        "action_required" => "awaiting_approval",
        "queued" => "planned",
        "running" => "running",
        "recovering" => "recovering",
        "canceling" => "paused",
        "completed" | "completed_with_warnings" => "completed",
        "canceled" => "cancelled",
        "failed" => "failed",
        _ => "paused",
    }
}

#[cfg(test)]
mod tests {
    use super::from_run;
    use serde_json::json;

    #[test]
    fn projects_run_lifecycle_without_private_artifact_paths() {
        let run = json!({
            "id": "run_1",
            "projectId": "project_1",
            "specRevisionId": "revision_1",
            "title": "Product Film",
            "status": "running",
            "createdAt": 10,
            "updatedAt": 20,
            "stages": [
                { "stageKey": "shot:a:keyframe", "status": "succeeded", "taskId": "job_1", "artifact": { "sha256": "abc", "storeRelpath": "C:\\secret" } },
                { "stageKey": "shot:a:motion", "status": "running", "taskId": "job_2" }
            ]
        });
        let projected = from_run(
            &run,
            Some(&json!({ "id": "runtime_1", "status": "working" })),
        );
        assert_eq!(projected["state"], "running");
        assert_eq!(projected["jobIds"], json!(["job_1", "job_2"]));
        assert_eq!(projected["artifactIds"], json!(["sha256:abc"]));
        assert_eq!(projected["checkpoint"]["activeStageKey"], "shot:a:motion");
        assert!(projected.to_string().contains("artifactIds"));
        assert!(!projected.to_string().contains("storeRelpath"));
    }
}

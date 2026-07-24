use flovart_lib::runtime::ProductionRuntime;
use rusqlite::Connection;
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
        .join(format!("flovart-runtime-ledger-{}", Uuid::now_v7()))
        .join("state.db")
}

fn envelope(command: &str, args: Value, idempotency_key: Option<&str>) -> Value {
    let mut envelope = json!({
        "protocolVersion": "1",
        "commandId": ProductionRuntime::new_id("cmd"),
        "command": command,
        "args": args,
        "actor": { "kind": "cli", "instanceId": "cli_runtime_ledger_test" }
    });
    if let Some(key) = idempotency_key {
        envelope["idempotencyKey"] = json!(key);
    }
    envelope
}

#[test]
fn accepted_delay_task_is_durable_before_the_receipt_is_returned() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");

    let receipt = {
        let runtime =
            ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime");
        runtime
            .execute(&envelope(
                "runtime.test.delay",
                json!({ "delayMs": 500 }),
                Some("durable-delay"),
            ))
            .expect("task receipt")
    };

    assert_eq!(receipt["kind"], "task");
    assert_eq!(receipt["status"], "queued");
    let task_id = receipt["taskId"].as_str().expect("task id");

    let restarted =
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("restart");
    let task = restarted
        .execute(&envelope("task.get", json!({ "taskId": task_id }), None))
        .expect("durable task");

    assert_eq!(task["id"], task_id);
    assert!(matches!(
        task["status"].as_str(),
        Some("queued" | "working" | "completed")
    ));

    drop(restarted);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn delay_submission_is_idempotent_per_actor_and_rejects_payload_drift() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime");
    let first = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 100 }),
            Some("same-delay"),
        ))
        .expect("first receipt");
    let replay = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 100 }),
            Some("same-delay"),
        ))
        .expect("replayed receipt");

    assert_eq!(replay, first);
    let conflict = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 101 }),
            Some("same-delay"),
        ))
        .expect_err("payload conflict");
    assert_eq!(conflict.code, "IDEMPOTENCY_CONFLICT");
}

#[test]
fn event_stream_resumes_strictly_after_the_last_seen_event_id() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime");
    let receipt = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 30 }),
            Some("event-resume"),
        ))
        .expect("receipt");
    let task_id = receipt["taskId"].as_str().expect("task id");
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let task = runtime
            .execute(&envelope("task.get", json!({ "taskId": task_id }), None))
            .expect("task");
        if task["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < deadline, "task did not complete: {task}");
        thread::sleep(Duration::from_millis(10));
    }

    let first_page = runtime
        .execute(&envelope(
            "event.stream",
            json!({ "afterEventId": 0, "taskId": task_id }),
            None,
        ))
        .expect("events");
    let events = first_page["events"].as_array().expect("event page");
    assert!(
        events.len() >= 3,
        "expected queued, working, completed: {first_page}"
    );
    let first_event_id = events[0]["eventId"].as_i64().expect("event id");

    let resumed = runtime
        .execute(&envelope(
            "event.stream",
            json!({ "afterEventId": first_event_id, "taskId": task_id }),
            None,
        ))
        .expect("resumed events");
    let resumed_events = resumed["events"].as_array().expect("resumed page");
    assert_eq!(resumed_events.len(), events.len() - 1);
    assert!(resumed_events
        .iter()
        .all(|event| event["eventId"].as_i64().expect("event id") > first_event_id));
}

#[test]
fn task_list_uses_a_stable_cursor_and_survives_runtime_restart() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    {
        let runtime =
            ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime");
        for key in ["list-first", "list-second"] {
            runtime
                .execute(&envelope(
                    "runtime.test.delay",
                    json!({ "delayMs": 500 }),
                    Some(key),
                ))
                .expect("receipt");
        }
    }

    let restarted =
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("restart");
    let first_page = restarted
        .execute(&envelope("task.list", json!({ "limit": 1 }), None))
        .expect("first task page");
    let first_tasks = first_page["tasks"].as_array().expect("tasks");
    assert_eq!(first_tasks.len(), 1);
    let cursor = first_page["nextCursor"].as_str().expect("next cursor");

    let second_page = restarted
        .execute(&envelope(
            "task.list",
            json!({ "limit": 1, "cursor": cursor }),
            None,
        ))
        .expect("second task page");
    let second_tasks = second_page["tasks"].as_array().expect("tasks");
    assert_eq!(second_tasks.len(), 1);
    assert_ne!(first_tasks[0]["id"], second_tasks[0]["id"]);

    drop(restarted);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn a_busy_ledger_never_returns_an_accepted_receipt() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let runtime =
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime");
    let blocker = Connection::open(&database_path).expect("blocking connection");
    blocker
        .execute_batch("BEGIN IMMEDIATE")
        .expect("hold write lock");

    let error = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 10 }),
            Some("busy-delay"),
        ))
        .expect_err("busy ledger must reject submission");
    assert_eq!(error.code, "RUNTIME_UNAVAILABLE");
    assert!(error.retryable);

    blocker.execute_batch("ROLLBACK").expect("release lock");
    let tasks = runtime
        .execute(&envelope("task.list", json!({}), None))
        .expect("task list");
    assert_eq!(tasks["tasks"], json!([]));

    drop(runtime);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

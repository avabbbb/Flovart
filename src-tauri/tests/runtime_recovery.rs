use flovart_lib::runtime::ProductionRuntime;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

fn envelope(command: &str, args: Value, idempotency_key: Option<&str>) -> Value {
    let mut envelope = json!({
        "protocolVersion": "1",
        "commandId": ProductionRuntime::new_id("cmd"),
        "command": command,
        "args": args,
        "actor": { "kind": "cli", "instanceId": "cli_runtime_recovery_test" }
    });
    if let Some(key) = idempotency_key {
        envelope["idempotencyKey"] = json!(key);
    }
    envelope
}

fn get_task(runtime: &ProductionRuntime, task_id: &str) -> Value {
    runtime
        .execute(&envelope("task.get", json!({ "taskId": task_id }), None))
        .expect("task")
}

fn test_database_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("flovart-runtime-recovery-{}", Uuid::now_v7()))
        .join("state.db")
}

#[test]
fn delay_worker_completes_a_durable_task_without_a_client_connection() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime");
    let receipt = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 50 }),
            Some("worker-completes"),
        ))
        .expect("receipt");
    let task_id = receipt["taskId"].as_str().expect("task id");
    let deadline = Instant::now() + Duration::from_secs(2);

    let completed = loop {
        let task = get_task(&runtime, task_id);
        if task["status"] == "completed" {
            break task;
        }
        assert!(Instant::now() < deadline, "task did not complete: {task}");
        thread::sleep(Duration::from_millis(10));
    };

    assert_eq!(completed["result"], json!({ "delayedMs": 50 }));
    assert!(completed["leaseOwner"].is_null());
    assert!(completed["leaseExpiresAt"].is_null());
}

#[test]
fn a_restarted_runtime_reclaims_a_task_only_after_its_lease_expires() {
    let database_path = test_database_path();
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let (task_id, first_lease_owner, first_lease_expiry) = {
        let runtime =
            ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime");
        let receipt = runtime
            .execute(&envelope(
                "runtime.test.delay",
                json!({ "delayMs": 200 }),
                Some("recover-delay"),
            ))
            .expect("receipt");
        let task_id = receipt["taskId"].as_str().expect("task id").to_owned();
        let deadline = Instant::now() + Duration::from_secs(1);
        let working = loop {
            let task = get_task(&runtime, &task_id);
            if task["status"] == "working" {
                break task;
            }
            assert!(Instant::now() < deadline, "task was never claimed: {task}");
            thread::sleep(Duration::from_millis(10));
        };
        (
            task_id,
            working["leaseOwner"]
                .as_str()
                .expect("lease owner")
                .to_owned(),
            working["leaseExpiresAt"].as_i64().expect("lease expiry"),
        )
    };

    let restarted =
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("restart");
    let before_expiry = get_task(&restarted, &task_id);
    assert_eq!(before_expiry["status"], "working");
    assert_eq!(before_expiry["leaseOwner"], first_lease_owner);
    assert_eq!(before_expiry["leaseExpiresAt"], first_lease_expiry);

    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let task = get_task(&restarted, &task_id);
        if task["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < deadline, "task was not recovered: {task}");
        thread::sleep(Duration::from_millis(20));
    }

    drop(restarted);
    let _ = fs::remove_dir_all(database_path.parent().expect("database parent"));
}

#[test]
fn cancellation_is_persisted_and_honored_at_the_next_worker_safe_point() {
    let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime");
    let receipt = runtime
        .execute(&envelope(
            "runtime.test.delay",
            json!({ "delayMs": 2_000 }),
            Some("cancel-delay"),
        ))
        .expect("receipt");
    let task_id = receipt["taskId"].as_str().expect("task id");
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let task = get_task(&runtime, task_id);
        if task["status"] == "working" {
            break;
        }
        assert!(Instant::now() < deadline, "task was never claimed: {task}");
        thread::sleep(Duration::from_millis(10));
    }

    let requested = runtime
        .execute(&envelope(
            "task.cancel",
            json!({ "taskId": task_id, "reason": "test requested" }),
            Some("cancel-request"),
        ))
        .expect("cancel request");
    assert_eq!(requested["status"], "working");
    assert!(requested["cancelRequestedAt"].as_i64().is_some());

    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        let task = get_task(&runtime, task_id);
        if task["status"] == "cancelled" {
            assert!(task["leaseOwner"].is_null());
            assert!(task["leaseExpiresAt"].is_null());
            break;
        }
        assert!(Instant::now() < deadline, "task was not cancelled: {task}");
        thread::sleep(Duration::from_millis(10));
    }
}

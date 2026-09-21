use flovart_lib::runtime::{ControlServer, ProductionRuntime};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

fn test_discovery_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("flovart-runtime-test-{}", Uuid::now_v7()))
        .join("control-v1.json")
}

#[test]
fn native_host_status_matches_the_same_production_runtime() {
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime"));
    let server = ControlServer::start(runtime.clone(), discovery_path.clone()).expect("server");
    let request = serde_json::to_vec(&serde_json::json!({
        "command": "runtime.status",
        "args": {}
    }))
    .expect("native request");
    let mut input = Vec::with_capacity(request.len() + 4);
    input.extend_from_slice(&(request.len() as u32).to_le_bytes());
    input.extend_from_slice(&request);
    let mut child = Command::new(env!("CARGO_BIN_EXE_flovart-host"))
        .env("FLOVART_RUNTIME_DISCOVERY", &discovery_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn Native Host");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(&input)
        .expect("write native request");
    let output = child.wait_with_output().expect("native response");

    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let length = u32::from_le_bytes(output.stdout[..4].try_into().expect("length")) as usize;
    let status: Value = serde_json::from_slice(&output.stdout[4..4 + length]).expect("status");
    assert_eq!(
        status,
        serde_json::to_value(runtime.status()).expect("runtime status")
    );

    drop(server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
}

fn raw_text_request(port: u16, request: &str) -> (u16, String, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect control server");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("read timeout");
    stream.write_all(request.as_bytes()).expect("write request");
    let mut response = String::new();
    stream.read_to_string(&mut response).expect("read response");
    let (head, body) = response.split_once("\r\n\r\n").expect("HTTP response");
    let status = head
        .split_whitespace()
        .nth(1)
        .expect("status code")
        .parse()
        .expect("numeric status");
    (status, head.to_owned(), body.to_owned())
}


fn raw_bytes_request(port: u16, request: &str) -> (u16, String, Vec<u8>) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect control server");
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("read timeout");
    stream.write_all(request.as_bytes()).expect("write request");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).expect("read response");
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("HTTP response split");
    let head = String::from_utf8_lossy(&response[..split]).into_owned();
    let status = head
        .split_whitespace()
        .nth(1)
        .expect("status code")
        .parse()
        .expect("numeric status");
    (status, head, response[split + 4..].to_vec())
}
fn raw_request(port: u16, request: &str) -> (u16, String, Value) {
    let (status, head, body) = raw_text_request(port, request);
    (
        status,
        head,
        serde_json::from_str(&body).expect("JSON response"),
    )
}

fn request(port: u16, authorization: Option<&str>) -> (u16, Value) {
    let authorization = authorization
        .map(|value| format!("Authorization: Bearer {value}\r\n"))
        .unwrap_or_default();
    let (status, _, body) = raw_request(
        port,
        &format!(
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{authorization}Connection: close\r\n\r\n"
        ),
    );
    (status, body)
}

#[test]
fn control_server_requires_its_startup_token_for_status() {
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime"));
    let server = ControlServer::start(runtime.clone(), discovery_path.clone()).expect("server");
    let discovery: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("discovery record"))
            .expect("discovery JSON");
    let port = discovery["port"].as_u64().expect("port") as u16;
    let token = discovery["token"].as_str().expect("token").to_owned();

    assert_ne!(port, 7421);
    assert_eq!(token.len(), 64);
    assert_eq!(discovery["pid"], std::process::id());
    assert_eq!(
        discovery["runtimeInstanceId"],
        runtime.status().runtime_instance_id
    );
    assert_eq!(discovery["registryHash"], runtime.status().registry_hash);
    assert_eq!(request(port, None).0, 401);
    assert_eq!(request(port, Some("wrong-token")).0, 401);
    let malformed = raw_request(
        port,
        &format!(
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Basic {token}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(malformed.0, 401);

    let (status_code, status) = request(port, Some(&token));
    assert_eq!(status_code, 200);
    assert_eq!(
        status,
        serde_json::to_value(runtime.status()).expect("status")
    );

    drop(server);
    assert!(!discovery_path.exists());

    let restarted_runtime =
        Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("restarted runtime"));
    let restarted_server =
        ControlServer::start(restarted_runtime, discovery_path.clone()).expect("restarted server");
    let restarted: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("restarted discovery"))
            .expect("restarted discovery JSON");
    assert_ne!(restarted["token"], token);
    drop(restarted_server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
}

#[test]
fn control_server_exposes_only_authenticated_non_browser_runtime_commands() {
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime"));
    let server = ControlServer::start(runtime.clone(), discovery_path.clone()).expect("server");
    let discovery: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("discovery record"))
            .expect("discovery JSON");
    let port = discovery["port"].as_u64().expect("port") as u16;
    let token = discovery["token"].as_str().expect("token");
    let envelope = serde_json::json!({
        "protocolVersion": "1",
        "commandId": "cmd_http_test",
        "command": "runtime.status",
        "args": {},
        "actor": { "kind": "cli", "instanceId": "cli_test" }
    });
    let body = serde_json::to_string(&envelope).expect("envelope");
    let (status, headers, output) = raw_request(
        port,
        &format!(
            "POST /v1/commands HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );
    assert_eq!(status, 200);
    assert_eq!(
        output,
        serde_json::to_value(runtime.status()).expect("status")
    );
    assert!(!headers
        .to_ascii_lowercase()
        .contains("access-control-allow-origin"));

    let (browser_status, browser_headers, browser_output) = raw_request(
        port,
        &format!(
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nOrigin: http://localhost:5173\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(browser_status, 403);
    assert_eq!(browser_output["error"]["code"], "PERMISSION_DENIED");
    assert!(!browser_headers
        .to_ascii_lowercase()
        .contains("access-control-allow-origin"));

    drop(server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
}

#[test]
fn control_server_reads_tasks_and_resumes_sse_from_the_same_runtime_ledger() {
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime"));
    let server = ControlServer::start(runtime, discovery_path.clone()).expect("server");
    let discovery: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("discovery record"))
            .expect("discovery JSON");
    let port = discovery["port"].as_u64().expect("port") as u16;
    let token = discovery["token"].as_str().expect("token");
    let envelope = serde_json::json!({
        "protocolVersion": "1",
        "commandId": "cmd_http_delay",
        "command": "runtime.test.delay",
        "args": { "delayMs": 500 },
        "actor": { "kind": "cli", "instanceId": "cli_http_test" },
        "idempotencyKey": "http-delay"
    });
    let body = serde_json::to_string(&envelope).expect("envelope");
    let (_, _, receipt) = raw_request(
        port,
        &format!(
            "POST /v1/commands HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );
    let task_id = receipt["taskId"].as_str().expect("task id");

    let (task_status, _, task) = raw_request(
        port,
        &format!(
            "GET /v1/tasks/{task_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(task_status, 200);
    assert_eq!(task["id"], task_id);

    let (event_status, event_headers, event_body) = raw_text_request(
        port,
        &format!(
            "GET /v1/events?taskId={task_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nLast-Event-ID: 0\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(event_status, 200);
    assert!(event_headers
        .to_ascii_lowercase()
        .contains("content-type: text/event-stream"));
    assert!(event_body.contains("event: task.queued"), "{event_body}");
    assert!(event_body.contains("id: 1"), "{event_body}");

    drop(server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
}

#[test]
fn control_server_rejects_secrets_from_agent_text_requests() {
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(ProductionRuntime::new(env!("CARGO_PKG_VERSION")).expect("runtime"));
    let server = ControlServer::start(runtime, discovery_path.clone()).expect("server");
    let discovery: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("discovery record"))
            .expect("discovery JSON");
    let port = discovery["port"].as_u64().expect("port") as u16;
    let token = discovery["token"].as_str().expect("token");
    let body = serde_json::json!({
        "messages": [],
        "tools": [],
        "apiKey": "must-never-cross-the-agent-runtime-boundary"
    })
    .to_string();
    let (status, _, output) = raw_request(
        port,
        &format!(
            "POST /v1/agent-text/stream HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );

    assert_eq!(status, 400);
    assert_eq!(output["error"]["code"], "INVALID_ARGUMENT");
    assert!(!output.to_string().contains("must-never-cross"));

    drop(server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
}

fn http_json(port: u16, token: &str, method: &str, path: &str, body: Option<&str>) -> (u16, Value) {
    let body = body.unwrap_or_default();
    let (status, _, payload) = raw_request(
        port,
        &format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    );
    (status, payload)
}

/// A host panel or CLI can submit a generation task, poll its status, and
/// download the finished artifact entirely over the loopback Control API —
/// no Browser Workflow, no Tauri WebUI, no injected `__FLOVART_*` callbacks.
#[test]
fn panel_can_submit_poll_and_download_an_artifact_without_a_browser() {
    let database_path = test_discovery_path()
        .parent()
        .expect("discovery parent")
        .join("state.db");
    fs::create_dir_all(database_path.parent().expect("database parent"))
        .expect("create database directory");
    let discovery_path = test_discovery_path();
    let runtime = Arc::new(
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime"),
    );
    let server = ControlServer::start(runtime.clone(), discovery_path.clone()).expect("server");
    let discovery: Value =
        serde_json::from_slice(&fs::read(&discovery_path).expect("discovery record"))
            .expect("discovery JSON");
    let port = discovery["port"].as_u64().expect("port") as u16;
    let token = discovery["token"].as_str().expect("token").to_owned();

    // 1. Submit a task the same way a panel would: one POST, get a taskId.
    let envelope = json!({
        "protocolVersion": "1",
        "commandId": ProductionRuntime::new_id("cmd"),
        "command": "runtime.test.delay",
        "args": { "delayMs": 10 },
        "actor": { "kind": "panel", "instanceId": "ae-panel-1" },
        "idempotencyKey": "panel-direct-submit-1"
    });
    let (submit_status, receipt) = http_json(
        port,
        &token,
        "POST",
        "/v1/commands",
        Some(&envelope.to_string()),
    );
    assert_eq!(submit_status, 200, "submit failed: {receipt}");
    let task_id = receipt["taskId"].as_str().expect("taskId").to_owned();
    assert_eq!(receipt["status"], "queued");

    // Same idempotency key + same payload replays to the same task (panel
    // re-open must not double-submit).
    let (replay_status, replay) = http_json(
        port,
        &token,
        "POST",
        "/v1/commands",
        Some(&envelope.to_string()),
    );
    assert_eq!(replay_status, 200);
    assert_eq!(replay["taskId"], task_id);

    // A real generate.* envelope submitted by the panel actor lands in the
    // same ledger as a task row — the same task function the CLI uses.
    // (No provider credentials exist in the test DB, so the worker will fail
    // it downstream; the submit→taskId→ledger contract is what is proven.)
    let generate_envelope = json!({
        "protocolVersion": "1",
        "commandId": ProductionRuntime::new_id("cmd"),
        "command": "generate.image",
        "args": { "prompt": "panel direct submission proof" },
        "actor": { "kind": "panel", "instanceId": "ae-panel-1" },
        "idempotencyKey": "panel-direct-generate-1"
    });
    let (generate_status, generate_receipt) = http_json(
        port,
        &token,
        "POST",
        "/v1/commands",
        Some(&generate_envelope.to_string()),
    );
    assert_eq!(generate_status, 200, "generate submit failed: {generate_receipt}");
    let generate_task_id = generate_receipt["taskId"]
        .as_str()
        .expect("generate taskId")
        .to_owned();
    assert_eq!(generate_receipt["status"], "queued");
    let (_, generate_task) = http_json(
        port,
        &token,
        "GET",
        &format!("/v1/tasks/{generate_task_id}"),
        None,
    );
    assert_eq!(generate_task["kind"], "generate.image");
    assert_eq!(generate_task["commandId"], generate_envelope["commandId"]);

    // 2. Poll task status until the worker finishes.
    let deadline = Instant::now() + Duration::from_secs(5);
    let task = loop {
        let (status, task) = http_json(
            port,
            &token,
            "GET",
            &format!("/v1/tasks/{task_id}"),
            None,
        );
        assert_eq!(status, 200);
        if task["status"] == "completed" {
            break task;
        }
        assert!(Instant::now() < deadline, "task did not complete: {task}");
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(task["result"]["delayedMs"], 10);

    // 3. Materialize a finished artifact the way the worker would have
    //    (persisted file + artifact metadata in result_json).
    let artifact_bytes = b"\x89PNG\r\n\x1a\npanel-direct-artifact".to_vec();
    let images_dir = database_path
        .parent()
        .expect("db parent")
        .join("runtime-artifacts")
        .join("images");
    fs::create_dir_all(&images_dir).expect("create images dir");
    fs::write(images_dir.join(format!("{task_id}.png")), &artifact_bytes)
        .expect("write artifact file");
    let connection = Connection::open(&database_path).expect("open db");
    connection
        .execute(
            "UPDATE runtime_tasks SET result_json = ?1 WHERE id = ?2",
            params![
                json!({
                    "delayedMs": 10,
                    "artifact": {
                        "kind": "image",
                        "mimeType": "image/png",
                        "storeRelpath": format!("runtime-artifacts/images/{task_id}.png"),
                        "sha256": "b".repeat(64),
                        "byteSize": artifact_bytes.len()
                    }
                })
                .to_string(),
                task_id
            ],
        )
        .expect("seed artifact result");
    drop(connection);

    // 4. Panel downloads the artifact bytes over HTTP.
    let (status, headers, body) = raw_bytes_request(
        port,
        &format!(
            "GET /v1/artifacts/{task_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(status, 200, "artifact download failed: {body:?}");
    assert!(
        headers.to_ascii_lowercase().contains("content-type: image/png"),
        "missing artifact content type: {headers}"
    );
    assert_eq!(body, artifact_bytes);

    // 5. Unknown or artifact-less tasks return a structured error, not bytes.
    let (missing_status, missing) = http_json(
        port,
        &token,
        "GET",
        "/v1/artifacts/task_does_not_exist",
        None,
    );
    assert_eq!(missing_status, 404);
    assert_eq!(missing["error"]["code"], "TASK_NOT_FOUND");

    // 6. Browser origins stay rejected even on the artifact route.
    let (origin_status, _, _) = raw_request(
        port,
        &format!(
            "GET /v1/artifacts/{task_id} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nOrigin: http://localhost:5173\r\nConnection: close\r\n\r\n"
        ),
    );
    assert_eq!(origin_status, 403);

    drop(server);
    let _ = fs::remove_dir_all(discovery_path.parent().expect("parent"));
    let _ = fs::remove_dir_all(database_path.parent().expect("parent"));
}

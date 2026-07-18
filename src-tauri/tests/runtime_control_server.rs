use flovart_lib::runtime::{ControlServer, ProductionRuntime};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
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

fn raw_request(port: u16, request: &str) -> (u16, String, Value) {
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
    (
        status,
        head.to_owned(),
        serde_json::from_str(body).expect("JSON response"),
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

use base64::{engine::general_purpose::STANDARD, Engine as _};
use flovart_lib::runtime::{ControlServer, ProductionRuntime};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Arc,
};
use uuid::Uuid;

const EXTENSION_ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";

fn test_root() -> PathBuf {
    std::env::temp_dir().join(format!("flovart-browser-native-test-{}", Uuid::now_v7()))
}

fn send(stdin: &mut ChildStdin, value: &Value) {
    let bytes = serde_json::to_vec(value).expect("native frame");
    stdin
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .expect("native frame length");
    stdin.write_all(&bytes).expect("native frame body");
    stdin.flush().expect("flush native frame");
}

fn receive(stdout: &mut ChildStdout) -> Value {
    let mut length = [0_u8; 4];
    stdout.read_exact(&mut length).expect("response length");
    let mut bytes = vec![0_u8; u32::from_le_bytes(length) as usize];
    stdout.read_exact(&mut bytes).expect("response body");
    serde_json::from_slice(&bytes).expect("response JSON")
}

fn spawn_host(discovery_path: &PathBuf) -> (Child, ChildStdin, ChildStdout) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_flovart-host"))
        .env("FLOVART_RUNTIME_DISCOVERY", discovery_path)
        .env("FLOVART_NATIVE_CALLER_ORIGIN", EXTENSION_ORIGIN)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn native host");
    let stdin = child.stdin.take().expect("host stdin");
    let stdout = child.stdout.take().expect("host stdout");
    (child, stdin, stdout)
}

#[test]
fn native_host_keeps_the_port_open_and_streams_an_image_into_the_desktop_store() {
    let root = test_root();
    fs::create_dir_all(&root).expect("test root");
    let database_path = root.join("flovart-state.db");
    let discovery_path = root.join("runtime").join("control-v1.json");
    let runtime = Arc::new(
        ProductionRuntime::open(env!("CARGO_PKG_VERSION"), &database_path).expect("runtime"),
    );
    let server = ControlServer::start(runtime.clone(), discovery_path.clone()).expect("server");
    runtime
        .browser_imports()
        .request_pairing(EXTENSION_ORIGIN, "1", &["browser.import.image".to_owned()])
        .expect("pairing request");
    runtime
        .browser_imports()
        .approve_pairing(EXTENSION_ORIGIN)
        .expect("approve pairing");
    runtime
        .browser_imports()
        .set_active_project(Some("workflow-native"))
        .expect("active project");

    let (child, mut stdin, mut stdout) = spawn_host(&discovery_path);
    send(
        &mut stdin,
        &json!({
            "requestId": "hello-1",
            "type": "bridge.hello",
            "protocolVersion": "1",
            "capabilities": ["browser.import.image"]
        }),
    );
    let hello = receive(&mut stdout);
    assert_eq!(hello["requestId"], "hello-1");
    assert_eq!(hello["ok"], true);
    assert_eq!(hello["result"]["status"], "approved");

    let bytes = b"\x89PNG\r\n\x1a\nnative host image bytes";
    let sha256 = hex::encode(Sha256::digest(bytes));
    send(
        &mut stdin,
        &json!({
            "requestId": "begin-1",
            "type": "import.begin",
            "payload": {
                "requestId": "browser-action-1",
                "kind": "image",
                "name": "native.png",
                "mimeType": "image/png",
                "byteSize": bytes.len(),
                "sha256": sha256,
                "sourceUrl": "https://cdn.example.com/native.png",
                "sourcePageUrl": "https://example.com/",
                "sourceTitle": "Example",
                "naturalWidth": 640,
                "naturalHeight": 360
            }
        }),
    );
    let begin = receive(&mut stdout);
    assert_eq!(begin["ok"], true, "{begin}");
    let transfer_id = begin["result"]["transferId"].as_str().expect("transfer id");

    send(
        &mut stdin,
        &json!({
            "requestId": "chunk-1",
            "type": "import.chunk",
            "transferId": transfer_id,
            "sequence": 0,
            "dataBase64": STANDARD.encode(bytes)
        }),
    );
    let chunk = receive(&mut stdout);
    assert_eq!(chunk["ok"], true, "{chunk}");
    assert_eq!(chunk["result"]["nextSequence"], 1);

    send(
        &mut stdin,
        &json!({
            "requestId": "commit-1",
            "type": "import.commit",
            "transferId": transfer_id
        }),
    );
    let commit = receive(&mut stdout);
    assert_eq!(commit["ok"], true, "{commit}");
    assert_eq!(commit["result"]["destinationProjectId"], "workflow-native");
    let import_id = commit["result"]["importId"].as_str().expect("import id");
    assert_eq!(
        runtime
            .browser_imports()
            .read_artifact(import_id)
            .expect("stored artifact"),
        bytes
    );

    send(
        &mut stdin,
        &json!({
            "requestId": "hello-2",
            "type": "bridge.hello",
            "protocolVersion": "1",
            "capabilities": ["browser.import.image"]
        }),
    );
    assert_eq!(receive(&mut stdout)["requestId"], "hello-2");

    drop(stdin);
    let output = child.wait_with_output().expect("host exit");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    drop(server);
    drop(runtime);
    fs::remove_dir_all(&root).expect("remove test root");
}

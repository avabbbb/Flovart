//! Chrome / Edge Native Messaging adapter for Flovart Desktop.
//! It accepts a narrow typed protocol, keeps stdin/stdout open for chunked imports,
//! and authenticates every local Control API request with the startup discovery token.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use flovart_lib::runtime::{
    default_discovery_path, BrowserImportBegin, DiscoveryRecord, ProductionRuntime,
    BROWSER_IMPORT_CHUNK_BYTES,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{ErrorKind, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

const MAX_MESSAGE_BYTES: usize = 512 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_millis(2_000);
const DESKTOP_START_TIMEOUT: Duration = Duration::from_secs(10);
const PAIRING_TIMEOUT: Duration = Duration::from_secs(30);
static EXPECTED_RUNTIME_CONTRACT: OnceLock<Result<(String, String), String>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostRequest {
    envelope: Option<Value>,
    command: Option<String>,
    args: Option<Value>,
    actor: Option<Value>,
}

impl HostRequest {
    fn into_envelope(self) -> Result<Value, Value> {
        let envelope = match (self.envelope, self.command) {
            (Some(envelope), None) if self.args.is_none() && self.actor.is_none() => envelope,
            (None, Some(command)) => json!({
                "protocolVersion": "1",
                "commandId": ProductionRuntime::new_id("cmd"),
                "command": command,
                "args": self.args.unwrap_or_else(|| json!({})),
                "actor": self.actor.unwrap_or_else(|| json!({
                    "kind": "native_host",
                    "instanceId": format!("native_host_{}", std::process::id()),
                })),
            }),
            _ => {
                return Err(error(
                    "INVALID_ARGUMENT",
                    "Expected either envelope or command, but not both.",
                ))
            }
        };
        if envelope
            .get("actor")
            .and_then(|actor| actor.get("kind"))
            .and_then(Value::as_str)
            != Some("native_host")
        {
            return Err(error(
                "PERMISSION_DENIED",
                "Native Host commands must use the native_host actor.",
            ));
        }
        Ok(envelope)
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum BridgeRequest {
    #[serde(rename = "bridge.hello", rename_all = "camelCase")]
    Hello {
        request_id: String,
        protocol_version: String,
        capabilities: Vec<String>,
    },
    #[serde(rename = "import.begin", rename_all = "camelCase")]
    ImportBegin {
        request_id: String,
        payload: BrowserImportBegin,
    },
    #[serde(rename = "import.chunk", rename_all = "camelCase")]
    ImportChunk {
        request_id: String,
        transfer_id: String,
        sequence: u32,
        data_base64: String,
    },
    #[serde(rename = "import.commit", rename_all = "camelCase")]
    ImportCommit {
        request_id: String,
        transfer_id: String,
    },
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    loop {
        let mut length = [0_u8; 4];
        match input.read_exact(&mut length) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::UnexpectedEof => return,
            Err(error) => {
                eprintln!("read native message length: {error}");
                return;
            }
        }
        let length = u32::from_le_bytes(length) as usize;
        if length == 0 || length > MAX_MESSAGE_BYTES {
            write_response(
                &mut output,
                &error("INVALID_ARGUMENT", "Native message size is invalid."),
            );
            return;
        }
        let mut body = vec![0_u8; length];
        if let Err(read_error) = input.read_exact(&mut body) {
            write_response(
                &mut output,
                &runtime_unavailable(format!("Could not read the native message: {read_error}")),
            );
            return;
        }
        let value: Value = match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(parse_error) => {
                write_response(
                    &mut output,
                    &error_value("INVALID_ARGUMENT", parse_error.to_string()),
                );
                continue;
            }
        };
        let response = if value.get("type").is_some() {
            match serde_json::from_value::<BridgeRequest>(value) {
                Ok(request) => execute_bridge(request),
                Err(parse_error) => bridge_failure(
                    value_request_id(&body),
                    error_value("INVALID_ARGUMENT", parse_error.to_string()),
                ),
            }
        } else {
            match serde_json::from_value::<HostRequest>(value) {
                Ok(request) => match request.into_envelope() {
                    Ok(envelope) => execute_command(envelope),
                    Err(failure) => failure,
                },
                Err(parse_error) => error_value("INVALID_ARGUMENT", parse_error.to_string()),
            }
        };
        write_response(&mut output, &response);
    }
}

fn value_request_id(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("requestId")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

fn execute_bridge(request: BridgeRequest) -> Value {
    let request_id = match &request {
        BridgeRequest::Hello { request_id, .. }
        | BridgeRequest::ImportBegin { request_id, .. }
        | BridgeRequest::ImportChunk { request_id, .. }
        | BridgeRequest::ImportCommit { request_id, .. } => request_id.clone(),
    };
    if request_id.trim().is_empty() || request_id.len() > 128 {
        return bridge_failure(
            request_id,
            error("INVALID_ARGUMENT", "Bridge request ID is invalid."),
        );
    }
    let origin = match caller_origin() {
        Ok(origin) => origin,
        Err(failure) => return bridge_failure(request_id, failure),
    };
    let discovery = match discover_runtime() {
        Ok(discovery) => discovery,
        Err(failure) => return bridge_failure(request_id, failure),
    };
    let result = match request {
        BridgeRequest::Hello {
            protocol_version,
            capabilities,
            ..
        } => wait_for_pairing(&discovery, &origin, &protocol_version, &capabilities),
        BridgeRequest::ImportBegin { payload, .. } => forward_json(
            &discovery,
            "POST",
            "/v1/browser-imports:begin",
            &json!({ "extensionOrigin": origin, "payload": payload }),
        ),
        BridgeRequest::ImportChunk {
            transfer_id,
            sequence,
            data_base64,
            ..
        } => {
            if !valid_transfer_id(&transfer_id) {
                error("INVALID_ARGUMENT", "Browser import transfer ID is invalid.")
            } else {
                match STANDARD.decode(data_base64.as_bytes()) {
                    Ok(bytes) if !bytes.is_empty() && bytes.len() <= BROWSER_IMPORT_CHUNK_BYTES => {
                        forward_binary(
                            &discovery,
                            &format!("/v1/browser-imports/{transfer_id}/chunks"),
                            &[
                                ("X-Flovart-Extension-Origin", origin.as_str()),
                                ("X-Flovart-Chunk-Sequence", &sequence.to_string()),
                            ],
                            &bytes,
                        )
                    }
                    Ok(_) => error("INVALID_ARGUMENT", "Decoded import chunk size is invalid."),
                    Err(_) => error("INVALID_ARGUMENT", "Import chunk is not valid Base64."),
                }
            }
        }
        BridgeRequest::ImportCommit { transfer_id, .. } => {
            if !valid_transfer_id(&transfer_id) {
                error("INVALID_ARGUMENT", "Browser import transfer ID is invalid.")
            } else {
                forward_json(
                    &discovery,
                    "POST",
                    &format!("/v1/browser-imports/{transfer_id}:commit"),
                    &json!({ "extensionOrigin": origin }),
                )
            }
        }
    };
    if result.get("error").is_some() {
        bridge_failure(request_id, result)
    } else {
        json!({ "requestId": request_id, "ok": true, "result": result })
    }
}

fn caller_origin() -> Result<String, Value> {
    let origin = std::env::var("FLOVART_NATIVE_CALLER_ORIGIN")
        .ok()
        .or_else(|| std::env::args().nth(1))
        .unwrap_or_default();
    if !valid_extension_origin(&origin) {
        return Err(error(
            "PERMISSION_DENIED",
            "Native caller is not an exact Chromium extension origin.",
        ));
    }
    Ok(origin)
}

fn valid_extension_origin(origin: &str) -> bool {
    origin
        .strip_prefix("chrome-extension://")
        .and_then(|value| value.strip_suffix('/'))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| (b'a'..=b'p').contains(&byte)))
}

fn valid_transfer_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn wait_for_pairing(
    discovery: &DiscoveryRecord,
    origin: &str,
    protocol_version: &str,
    capabilities: &[String],
) -> Value {
    let started = Instant::now();
    loop {
        let result = forward_json(
            discovery,
            "POST",
            "/v1/browser-bridge/pairings",
            &json!({
                "extensionOrigin": origin,
                "protocolVersion": protocol_version,
                "capabilities": capabilities,
            }),
        );
        match result.get("status").and_then(Value::as_str) {
            Some("approved") | Some("rejected") => return result,
            Some("pending") if started.elapsed() < PAIRING_TIMEOUT => {
                thread::sleep(Duration::from_millis(250));
            }
            Some("pending") => {
                return error_value_retryable(
                    "PAIRING_REQUIRED",
                    "Approve this extension in Flovart Desktop, then retry.",
                    true,
                )
            }
            _ => return result,
        }
    }
}

fn execute_command(envelope: Value) -> Value {
    let discovery = match discover_runtime() {
        Ok(discovery) => discovery,
        Err(failure) => return failure,
    };
    forward_json(&discovery, "POST", "/v1/commands", &envelope)
}

fn discover_runtime() -> Result<DiscoveryRecord, Value> {
    let path = default_discovery_path().map_err(|error| runtime_unavailable(error.to_string()))?;
    if let Ok(discovery) = load_discovery(&path) {
        if runtime_reachable(&discovery) {
            return Ok(discovery);
        }
    }
    wake_desktop()?;
    let started = Instant::now();
    while started.elapsed() < DESKTOP_START_TIMEOUT {
        if let Ok(discovery) = load_discovery(&path) {
            if runtime_reachable(&discovery) {
                return Ok(discovery);
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err(runtime_unavailable(
        "Flovart Desktop did not become ready before the bridge timeout.",
    ))
}

fn load_discovery(path: &Path) -> Result<DiscoveryRecord, Value> {
    let bytes = fs::read(path)
        .map_err(|_| runtime_unavailable("Production Runtime discovery record is unavailable."))?;
    let discovery = serde_json::from_slice::<DiscoveryRecord>(&bytes)
        .map_err(|_| runtime_unavailable("Production Runtime discovery record is invalid."))?;
    validate_discovery(&discovery)?;
    Ok(discovery)
}

fn runtime_reachable(discovery: &DiscoveryRecord) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], discovery.port)),
        Duration::from_millis(150),
    )
    .is_ok()
}

fn wake_desktop() -> Result<(), Value> {
    let executable = desktop_executable().ok_or_else(|| {
        runtime_unavailable("Flovart Desktop executable could not be located by the Native Host.")
    })?;
    Command::new(&executable).spawn().map_err(|error| {
        runtime_unavailable(format!(
            "Flovart Desktop could not be started from {}: {error}",
            executable.display()
        ))
    })?;
    Ok(())
}

fn desktop_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("FLOVART_DESKTOP_EXECUTABLE").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    let parent = std::env::current_exe().ok()?.parent()?.to_path_buf();
    ["flovart.exe", "Flovart.exe", "flovart"]
        .into_iter()
        .map(|name| parent.join(name))
        .find(|path| path.is_file())
}

fn validate_discovery(discovery: &DiscoveryRecord) -> Result<(), Value> {
    let (protocol_version, registry_hash) = EXPECTED_RUNTIME_CONTRACT
        .get_or_init(|| {
            let runtime = ProductionRuntime::new(env!("CARGO_PKG_VERSION"))
                .map_err(|error| error.to_string())?;
            Ok((
                runtime.registry().protocol_version.clone(),
                runtime.registry().registry_hash.clone(),
            ))
        })
        .as_ref()
        .map_err(|message| runtime_unavailable(message.clone()))?;
    if discovery.schema_version != "1"
        || discovery.protocol_version != *protocol_version
        || discovery.registry_hash != *registry_hash
    {
        return Err(error(
            "PROTOCOL_MISMATCH",
            "Runtime discovery contract does not match this Native Host.",
        ));
    }
    if discovery.port == 0
        || discovery.token.len() != 64
        || !discovery.token.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(runtime_unavailable("Runtime discovery record is invalid."));
    }
    Ok(())
}

fn forward_json(discovery: &DiscoveryRecord, method: &str, path: &str, payload: &Value) -> Value {
    let body = match serde_json::to_vec(payload) {
        Ok(body) => body,
        Err(serialize_error) => {
            return error_value("INVALID_ARGUMENT", serialize_error.to_string())
        }
    };
    forward_http(
        discovery,
        method,
        path,
        &[(&"Content-Type", "application/json")],
        &body,
    )
}

fn forward_binary(
    discovery: &DiscoveryRecord,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Value {
    let mut all_headers = Vec::with_capacity(headers.len() + 1);
    all_headers.push(("Content-Type", "application/octet-stream"));
    all_headers.extend_from_slice(headers);
    forward_http(discovery, "POST", path, &all_headers, body)
}

fn forward_http(
    discovery: &DiscoveryRecord,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Value {
    let mut stream = match TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], discovery.port)),
        REQUEST_TIMEOUT,
    ) {
        Ok(stream) => stream,
        Err(_) => {
            return runtime_unavailable("Production Runtime is offline or did not respond in time.")
        }
    };
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
    let mut header = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        discovery.port,
        discovery.token,
        body.len()
    );
    for (name, value) in headers {
        header.push_str(name);
        header.push_str(": ");
        header.push_str(value);
        header.push_str("\r\n");
    }
    header.push_str("\r\n");
    if stream.write_all(header.as_bytes()).is_err() || stream.write_all(body).is_err() {
        return runtime_unavailable("Could not send the request to Production Runtime.");
    }
    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return runtime_unavailable("Could not read the Production Runtime response.");
    }
    let Some(index) = response.windows(4).position(|window| window == b"\r\n\r\n") else {
        return runtime_unavailable("Production Runtime returned an invalid HTTP response.");
    };
    serde_json::from_slice(&response[index + 4..])
        .unwrap_or_else(|_| runtime_unavailable("Production Runtime returned invalid JSON."))
}

fn bridge_failure(request_id: String, failure: Value) -> Value {
    let error = failure
        .get("error")
        .cloned()
        .unwrap_or_else(|| runtime_unavailable("Unknown Native Host failure.")["error"].clone());
    json!({ "requestId": request_id, "ok": false, "error": error })
}

fn error(code: &str, message: &str) -> Value {
    error_value(code, message.to_owned())
}

fn error_value(code: &str, message: String) -> Value {
    error_value_retryable(code, message, false)
}

fn error_value_retryable(code: &str, message: impl Into<String>, retryable: bool) -> Value {
    json!({
        "error": {
            "code": code,
            "message": message.into(),
            "retryable": retryable,
            "details": null,
            "actionUrl": null,
        }
    })
}

fn runtime_unavailable(message: impl Into<String>) -> Value {
    error_value_retryable("RUNTIME_UNAVAILABLE", message, true)
}

fn write_response(output: &mut impl Write, payload: &Value) {
    let bytes = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let _ = output.write_all(&(bytes.len() as u32).to_le_bytes());
    let _ = output.write_all(&bytes);
    let _ = output.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_host_accepts_commands_but_not_arbitrary_http_forwarding() {
        let request: HostRequest = serde_json::from_value(json!({
            "command": "runtime.status",
            "args": {}
        }))
        .expect("typed command");
        let envelope = request.into_envelope().expect("command envelope");
        assert_eq!(envelope["command"], "runtime.status");
        assert_eq!(envelope["actor"]["kind"], "native_host");

        let spoofed: HostRequest = serde_json::from_value(json!({
            "envelope": {
                "protocolVersion": "1",
                "commandId": "cmd_spoofed",
                "command": "runtime.status",
                "args": {},
                "actor": { "kind": "ui", "instanceId": "spoofed" }
            }
        }))
        .expect("typed envelope");
        assert_eq!(
            spoofed.into_envelope().expect_err("actor spoofing denied")["error"]["code"],
            "PERMISSION_DENIED"
        );

        assert!(serde_json::from_value::<HostRequest>(json!({
            "method": "GET",
            "path": "/state/keys/provider/key"
        }))
        .is_err());
    }

    #[test]
    fn caller_origin_must_be_an_exact_chromium_extension_id() {
        assert!(valid_extension_origin(
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
        ));
        assert!(!valid_extension_origin("https://example.com/"));
        assert!(!valid_extension_origin(
            "chrome-extension://abcdefghijklmnopabcdefghijklmnop.attacker/"
        ));
    }
}

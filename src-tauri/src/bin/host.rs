//! Chrome / Edge Native Messaging adapter for the local Production Runtime.
//! The host accepts typed commands only, discovers the random loopback port, and
//! authenticates with the per-startup token. It never forwards arbitrary paths.

use flovart_lib::runtime::{default_discovery_path, DiscoveryRecord, ProductionRuntime};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};

const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_millis(1_500);

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

fn main() {
    let mut length = [0u8; 4];
    if let Err(error) = std::io::stdin().read_exact(&mut length) {
        eprintln!("read native message length: {error}");
        std::process::exit(1);
    }
    let length = u32::from_le_bytes(length) as usize;
    if length > MAX_MESSAGE_BYTES {
        write_response(&error("INVALID_ARGUMENT", "Native message is too large."));
        return;
    }
    let mut body = vec![0u8; length];
    if let Err(error) = std::io::stdin().read_exact(&mut body) {
        write_response(&runtime_unavailable(format!(
            "Could not read the native message: {error}"
        )));
        return;
    }
    let request = match serde_json::from_slice::<HostRequest>(&body) {
        Ok(request) => request,
        Err(error) => {
            write_response(&error_value("INVALID_ARGUMENT", error.to_string()));
            return;
        }
    };
    let envelope = match request.into_envelope() {
        Ok(envelope) => envelope,
        Err(error) => {
            write_response(&error);
            return;
        }
    };
    write_response(&execute(envelope));
}

fn execute(envelope: Value) -> Value {
    let path = match default_discovery_path() {
        Ok(path) => path,
        Err(error) => return runtime_unavailable(error.to_string()),
    };
    let discovery = match fs::read(&path)
        .map_err(|_| ())
        .and_then(|bytes| serde_json::from_slice::<DiscoveryRecord>(&bytes).map_err(|_| ()))
    {
        Ok(discovery) => discovery,
        Err(()) => {
            return runtime_unavailable(
                "Production Runtime is not running or its discovery record is unreadable.",
            )
        }
    };
    if let Err(failure) = validate_discovery(&discovery) {
        return failure;
    }
    forward_command(&discovery, &envelope)
}

fn validate_discovery(discovery: &DiscoveryRecord) -> Result<(), Value> {
    let runtime = match ProductionRuntime::new(env!("CARGO_PKG_VERSION")) {
        Ok(runtime) => runtime,
        Err(error) => return Err(runtime_unavailable(error.to_string())),
    };
    if discovery.schema_version != "1"
        || discovery.protocol_version != runtime.registry().protocol_version
        || discovery.registry_hash != runtime.registry().registry_hash
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

fn forward_command(discovery: &DiscoveryRecord, envelope: &Value) -> Value {
    let address = ("127.0.0.1", discovery.port);
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
    let body = match serde_json::to_vec(envelope) {
        Ok(body) => body,
        Err(error) => return error_value("INVALID_ARGUMENT", error.to_string()),
    };
    let header = format!(
        "POST /v1/commands HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        address.0,
        address.1,
        discovery.token,
        body.len()
    );
    if stream.write_all(header.as_bytes()).is_err() || stream.write_all(&body).is_err() {
        return runtime_unavailable("Could not send the command to Production Runtime.");
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

fn error(code: &str, message: &str) -> Value {
    error_value(code, message.to_owned())
}

fn error_value(code: &str, message: String) -> Value {
    json!({
        "error": {
            "code": code,
            "message": message,
            "retryable": false,
            "details": null,
            "actionUrl": null,
        }
    })
}

fn runtime_unavailable(message: impl Into<String>) -> Value {
    json!({
        "error": {
            "code": "RUNTIME_UNAVAILABLE",
            "message": message.into(),
            "retryable": true,
            "details": null,
            "actionUrl": null,
        }
    })
}

fn write_response(payload: &Value) {
    let bytes = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    let _ = handle.write_all(&(bytes.len() as u32).to_le_bytes());
    let _ = handle.write_all(&bytes);
    let _ = handle.flush();
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
}

use serde_json::{json, Value};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::Duration,
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use super::{
    auth::{generate_token, is_authorized},
    discovery::{remove_if_owned, write_discovery, DiscoveryRecord},
    ProductionRuntime, RuntimeContractError, RuntimeError,
};

const MAX_COMMAND_BYTES: usize = 1024 * 1024;

pub struct ControlServer {
    server: Arc<Server>,
    stopping: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    discovery_path: PathBuf,
    runtime_instance_id: String,
}

impl ControlServer {
    pub fn start(
        runtime: Arc<ProductionRuntime>,
        discovery_path: PathBuf,
    ) -> Result<Self, RuntimeContractError> {
        let server = Arc::new(
            Server::http("127.0.0.1:0")
                .map_err(|error| RuntimeContractError::ControlServer(error.to_string()))?,
        );
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| RuntimeContractError::ControlServer("expected TCP listener".to_owned()))?
            .port();
        let token = generate_token()?;
        let record = DiscoveryRecord::new(&runtime, port, token.clone());
        write_discovery(&discovery_path, &record)?;

        let stopping = Arc::new(AtomicBool::new(false));
        let worker_server = server.clone();
        let worker_stopping = stopping.clone();
        let worker = std::thread::spawn(move || {
            while !worker_stopping.load(Ordering::Acquire) {
                match worker_server.recv_timeout(Duration::from_millis(200)) {
                    Ok(Some(request)) => handle_request(request, &runtime, &token),
                    Ok(None) => {}
                    Err(error) => {
                        if !worker_stopping.load(Ordering::Acquire) {
                            log::warn!("Production Runtime control server receive failed: {error}");
                        }
                    }
                }
            }
        });

        Ok(Self {
            server,
            stopping,
            worker: Some(worker),
            discovery_path,
            runtime_instance_id: record.runtime_instance_id,
        })
    }

    pub fn discovery_path(&self) -> &Path {
        &self.discovery_path
    }
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        self.server.unblock();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        remove_if_owned(&self.discovery_path, &self.runtime_instance_id);
    }
}

fn handle_request(mut request: Request, runtime: &ProductionRuntime, token: &str) {
    if request
        .headers()
        .iter()
        .any(|header| header.field.equiv("Origin"))
    {
        respond_error(
            request,
            403,
            RuntimeError::new("PERMISSION_DENIED", "Browser origins are rejected"),
        );
        return;
    }
    let authorization = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .and_then(|header| std::str::from_utf8(header.value.as_bytes()).ok());
    if !is_authorized(authorization, token) {
        respond_error(
            request,
            401,
            RuntimeError::new("PERMISSION_DENIED", "Invalid runtime token"),
        );
        return;
    }

    match (request.method(), request.url()) {
        (&Method::Get, "/v1/status") => respond_json(
            request,
            200,
            serde_json::to_value(runtime.status()).unwrap_or_else(|_| json!({})),
        ),
        (&Method::Post, "/v1/commands") => {
            if request
                .body_length()
                .is_some_and(|length| length > MAX_COMMAND_BYTES)
            {
                respond_error(
                    request,
                    413,
                    RuntimeError::new("INVALID_ARGUMENT", "Command envelope is too large"),
                );
                return;
            }
            let mut body = Vec::new();
            let read = request
                .as_reader()
                .take((MAX_COMMAND_BYTES + 1) as u64)
                .read_to_end(&mut body);
            if read.is_err() || body.len() > MAX_COMMAND_BYTES {
                respond_error(
                    request,
                    413,
                    RuntimeError::new("INVALID_ARGUMENT", "Command envelope is too large"),
                );
                return;
            }
            let envelope: Value = match serde_json::from_slice(&body) {
                Ok(value) => value,
                Err(error) => {
                    respond_error(
                        request,
                        400,
                        RuntimeError::new("INVALID_ARGUMENT", error.to_string()),
                    );
                    return;
                }
            };
            match runtime.execute(&envelope) {
                Ok(output) => respond_json(request, 200, output),
                Err(error) => {
                    let status = match error.code.as_str() {
                        "UNKNOWN_COMMAND" => 404,
                        "PROTOCOL_MISMATCH" => 409,
                        "RUNTIME_UNAVAILABLE" => 503,
                        _ => 400,
                    };
                    respond_error(request, status, error);
                }
            }
        }
        _ => respond_error(
            request,
            404,
            RuntimeError::new("ROUTE_UNAVAILABLE", "Unknown runtime route"),
        ),
    }
}

fn respond_error(request: Request, status: u16, error: RuntimeError) {
    respond_json(request, status, json!({ "error": error }));
}

fn respond_json(request: Request, status: u16, body: Value) {
    let body = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    response.add_header(Header::from_bytes("Content-Type", "application/json").expect("header"));
    response.add_header(Header::from_bytes("Cache-Control", "no-store").expect("header"));
    response.add_header(Header::from_bytes("X-Content-Type-Options", "nosniff").expect("header"));
    let _ = request.respond(response);
}

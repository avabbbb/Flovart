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
use url::Url;

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

fn handle_request(mut request: Request, runtime: &Arc<ProductionRuntime>, token: &str) {
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

    let parsed_url = Url::parse(&format!("http://127.0.0.1{}", request.url())).ok();
    let path = parsed_url
        .as_ref()
        .map(Url::path)
        .unwrap_or_else(|| request.url())
        .to_owned();

    match (request.method(), path.as_str()) {
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
        (&Method::Post, "/v1/agent-text/stream") => {
            let body = match read_json_body(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, 400, error);
                    return;
                }
            };
            let runtime = runtime.clone();
            std::thread::spawn(move || match runtime.open_agent_text_stream(&body) {
                Ok(stream) => respond_agent_text_sse(request, stream),
                Err(error) => respond_runtime_error(request, error),
            });
        }
        (&Method::Get, "/v1/tasks") => {
            let status = query_value(parsed_url.as_ref(), "status");
            let cursor = query_value(parsed_url.as_ref(), "cursor");
            let limit = match query_u32(parsed_url.as_ref(), "limit", 50, 1, 100) {
                Ok(limit) => limit,
                Err(error) => {
                    respond_error(request, 400, error);
                    return;
                }
            };
            match runtime.list_tasks(status.as_deref(), cursor.as_deref(), limit) {
                Ok(page) => respond_json(
                    request,
                    200,
                    serde_json::to_value(page).unwrap_or_else(|_| json!({})),
                ),
                Err(error) => respond_runtime_error(request, error),
            }
        }
        (&Method::Get, path) if path.starts_with("/v1/tasks/") => {
            let task_id = path.trim_start_matches("/v1/tasks/");
            if task_id.is_empty() || task_id.contains('/') {
                respond_error(
                    request,
                    404,
                    RuntimeError::new("ROUTE_UNAVAILABLE", "Unknown runtime route"),
                );
                return;
            }
            match runtime.get_task(task_id) {
                Ok(task) => respond_json(
                    request,
                    200,
                    serde_json::to_value(task).unwrap_or_else(|_| json!({})),
                ),
                Err(error) => respond_runtime_error(request, error),
            }
        }
        (&Method::Post, path) if path.starts_with("/v1/tasks/") && path.ends_with(":cancel") => {
            let task_id = path
                .trim_start_matches("/v1/tasks/")
                .trim_end_matches(":cancel");
            let idempotency_key = header_value(&request, "Idempotency-Key");
            let Some(idempotency_key) = idempotency_key else {
                respond_error(
                    request,
                    400,
                    RuntimeError::new(
                        "INVALID_ARGUMENT",
                        "Task cancellation requires Idempotency-Key",
                    ),
                );
                return;
            };
            let actor_instance_id = header_value(&request, "X-Flovart-Actor-Instance")
                .unwrap_or_else(|| "control_api".to_owned());
            let body = match read_json_body(&mut request) {
                Ok(body) => body,
                Err(error) => {
                    respond_error(request, 400, error);
                    return;
                }
            };
            if body
                .as_object()
                .is_none_or(|body| body.keys().any(|field| field != "reason"))
            {
                respond_error(
                    request,
                    400,
                    RuntimeError::new("INVALID_ARGUMENT", "Invalid cancellation request body"),
                );
                return;
            }
            let reason = match body.get("reason") {
                Some(Value::String(reason)) => Some(reason.as_str()),
                Some(_) => {
                    respond_error(
                        request,
                        400,
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "Cancellation reason must be a string",
                        ),
                    );
                    return;
                }
                None => None,
            };
            match runtime.cancel_task(
                &ProductionRuntime::new_id("cmd"),
                "native_host",
                &actor_instance_id,
                &idempotency_key,
                task_id,
                reason,
            ) {
                Ok(task) => respond_json(
                    request,
                    202,
                    serde_json::to_value(task).unwrap_or_else(|_| json!({})),
                ),
                Err(error) => respond_runtime_error(request, error),
            }
        }
        (&Method::Get, "/v1/events") => {
            let after_event_id = header_value(&request, "Last-Event-ID")
                .or_else(|| query_value(parsed_url.as_ref(), "afterEventId"))
                .map(|value| value.parse::<i64>())
                .transpose();
            let after_event_id = match after_event_id {
                Ok(Some(value)) if value >= 0 => value,
                Ok(None) => 0,
                _ => {
                    respond_error(
                        request,
                        400,
                        RuntimeError::new(
                            "INVALID_ARGUMENT",
                            "Last-Event-ID must be a non-negative integer",
                        ),
                    );
                    return;
                }
            };
            let task_id = query_value(parsed_url.as_ref(), "taskId");
            let limit = match query_u32(parsed_url.as_ref(), "limit", 100, 1, 500) {
                Ok(limit) => limit,
                Err(error) => {
                    respond_error(request, 400, error);
                    return;
                }
            };
            match runtime.stream_events(after_event_id, task_id.as_deref(), limit) {
                Ok(page) => respond_sse(request, &page.events),
                Err(error) => respond_runtime_error(request, error),
            }
        }
        _ => respond_error(
            request,
            404,
            RuntimeError::new("ROUTE_UNAVAILABLE", "Unknown runtime route"),
        ),
    }
}

fn query_value(url: Option<&Url>, name: &str) -> Option<String> {
    url?.query_pairs()
        .find_map(|(key, value)| (key == name).then(|| value.into_owned()))
}

fn query_u32(
    url: Option<&Url>,
    name: &str,
    default: u32,
    minimum: u32,
    maximum: u32,
) -> Result<u32, RuntimeError> {
    let Some(value) = query_value(url, name) else {
        return Ok(default);
    };
    let value = value
        .parse::<u32>()
        .map_err(|_| RuntimeError::new("INVALID_ARGUMENT", format!("{name} must be an integer")))?;
    if !(minimum..=maximum).contains(&value) {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            format!("{name} must be between {minimum} and {maximum}"),
        ));
    }
    Ok(value)
}

fn header_value(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
        .and_then(|header| std::str::from_utf8(header.value.as_bytes()).ok())
        .map(str::to_owned)
}

fn read_json_body(request: &mut Request) -> Result<Value, RuntimeError> {
    if request.body_length().unwrap_or(0) == 0 {
        return Ok(json!({}));
    }
    if request
        .body_length()
        .is_some_and(|length| length > MAX_COMMAND_BYTES)
    {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Request body is too large",
        ));
    }
    let mut body = Vec::new();
    request
        .as_reader()
        .take((MAX_COMMAND_BYTES + 1) as u64)
        .read_to_end(&mut body)
        .map_err(|error| RuntimeError::new("INVALID_ARGUMENT", error.to_string()))?;
    if body.len() > MAX_COMMAND_BYTES {
        return Err(RuntimeError::new(
            "INVALID_ARGUMENT",
            "Request body is too large",
        ));
    }
    serde_json::from_slice(&body)
        .map_err(|error| RuntimeError::new("INVALID_ARGUMENT", error.to_string()))
}

fn respond_runtime_error(request: Request, error: RuntimeError) {
    let status = match error.code.as_str() {
        "TASK_NOT_FOUND" | "UNKNOWN_COMMAND" => 404,
        "IDEMPOTENCY_CONFLICT" | "PROTOCOL_MISMATCH" => 409,
        "RUNTIME_UNAVAILABLE" => 503,
        _ => 400,
    };
    respond_error(request, status, error);
}

fn respond_sse(request: Request, events: &[super::RuntimeEvent]) {
    let mut body = String::from("retry: 250\n\n");
    for event in events {
        body.push_str(&format!(
            "id: {}\nevent: {}\ndata: {}\n\n",
            event.event_id,
            event.event_type,
            serde_json::to_string(event).unwrap_or_else(|_| "{}".to_owned())
        ));
    }
    let mut response = Response::from_string(body).with_status_code(StatusCode(200));
    response.add_header(
        Header::from_bytes("Content-Type", "text/event-stream; charset=utf-8").expect("header"),
    );
    response.add_header(Header::from_bytes("Cache-Control", "no-store").expect("header"));
    response.add_header(Header::from_bytes("X-Accel-Buffering", "no").expect("header"));
    let _ = request.respond(response);
}

fn respond_agent_text_sse(request: Request, stream: super::agent_text::AgentTextStream) {
    let headers = vec![
        Header::from_bytes("Content-Type", "text/event-stream; charset=utf-8").expect("header"),
        Header::from_bytes("Cache-Control", "no-store").expect("header"),
        Header::from_bytes("X-Accel-Buffering", "no").expect("header"),
        Header::from_bytes("X-Content-Type-Options", "nosniff").expect("header"),
    ];
    let response = Response::new(StatusCode(200), headers, stream, None, None);
    let _ = request.respond(response);
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

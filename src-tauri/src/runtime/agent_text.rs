use reqwest::blocking::Response as ProviderResponse;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    io::{self, BufRead, BufReader, Read},
};
use url::Url;

use super::RuntimeError;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTextRoute {
    pub provider: String,
    pub credential_id: String,
    pub model: String,
    pub base_url: String,
    pub protocol: String,
    pub order: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentTextRequest {
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub tools: Vec<Value>,
}

pub struct AgentTextStream {
    source: BufReader<ProviderResponse>,
    pending: VecDeque<u8>,
    provider: String,
    model: String,
    started: bool,
    finished: bool,
}

pub fn parse_request(value: &Value) -> Result<AgentTextRequest, RuntimeError> {
    let request = serde_json::from_value::<AgentTextRequest>(value.clone())
        .map_err(|error| invalid(error.to_string()))?;
    if request.messages.len() > 2_000 {
        return Err(invalid("agent-text accepts at most 2000 messages"));
    }
    if request.tools.len() > 128 {
        return Err(invalid("agent-text accepts at most 128 tools"));
    }
    Ok(request)
}

pub fn validate_routes(args: &Value) -> Result<Vec<AgentTextRoute>, RuntimeError> {
    let object = args
        .as_object()
        .ok_or_else(|| invalid("agent-text.route.sync args must be an object"))?;
    if object.keys().any(|field| field != "routes") {
        return Err(invalid("agent-text.route.sync accepts only routes"));
    }
    let routes = serde_json::from_value::<Vec<AgentTextRoute>>(
        object
            .get("routes")
            .cloned()
            .ok_or_else(|| invalid("agent-text.route.sync requires routes"))?,
    )
    .map_err(|error| invalid(error.to_string()))?;
    if routes.len() > 16 {
        return Err(invalid("agent-text.route.sync accepts at most 16 routes"));
    }
    let mut orders = HashSet::new();
    for route in &routes {
        if [
            route.provider.as_str(),
            route.credential_id.as_str(),
            route.model.as_str(),
            route.base_url.as_str(),
        ]
        .iter()
        .any(|value| value.trim().is_empty())
        {
            return Err(invalid(
                "agent-text routes require non-empty provider, credentialId, model, and baseUrl",
            ));
        }
        if route.protocol != "openai-chat-completions" {
            return Err(invalid(
                "agent-text route protocol must be openai-chat-completions",
            ));
        }
        if !orders.insert(route.order) {
            return Err(invalid("agent-text route order values must be unique"));
        }
        let base_url = Url::parse(&route.base_url)
            .map_err(|_| invalid("agent-text route baseUrl must be an absolute URL"))?;
        let loopback = matches!(base_url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
        if base_url.scheme() != "https" && !(loopback && base_url.scheme() == "http") {
            return Err(invalid(
                "agent-text route baseUrl must use HTTPS or loopback HTTP",
            ));
        }
    }
    let mut routes = routes;
    routes.sort_by_key(|route| route.order);
    Ok(routes)
}

pub fn open_provider_stream(
    route: &AgentTextRoute,
    secret: &str,
    request: &AgentTextRequest,
) -> Result<AgentTextStream, RuntimeError> {
    let endpoint = format!("{}/chat/completions", route.base_url.trim_end_matches('/'));
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(provider_failed)?
        .post(endpoint)
        .bearer_auth(secret)
        .json(&openai_request(route, request))
        .send()
        .map_err(provider_failed)?;
    if !response.status().is_success() {
        return Err(RuntimeError::new(
            "PROVIDER_FAILED",
            format!("agent-text provider returned HTTP {}", response.status()),
        ));
    }
    Ok(AgentTextStream {
        source: BufReader::new(response),
        pending: VecDeque::new(),
        provider: route.provider.clone(),
        model: route.model.clone(),
        started: false,
        finished: false,
    })
}

fn openai_request(route: &AgentTextRoute, request: &AgentTextRequest) -> Value {
    let mut messages = Vec::new();
    if let Some(system_prompt) = request
        .system_prompt
        .as_deref()
        .filter(|prompt| !prompt.trim().is_empty())
    {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }
    messages.extend(request.messages.iter().filter_map(openai_message));
    let tools = request
        .tools
        .iter()
        .filter_map(|tool| {
            Some(json!({
                "type": "function",
                "function": {
                    "name": tool.get("name")?.as_str()?,
                    "description": tool.get("description").and_then(Value::as_str).unwrap_or_default(),
                    "parameters": tool.get("parameters").cloned().unwrap_or_else(|| json!({"type": "object"}))
                }
            }))
        })
        .collect::<Vec<_>>();
    json!({
        "model": route.model,
        "messages": messages,
        "tools": tools,
        "stream": true,
        "stream_options": { "include_usage": true }
    })
}

fn openai_message(message: &Value) -> Option<Value> {
    match message.get("role")?.as_str()? {
        "user" => Some(json!({
            "role": "user",
            "content": openai_user_content(message.get("content")?)
        })),
        "assistant" => {
            let blocks = message.get("content")?.as_array()?;
            let text = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let tool_calls = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("toolCall"))
                .filter_map(|block| {
                    Some(json!({
                        "id": block.get("id")?.as_str()?,
                        "type": "function",
                        "function": {
                            "name": block.get("name")?.as_str()?,
                            "arguments": serde_json::to_string(block.get("arguments")?).ok()?
                        }
                    }))
                })
                .collect::<Vec<_>>();
            Some(json!({
                "role": "assistant",
                "content": text,
                "tool_calls": tool_calls
            }))
        }
        "toolResult" => Some(json!({
            "role": "tool",
            "tool_call_id": message.get("toolCallId")?.as_str()?,
            "content": content_text(message.get("content")?)
        })),
        _ => None,
    }
}

fn openai_user_content(content: &Value) -> Value {
    if content.is_string() {
        return content.clone();
    }
    Value::Array(
        content
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                Some("text") => Some(json!({
                    "type": "text",
                    "text": block.get("text").and_then(Value::as_str).unwrap_or_default()
                })),
                Some("image") => Some(json!({
                    "type": "image_url",
                    "image_url": {
                        "url": format!(
                            "data:{};base64,{}",
                            block.get("mimeType").and_then(Value::as_str).unwrap_or("image/png"),
                            block.get("data").and_then(Value::as_str).unwrap_or_default()
                        )
                    }
                })),
                _ => None,
            })
            .collect(),
    )
}

fn content_text(content: &Value) -> String {
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

impl AgentTextStream {
    fn enqueue(&mut self, event: &str, data: Value) {
        self.pending.extend(
            format!(
                "event: {event}\ndata: {}\n\n",
                serde_json::to_string(&data).unwrap_or_else(|_| "{}".to_owned())
            )
            .bytes(),
        );
    }

    fn fill_pending(&mut self) -> io::Result<()> {
        if !self.started {
            self.started = true;
            self.enqueue(
                "start",
                json!({ "provider": self.provider, "model": self.model }),
            );
            return Ok(());
        }
        loop {
            let mut line = String::new();
            if self.source.read_line(&mut line)? == 0 {
                self.enqueue(
                    "error",
                    json!({ "message": "agent-text provider stream ended before done" }),
                );
                self.finished = true;
                return Ok(());
            }
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                self.enqueue("done", json!({ "finishReason": "stop" }));
                self.finished = true;
                return Ok(());
            }
            let chunk: Value = match serde_json::from_str(data) {
                Ok(chunk) => chunk,
                Err(_) => {
                    self.enqueue(
                        "error",
                        json!({ "message": "agent-text provider returned invalid SSE" }),
                    );
                    self.finished = true;
                    return Ok(());
                }
            };
            if let Some(delta) = chunk
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                self.enqueue("text-delta", json!({ "delta": delta }));
                return Ok(());
            }
            if let Some(reason) = chunk
                .pointer("/choices/0/finish_reason")
                .and_then(Value::as_str)
            {
                let reason = match reason {
                    "length" => "length",
                    "tool_calls" => "toolUse",
                    _ => "stop",
                };
                self.enqueue("done", json!({ "finishReason": reason }));
                self.finished = true;
                return Ok(());
            }
        }
    }
}

impl Read for AgentTextStream {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        while self.pending.is_empty() && !self.finished {
            self.fill_pending()?;
        }
        let length = output.len().min(self.pending.len());
        for slot in output.iter_mut().take(length) {
            *slot = self.pending.pop_front().expect("pending length checked");
        }
        Ok(length)
    }
}

fn invalid(message: impl Into<String>) -> RuntimeError {
    RuntimeError::new("INVALID_ARGUMENT", message)
}

fn provider_failed(error: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::new("PROVIDER_FAILED", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use tiny_http::{Header, Response, Server};

    #[test]
    fn runtime_normalizes_openai_sse_without_putting_the_secret_in_the_body() {
        let server = Server::http("127.0.0.1:0").expect("provider stub");
        let address = server.server_addr().to_ip().expect("TCP provider stub");
        let (sent, received) = mpsc::channel();
        std::thread::spawn(move || {
            let mut request = server.recv().expect("provider request");
            let authorization = request
                .headers()
                .iter()
                .find(|header| header.field.equiv("Authorization"))
                .map(|header| header.value.as_str().to_owned());
            let mut body = String::new();
            request
                .as_reader()
                .read_to_string(&mut body)
                .expect("provider body");
            sent.send((authorization, body)).expect("provider capture");
            let mut response = Response::from_string(concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"制作\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\"计划\"},\"finish_reason\":null}]}\n\n",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                "data: [DONE]\n\n"
            ));
            response.add_header(
                Header::from_bytes("Content-Type", "text/event-stream").expect("header"),
            );
            request.respond(response).expect("provider response");
        });
        let route = AgentTextRoute {
            provider: "openai".to_owned(),
            credential_id: "credential-one".to_owned(),
            model: "gpt-test".to_owned(),
            base_url: format!("http://{address}"),
            protocol: "openai-chat-completions".to_owned(),
            order: 0,
        };
        let request = AgentTextRequest {
            system_prompt: Some("只规划制作任务".to_owned()),
            messages: vec![json!({
                "role": "user",
                "content": "制作一个解释视频",
                "timestamp": 1
            })],
            tools: Vec::new(),
        };

        let mut stream =
            open_provider_stream(&route, "runtime-only-secret", &request).expect("agent stream");
        let mut normalized = String::new();
        stream
            .read_to_string(&mut normalized)
            .expect("normalized stream");
        let (authorization, provider_body) = received.recv().expect("provider capture");

        assert_eq!(authorization.as_deref(), Some("Bearer runtime-only-secret"));
        assert!(!provider_body.contains("runtime-only-secret"));
        assert!(provider_body.contains("\"model\":\"gpt-test\""));
        assert!(normalized.contains("event: text-delta"));
        assert!(normalized.contains("\"delta\":\"制作\""));
        assert!(normalized.contains("\"delta\":\"计划\""));
        assert!(normalized.contains("event: done"));
    }
}

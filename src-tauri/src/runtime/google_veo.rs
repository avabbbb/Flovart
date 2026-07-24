use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::time::Duration;

pub const VEO_LITE_MODEL: &str = "veo-3.1-lite-generate-preview";
const DEFAULT_API_ROOT: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Debug)]
pub enum GoogleVeoError {
    SubmissionUnknown,
    ProviderRejected(u16),
    PollFailed(u16),
    InvalidResponse(&'static str),
    DownloadFailed(u16),
    Transport,
}

pub enum PollResult {
    Pending,
    Succeeded { download_url: String },
    Failed,
}

pub struct GoogleVeoClient {
    client: Client,
    api_root: String,
}

impl GoogleVeoClient {
    pub fn new() -> Result<Self, GoogleVeoError> {
        Self::with_api_root(DEFAULT_API_ROOT)
    }

    fn with_api_root(api_root: &str) -> Result<Self, GoogleVeoError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| GoogleVeoError::Transport)?;
        Ok(Self {
            client,
            api_root: api_root.trim_end_matches('/').to_owned(),
        })
    }

    pub fn submit(
        &self,
        secret: &str,
        prompt: &str,
        duration_sec: u64,
        aspect_ratio: &str,
        resolution: &str,
    ) -> Result<String, GoogleVeoError> {
        let response = self
            .client
            .post(format!(
                "{}/models/{}:predictLongRunning",
                self.api_root, VEO_LITE_MODEL
            ))
            .header("x-goog-api-key", secret)
            .json(&submit_body(prompt, duration_sec, aspect_ratio, resolution))
            .send()
            .map_err(|_| GoogleVeoError::SubmissionUnknown)?;
        if !response.status().is_success() {
            return Err(GoogleVeoError::ProviderRejected(response.status().as_u16()));
        }
        response
            .json::<Value>()
            .map_err(|_| GoogleVeoError::InvalidResponse("submit response"))?
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(GoogleVeoError::InvalidResponse("operation name"))
    }

    pub fn poll(&self, secret: &str, operation_name: &str) -> Result<PollResult, GoogleVeoError> {
        let response = self
            .client
            .get(format!(
                "{}/{}",
                self.api_root,
                operation_name.trim_start_matches('/')
            ))
            .header("x-goog-api-key", secret)
            .send()
            .map_err(|_| GoogleVeoError::Transport)?;
        if !response.status().is_success() {
            return Err(GoogleVeoError::PollFailed(response.status().as_u16()));
        }
        parse_poll_response(
            &response
                .json::<Value>()
                .map_err(|_| GoogleVeoError::InvalidResponse("poll response"))?,
        )
    }

    pub fn download(&self, secret: &str, url: &str) -> Result<Vec<u8>, GoogleVeoError> {
        let response = self
            .client
            .get(url)
            .header("x-goog-api-key", secret)
            .send()
            .map_err(|_| GoogleVeoError::Transport)?;
        if !response.status().is_success() {
            return Err(GoogleVeoError::DownloadFailed(response.status().as_u16()));
        }
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|_| GoogleVeoError::Transport)
    }
}

fn submit_body(prompt: &str, duration_sec: u64, aspect_ratio: &str, resolution: &str) -> Value {
    json!({
        "instances": [{ "prompt": prompt }],
        "parameters": {
            "aspectRatio": aspect_ratio,
            "resolution": resolution,
            "durationSeconds": duration_sec.to_string()
        }
    })
}

fn parse_poll_response(value: &Value) -> Result<PollResult, GoogleVeoError> {
    if value.get("done").and_then(Value::as_bool) != Some(true) {
        return Ok(PollResult::Pending);
    }
    if value.get("error").is_some() {
        return Ok(PollResult::Failed);
    }
    value
        .pointer("/response/generateVideoResponse/generatedSamples/0/video/uri")
        .and_then(Value::as_str)
        .map(|url| PollResult::Succeeded {
            download_url: url.to_owned(),
        })
        .ok_or(GoogleVeoError::InvalidResponse("download URI"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submit_payload_uses_only_the_fixed_lite_route() {
        let body = submit_body("paper collage", 8, "16:9", "720p");
        assert_eq!(VEO_LITE_MODEL, "veo-3.1-lite-generate-preview");
        assert_eq!(body["instances"][0]["prompt"], "paper collage");
        assert_eq!(body["parameters"]["durationSeconds"], "8");
        assert_eq!(body["parameters"]["resolution"], "720p");
    }

    #[test]
    fn poll_response_is_closed_over_pending_success_and_failure() {
        assert!(matches!(
            parse_poll_response(&json!({ "name": "operations/1" })).unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll_response(&json!({ "done": true, "error": { "code": 400 } })).unwrap(),
            PollResult::Failed
        ));
        assert!(matches!(
            parse_poll_response(&json!({
                "done": true,
                "response": {
                    "generateVideoResponse": {
                        "generatedSamples": [{ "video": { "uri": "https://example/video" } }]
                    }
                }
            }))
            .unwrap(),
            PollResult::Succeeded { .. }
        ));
    }
}

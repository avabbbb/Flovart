use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const VEO_LITE_ROUTE: &str = "rhart-video-v3.1-lite-official/text-to-video";
const DEFAULT_API_ROOT: &str = "https://www.runninghub.cn/openapi/v2";

#[derive(Debug)]
pub enum RunningHubError {
    PreflightRejected(u16, Option<String>),
    SubmissionUnknown,
    ProviderRejected(u16, Option<String>),
    PollFailed(u16, Option<String>),
    GenerationFailed(Option<String>),
    InvalidResponse(&'static str),
    DownloadFailed(u16),
    Transport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceQuote {
    pub estimated_price: f64,
    pub currency: String,
    pub is_free_this_call: bool,
}

pub enum PollResult {
    Pending,
    Succeeded { download_url: String },
    Failed { code: Option<String> },
}

pub struct RunningHubClient {
    client: Client,
    api_root: String,
}

impl RunningHubClient {
    pub fn new() -> Result<Self, RunningHubError> {
        Self::with_api_root(DEFAULT_API_ROOT)
    }

    fn with_api_root(api_root: &str) -> Result<Self, RunningHubError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|_| RunningHubError::Transport)?;
        Ok(Self {
            client,
            api_root: api_root.trim_end_matches('/').to_owned(),
        })
    }

    pub fn price_preview(
        &self,
        secret: &str,
        prompt: &str,
        duration_sec: u64,
        aspect_ratio: &str,
        resolution: &str,
    ) -> Result<PriceQuote, RunningHubError> {
        let response = self
            .client
            .post(format!(
                "{}/price-preview/{}",
                self.api_root, VEO_LITE_ROUTE
            ))
            .bearer_auth(secret)
            .json(&submit_body(prompt, duration_sec, aspect_ratio, resolution))
            .send()
            .map_err(|_| RunningHubError::Transport)?;
        let status = response.status().as_u16();
        let value = response
            .json::<Value>()
            .map_err(|_| RunningHubError::InvalidResponse("price response"))?;
        let code = response_error_code(&value);
        if !(200..300).contains(&status) || code.is_some() {
            return Err(RunningHubError::PreflightRejected(status, code));
        }
        Ok(PriceQuote {
            estimated_price: value
                .get("estimatedPrice")
                .and_then(Value::as_f64)
                .ok_or(RunningHubError::InvalidResponse("estimated price"))?,
            currency: value
                .get("currency")
                .and_then(Value::as_str)
                .unwrap_or("CNY")
                .to_owned(),
            is_free_this_call: value
                .get("isFreeThisCall")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    pub fn submit(
        &self,
        secret: &str,
        prompt: &str,
        duration_sec: u64,
        aspect_ratio: &str,
        resolution: &str,
    ) -> Result<String, RunningHubError> {
        let response = self
            .client
            .post(format!("{}/{}", self.api_root, VEO_LITE_ROUTE))
            .bearer_auth(secret)
            .json(&submit_body(prompt, duration_sec, aspect_ratio, resolution))
            .send()
            .map_err(|_| RunningHubError::SubmissionUnknown)?;
        let status = response.status().as_u16();
        let value = response
            .json::<Value>()
            .map_err(|_| RunningHubError::InvalidResponse("submit response"))?;
        let code = response_error_code(&value);
        if !(200..300).contains(&status) || code.is_some() {
            return Err(RunningHubError::ProviderRejected(status, code));
        }
        value
            .get("taskId")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or(RunningHubError::InvalidResponse("task ID"))
    }

    pub fn poll(&self, secret: &str, task_id: &str) -> Result<PollResult, RunningHubError> {
        let response = self
            .client
            .post(format!("{}/query", self.api_root))
            .bearer_auth(secret)
            .json(&json!({ "taskId": task_id }))
            .send()
            .map_err(|_| RunningHubError::Transport)?;
        let status = response.status().as_u16();
        let value = response
            .json::<Value>()
            .map_err(|_| RunningHubError::InvalidResponse("poll response"))?;
        let code = response_error_code(&value);
        if !(200..300).contains(&status) {
            return Err(RunningHubError::PollFailed(status, code));
        }
        parse_poll_response(&value)
    }

    pub fn download(&self, url: &str) -> Result<Vec<u8>, RunningHubError> {
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|_| RunningHubError::Transport)?;
        if !response.status().is_success() {
            return Err(RunningHubError::DownloadFailed(response.status().as_u16()));
        }
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(|_| RunningHubError::Transport)
    }
}

fn submit_body(prompt: &str, duration_sec: u64, aspect_ratio: &str, resolution: &str) -> Value {
    json!({
        "prompt": prompt,
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "duration": duration_sec.to_string()
    })
}

fn response_error_code(value: &Value) -> Option<String> {
    value
        .get("errorCode")
        .and_then(|code| {
            code.as_str()
                .map(str::to_owned)
                .or_else(|| code.as_i64().map(|code| code.to_string()))
        })
        .filter(|code| !code.is_empty() && code != "0")
}

fn parse_poll_response(value: &Value) -> Result<PollResult, RunningHubError> {
    let code = response_error_code(value);
    if matches!(code.as_deref(), Some("804" | "813")) {
        return Ok(PollResult::Pending);
    }
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_uppercase();
    match status.as_str() {
        "RUNNING" | "QUEUED" | "PENDING" => Ok(PollResult::Pending),
        "FAILED" | "ERROR" | "CANCELLED" => Ok(PollResult::Failed { code }),
        "SUCCESS" => value
            .get("results")
            .and_then(Value::as_array)
            .and_then(|results| {
                results.iter().find_map(|result| {
                    let url = result.get("url").and_then(Value::as_str)?;
                    let output_type = result
                        .get("outputType")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    (output_type.eq_ignore_ascii_case("mp4")
                        || url.to_ascii_lowercase().contains(".mp4"))
                    .then(|| PollResult::Succeeded {
                        download_url: url.to_owned(),
                    })
                })
            })
            .ok_or(RunningHubError::InvalidResponse("video result")),
        _ if code.is_some() => Err(RunningHubError::GenerationFailed(code)),
        _ => Err(RunningHubError::InvalidResponse("task status")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submit_payload_matches_the_verified_lite_text_to_video_route() {
        let body = submit_body("paper collage", 8, "16:9", "720p");
        assert_eq!(
            VEO_LITE_ROUTE,
            "rhart-video-v3.1-lite-official/text-to-video"
        );
        assert_eq!(body["prompt"], "paper collage");
        assert_eq!(body["duration"], "8");
        assert_eq!(body["aspectRatio"], "16:9");
        assert_eq!(body["resolution"], "720p");
        assert!(body.get("generateAudio").is_none());
    }

    #[test]
    fn poll_response_handles_pending_success_and_business_failures() {
        assert!(matches!(
            parse_poll_response(&json!({ "status": "RUNNING", "results": null })).unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll_response(&json!({ "errorCode": "813" })).unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll_response(&json!({
                "status": "SUCCESS",
                "errorCode": "",
                "results": [{ "url": "https://example/video.mp4", "outputType": "mp4" }]
            }))
            .unwrap(),
            PollResult::Succeeded { .. }
        ));
        assert!(matches!(
            parse_poll_response(&json!({
                "status": "FAILED",
                "errorCode": "416",
                "results": null
            }))
            .unwrap(),
            PollResult::Failed { .. }
        ));
    }
}

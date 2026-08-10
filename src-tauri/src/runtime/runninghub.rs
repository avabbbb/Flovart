use reqwest::blocking::multipart;
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const VEO_LITE_ROUTE: &str = "rhart-video-v3.1-lite-official/text-to-video";
pub const GPT_IMAGE_2_ROUTE: &str = "rhart-image-g-2/text-to-image";
pub const GPT_IMAGE_2_EDIT_ROUTE: &str = "rhart-image-g-2/image-to-image";
pub const GROK_VIDEO_ROUTE: &str = "rhart-video-g/text-to-video";
pub const GROK_VIDEO_IMAGE_ROUTE: &str = "rhart-video-g/image-to-video";
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
    UploadFailed(u16, Option<String>),
    Transport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceQuote {
    pub estimated_price: f64,
    pub currency: String,
    pub is_free_this_call: bool,
}

#[derive(Debug, Clone, Copy)]
pub enum MediaKind {
    Image,
    Video,
}

pub enum PollResult {
    Pending,
    Succeeded {
        download_url: String,
        extension: String,
        mime_type: String,
    },
    Failed {
        code: Option<String>,
    },
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

    pub fn price_preview_route(
        &self,
        secret: &str,
        route_id: &str,
        body: &Value,
    ) -> Result<PriceQuote, RunningHubError> {
        let response = self
            .client
            .post(format!("{}/price-preview/{}", self.api_root, route_id))
            .bearer_auth(secret)
            .json(body)
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

    pub fn submit_route(
        &self,
        secret: &str,
        route_id: &str,
        body: &Value,
    ) -> Result<String, RunningHubError> {
        let response = self
            .client
            .post(format!("{}/{}", self.api_root, route_id))
            .bearer_auth(secret)
            .json(body)
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

    pub fn upload_binary(
        &self,
        secret: &str,
        bytes: Vec<u8>,
        file_name: &str,
        mime_type: &str,
    ) -> Result<String, RunningHubError> {
        let part = multipart::Part::bytes(bytes)
            .file_name(file_name.to_owned())
            .mime_str(mime_type)
            .map_err(|_| RunningHubError::InvalidResponse("upload mime type"))?;
        let response = self
            .client
            .post(format!("{}/media/upload/binary", self.api_root))
            .bearer_auth(secret)
            .multipart(multipart::Form::new().part("file", part))
            .send()
            .map_err(|_| RunningHubError::Transport)?;
        let status = response.status().as_u16();
        let value = response
            .json::<Value>()
            .map_err(|_| RunningHubError::InvalidResponse("upload response"))?;
        let code = value
            .get("code")
            .and_then(|code| {
                code.as_str()
                    .map(str::to_owned)
                    .or_else(|| code.as_i64().map(|code| code.to_string()))
            })
            .filter(|code| code != "0");
        if !(200..300).contains(&status) || code.is_some() {
            return Err(RunningHubError::UploadFailed(status, code));
        }
        let uploaded_url = [
            value.pointer("/data/download_url"),
            value.pointer("/data/fileUrl"),
            value.pointer("/data/url"),
            value.get("download_url"),
            value.get("fileUrl"),
            value.get("url"),
        ]
        .into_iter()
        .flatten()
        .find_map(Value::as_str)
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
        .map(str::to_owned);
        uploaded_url.ok_or(RunningHubError::InvalidResponse("uploaded media URL"))
    }

    pub fn poll_media(
        &self,
        secret: &str,
        task_id: &str,
        media_kind: MediaKind,
    ) -> Result<PollResult, RunningHubError> {
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
        parse_poll_response(&value, media_kind)
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

#[cfg(test)]
fn submit_body(prompt: &str, duration_sec: u64, aspect_ratio: &str, resolution: &str) -> Value {
    json!({
        "prompt": prompt,
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "duration": duration_sec.to_string()
    })
}

pub fn image_to_video_body(
    prompt: &str,
    duration_sec: u64,
    aspect_ratio: &str,
    resolution: &str,
    image_urls: &[String],
) -> Value {
    json!({
        "prompt": prompt,
        "imageUrls": image_urls,
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "duration": duration_sec
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

fn media_descriptor(
    url: &str,
    output_type: &str,
    media_kind: MediaKind,
) -> Option<(String, String)> {
    let normalized_type = output_type.trim().to_ascii_lowercase();
    let normalized_url = url.to_ascii_lowercase();
    match media_kind {
        MediaKind::Video if normalized_type == "mp4" || normalized_url.contains(".mp4") => {
            Some(("mp4".to_owned(), "video/mp4".to_owned()))
        }
        MediaKind::Image => {
            for (extension, mime_type) in [
                ("png", "image/png"),
                ("jpg", "image/jpeg"),
                ("jpeg", "image/jpeg"),
                ("webp", "image/webp"),
            ] {
                if normalized_type == extension || normalized_url.contains(&format!(".{extension}"))
                {
                    return Some((extension.to_owned(), mime_type.to_owned()));
                }
            }
            None
        }
        _ => None,
    }
}

fn parse_poll_response(
    value: &Value,
    media_kind: MediaKind,
) -> Result<PollResult, RunningHubError> {
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
                    let (extension, mime_type) = media_descriptor(url, output_type, media_kind)?;
                    Some(PollResult::Succeeded {
                        download_url: url.to_owned(),
                        extension,
                        mime_type,
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
    fn image_to_video_payload_uses_the_verified_grok_low_price_route() {
        let body = image_to_video_body(
            "subtle layered paper parallax",
            6,
            "16:9",
            "720p",
            &["https://example/keyframe.png".to_owned()],
        );
        assert_eq!(GROK_VIDEO_IMAGE_ROUTE, "rhart-video-g/image-to-video");
        assert_eq!(body["prompt"], "subtle layered paper parallax");
        assert_eq!(body["duration"], 6);
        assert_eq!(body["imageUrls"][0], "https://example/keyframe.png");
    }

    #[test]
    fn poll_response_handles_pending_success_and_business_failures() {
        assert!(matches!(
            parse_poll_response(
                &json!({ "status": "RUNNING", "results": null }),
                MediaKind::Video,
            )
            .unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll_response(&json!({ "errorCode": "813" }), MediaKind::Video).unwrap(),
            PollResult::Pending
        ));
        assert!(matches!(
            parse_poll_response(
                &json!({
                    "status": "SUCCESS",
                    "errorCode": "",
                    "results": [{ "url": "https://example/video.mp4", "outputType": "mp4" }]
                }),
                MediaKind::Video,
            )
            .unwrap(),
            PollResult::Succeeded { .. }
        ));
        assert!(matches!(
            parse_poll_response(
                &json!({
                    "status": "FAILED",
                    "errorCode": "416",
                    "results": null
                }),
                MediaKind::Video,
            )
            .unwrap(),
            PollResult::Failed { .. }
        ));
        assert!(matches!(
            parse_poll_response(
                &json!({
                    "status": "SUCCESS",
                    "results": [{ "url": "https://example/image", "outputType": "png" }]
                }),
                MediaKind::Image,
            )
            .unwrap(),
            PollResult::Succeeded { .. }
        ));
    }
}

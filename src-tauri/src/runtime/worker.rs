use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use super::{
    google_veo::{GoogleVeoClient, GoogleVeoError, PollResult as GooglePollResult, VEO_LITE_MODEL},
    production::compile_production_plan,
    runninghub::{
        image_to_video_body, MediaKind as RunningHubMediaKind, PollResult as RunningHubPollResult,
        RunningHubClient, RunningHubError, GPT_IMAGE_2_ROUTE, GROK_VIDEO_IMAGE_ROUTE,
        GROK_VIDEO_ROUTE, VEO_LITE_ROUTE,
    },
    store::{ClaimedTask, RuntimeStore},
};

const IDLE_POLL: Duration = Duration::from_millis(20);
const SAFE_POINT: Duration = Duration::from_millis(10);
const VIDEO_POLL: Duration = Duration::from_secs(10);
const LEASE_MS: i64 = 500;

pub struct RuntimeWorker {
    stopping: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl RuntimeWorker {
    pub fn start(store: Arc<RuntimeStore>, artifact_root: Option<PathBuf>) -> Self {
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stopping = stopping.clone();
        let worker_id = super::ProductionRuntime::new_id("worker");
        let thread = std::thread::spawn(move || {
            while !worker_stopping.load(Ordering::Acquire) {
                match store.claim_next_task(&worker_id, LEASE_MS) {
                    Ok(Some(task)) => match task.kind.as_str() {
                        "runtime.test.delay" => {
                            run_delay(&store, &worker_id, &worker_stopping, &task)
                        }
                        "production.dry-run" => run_production_plan(&store, &worker_id, &task),
                        "generate.video" => run_video(
                            &store,
                            &worker_id,
                            &worker_stopping,
                            artifact_root.as_deref(),
                            &task,
                        ),
                        "generate.image" => run_runninghub_image(
                            &store,
                            &worker_id,
                            &worker_stopping,
                            artifact_root.as_deref(),
                            &task,
                        ),
                        _ => {
                            let _ = store.fail_task(
                                &task.id,
                                &worker_id,
                                &json!({
                                    "code": "UNKNOWN_COMMAND",
                                    "message": "Runtime worker does not support this task kind.",
                                    "retryable": false
                                }),
                            );
                        }
                    },
                    Ok(None) => std::thread::sleep(IDLE_POLL),
                    Err(error) => {
                        log::warn!("Runtime worker ledger poll failed: {}", error.message);
                        std::thread::sleep(IDLE_POLL);
                    }
                }
            }
        });
        Self {
            stopping,
            thread: Some(thread),
        }
    }
}

fn run_production_plan(store: &RuntimeStore, worker_id: &str, task: &ClaimedTask) {
    match compile_production_plan(&task.args) {
        Ok(draft) => {
            if let Err(error) = store.complete_production_plan(&task.id, worker_id, &draft) {
                let _ = store.fail_task(
                    &task.id,
                    worker_id,
                    &json!({
                        "code": error.code,
                        "message": error.message,
                        "retryable": error.retryable
                    }),
                );
            }
        }
        Err(error) => {
            let _ = store.fail_task(
                &task.id,
                worker_id,
                &json!({
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable
                }),
            );
        }
    }
}

fn run_delay(store: &RuntimeStore, worker_id: &str, stopping: &AtomicBool, task: &ClaimedTask) {
    let delay_ms = task
        .args
        .get("delayMs")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let started = Instant::now();
    let delay = Duration::from_millis(delay_ms);
    let mut last_renewal = Instant::now();
    while started.elapsed() < delay {
        if stopping.load(Ordering::Acquire) {
            return;
        }
        if cancellation_requested(store, task, worker_id) {
            return;
        }
        if last_renewal.elapsed() >= Duration::from_millis(LEASE_MS as u64 / 2) {
            if !store
                .renew_lease(&task.id, worker_id, LEASE_MS)
                .unwrap_or(false)
            {
                return;
            }
            last_renewal = Instant::now();
        }
        std::thread::sleep(SAFE_POINT.min(delay.saturating_sub(started.elapsed())));
    }
    if !stopping.load(Ordering::Acquire) && !cancellation_requested(store, task, worker_id) {
        let _ = store.complete_task(&task.id, worker_id, &json!({ "delayedMs": delay_ms }));
    }
}

fn run_video(
    store: &RuntimeStore,
    worker_id: &str,
    stopping: &AtomicBool,
    artifact_root: Option<&Path>,
    task: &ClaimedTask,
) {
    let Some(artifact_root) = artifact_root else {
        fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Artifact store is unavailable.",
        );
        return;
    };
    match task
        .args
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("google")
    {
        "google" => run_google_video(store, worker_id, stopping, artifact_root, task),
        "runningHub" => run_runninghub_video(store, worker_id, stopping, artifact_root, task),
        _ => fail(
            store,
            task,
            worker_id,
            "ROUTE_UNAVAILABLE",
            "The selected video provider is not available.",
        ),
    }
}

fn run_google_video(
    store: &RuntimeStore,
    worker_id: &str,
    stopping: &AtomicBool,
    artifact_root: &Path,
    task: &ClaimedTask,
) {
    let credential_id = task
        .args
        .get("credentialId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| store.default_credential_id("google").ok().flatten());
    let Some(credential_id) = credential_id else {
        fail(
            store,
            task,
            worker_id,
            "ROUTE_UNAVAILABLE",
            "No Google credential is available in the operating-system keyring.",
        );
        return;
    };
    let secret = match crate::keyring::read_secret("google", &credential_id) {
        Ok(Some(secret)) => secret,
        Ok(None) => {
            fail(
                store,
                task,
                worker_id,
                "ROUTE_UNAVAILABLE",
                "The selected Google credential is not available.",
            );
            return;
        }
        Err(_) => {
            fail(
                store,
                task,
                worker_id,
                "RUNTIME_UNAVAILABLE",
                "The operating-system keyring could not be read.",
            );
            return;
        }
    };
    let client = match GoogleVeoClient::new() {
        Ok(client) => client,
        Err(_) => {
            fail(
                store,
                task,
                worker_id,
                "RUNTIME_UNAVAILABLE",
                "The Google Veo client could not be initialized.",
            );
            return;
        }
    };

    let operation_name = match task
        .progress
        .as_ref()
        .and_then(|progress| progress.get("phase"))
        .and_then(Value::as_str)
    {
        Some("polling") | Some("downloading") => task
            .progress
            .as_ref()
            .and_then(|progress| progress.get("operationName"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        Some("submitting") => {
            require_submission_reconciliation(store, task, worker_id);
            return;
        }
        _ => {
            let submitting = json!({
                "phase": "submitting",
                "provider": "google",
                "model": VEO_LITE_MODEL
            });
            if !store
                .update_progress(&task.id, worker_id, &submitting)
                .unwrap_or(false)
            {
                return;
            }
            let prompt = task
                .args
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let duration_sec = task
                .args
                .get("durationSec")
                .and_then(Value::as_u64)
                .unwrap_or(8);
            let aspect_ratio = task
                .args
                .get("aspectRatio")
                .and_then(Value::as_str)
                .unwrap_or("16:9");
            let resolution = task
                .args
                .get("resolution")
                .and_then(Value::as_str)
                .unwrap_or("720p");
            match client.submit(&secret, prompt, duration_sec, aspect_ratio, resolution) {
                Ok(operation_name) => {
                    let polling = json!({
                        "phase": "polling",
                        "provider": "google",
                        "model": VEO_LITE_MODEL,
                        "operationName": operation_name
                    });
                    if !store
                        .update_progress(&task.id, worker_id, &polling)
                        .unwrap_or(false)
                    {
                        return;
                    }
                    Some(operation_name)
                }
                Err(GoogleVeoError::SubmissionUnknown) => {
                    require_submission_reconciliation(store, task, worker_id);
                    return;
                }
                Err(error) => {
                    fail_google(store, task, worker_id, error);
                    return;
                }
            }
        }
    };
    let Some(operation_name) = operation_name else {
        require_submission_reconciliation(store, task, worker_id);
        return;
    };

    let mut transient_errors = 0_u8;
    loop {
        if stopping.load(Ordering::Acquire) || cancellation_requested(store, task, worker_id) {
            return;
        }
        let _ = store.renew_lease(&task.id, worker_id, LEASE_MS);
        match client.poll(&secret, &operation_name) {
            Ok(GooglePollResult::Pending) => transient_errors = 0,
            Ok(GooglePollResult::Failed) => {
                fail(
                    store,
                    task,
                    worker_id,
                    "PROVIDER_FAILED",
                    "Google Veo reported that the generation failed.",
                );
                return;
            }
            Ok(GooglePollResult::Succeeded { download_url }) => {
                let downloading = json!({
                    "phase": "downloading",
                    "provider": "google",
                    "model": VEO_LITE_MODEL,
                    "operationName": operation_name
                });
                let _ = store.update_progress(&task.id, worker_id, &downloading);
                match client.download(&secret, &download_url).and_then(|bytes| {
                    persist_video(artifact_root, &task.id, &bytes)
                        .map_err(|_| GoogleVeoError::Transport)
                }) {
                    Ok((store_relpath, sha256, byte_size)) => {
                        let duration_sec = task
                            .args
                            .get("durationSec")
                            .and_then(Value::as_u64)
                            .unwrap_or(8);
                        let _ = store.complete_task(
                            &task.id,
                            worker_id,
                            &json!({
                                "provider": "google",
                                "model": VEO_LITE_MODEL,
                                "artifact": {
                                    "kind": "video",
                                    "mimeType": "video/mp4",
                                    "storeRelpath": store_relpath,
                                    "sha256": sha256,
                                    "byteSize": byte_size,
                                    "durationSec": duration_sec
                                }
                            }),
                        );
                    }
                    Err(error) => fail_google(store, task, worker_id, error),
                }
                return;
            }
            Err(GoogleVeoError::Transport) if transient_errors < 12 => {
                transient_errors += 1;
            }
            Err(error) => {
                fail_google(store, task, worker_id, error);
                return;
            }
        }
        let wait_started = Instant::now();
        while wait_started.elapsed() < VIDEO_POLL {
            if stopping.load(Ordering::Acquire) || cancellation_requested(store, task, worker_id) {
                return;
            }
            if !store
                .renew_lease(&task.id, worker_id, LEASE_MS)
                .unwrap_or(false)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
}

struct RunningHubPlan {
    route_id: &'static str,
    product_model: &'static str,
    media_kind: RunningHubMediaKind,
    body: Value,
    artifact_kind: &'static str,
    duration_sec: Option<u64>,
    source_image_task_ids: Vec<String>,
}

fn run_runninghub_image(
    store: &RuntimeStore,
    worker_id: &str,
    stopping: &AtomicBool,
    artifact_root: Option<&Path>,
    task: &ClaimedTask,
) {
    let Some(artifact_root) = artifact_root else {
        fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Artifact store is unavailable.",
        );
        return;
    };
    let prompt = task
        .args
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let aspect_ratio = task
        .args
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or("16:9");
    let resolution = task
        .args
        .get("resolution")
        .and_then(Value::as_str)
        .unwrap_or("1k");
    run_runninghub_generation(
        store,
        worker_id,
        stopping,
        artifact_root,
        task,
        RunningHubPlan {
            route_id: GPT_IMAGE_2_ROUTE,
            product_model: "flovart:gpt-image-2",
            media_kind: RunningHubMediaKind::Image,
            body: json!({
                "prompt": prompt,
                "aspectRatio": aspect_ratio,
                "resolution": resolution
            }),
            artifact_kind: "image",
            duration_sec: None,
            source_image_task_ids: Vec::new(),
        },
    );
}

fn run_runninghub_video(
    store: &RuntimeStore,
    worker_id: &str,
    stopping: &AtomicBool,
    artifact_root: &Path,
    task: &ClaimedTask,
) {
    let prompt = task
        .args
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let duration_sec = task
        .args
        .get("durationSec")
        .and_then(Value::as_u64)
        .unwrap_or(8);
    let aspect_ratio = task
        .args
        .get("aspectRatio")
        .and_then(Value::as_str)
        .unwrap_or("16:9");
    let resolution = task
        .args
        .get("resolution")
        .and_then(Value::as_str)
        .unwrap_or("720p");
    let product_model = task
        .args
        .get("productModel")
        .and_then(Value::as_str)
        .unwrap_or("flovart:veo-3.1-lite");
    let source_image_task_ids = task
        .args
        .get("sourceImageIds")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let plan = match product_model {
        "flovart:grok-imagine-video-1.5" if !source_image_task_ids.is_empty() => RunningHubPlan {
            route_id: GROK_VIDEO_IMAGE_ROUTE,
            product_model: "flovart:grok-imagine-video-1.5",
            media_kind: RunningHubMediaKind::Video,
            body: image_to_video_body(prompt, duration_sec, aspect_ratio, resolution, &[]),
            artifact_kind: "video",
            duration_sec: Some(duration_sec),
            source_image_task_ids,
        },
        "flovart:grok-imagine-video-1.5" => RunningHubPlan {
            route_id: GROK_VIDEO_ROUTE,
            product_model: "flovart:grok-imagine-video-1.5",
            media_kind: RunningHubMediaKind::Video,
            body: json!({
                "prompt": prompt,
                "aspectRatio": aspect_ratio,
                "resolution": resolution,
                "duration": duration_sec
            }),
            artifact_kind: "video",
            duration_sec: Some(duration_sec),
            source_image_task_ids: Vec::new(),
        },
        _ => RunningHubPlan {
            route_id: VEO_LITE_ROUTE,
            product_model: "flovart:veo-3.1-lite",
            media_kind: RunningHubMediaKind::Video,
            body: json!({
                "prompt": prompt,
                "aspectRatio": aspect_ratio,
                "resolution": resolution,
                "duration": duration_sec.to_string()
            }),
            artifact_kind: "video",
            duration_sec: Some(duration_sec),
            source_image_task_ids: Vec::new(),
        },
    };
    run_runninghub_generation(store, worker_id, stopping, artifact_root, task, plan);
}

fn run_runninghub_generation(
    store: &RuntimeStore,
    worker_id: &str,
    stopping: &AtomicBool,
    artifact_root: &Path,
    task: &ClaimedTask,
    mut plan: RunningHubPlan,
) {
    let credential_id = task
        .args
        .get("credentialId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| store.default_credential_id("runningHub").ok().flatten());
    let Some(credential_id) = credential_id else {
        fail(
            store,
            task,
            worker_id,
            "ROUTE_UNAVAILABLE",
            "No RunningHub credential is available in the operating-system keyring.",
        );
        return;
    };
    let secret = match crate::keyring::read_secret("runningHub", &credential_id) {
        Ok(Some(secret)) => secret,
        Ok(None) => {
            fail(
                store,
                task,
                worker_id,
                "ROUTE_UNAVAILABLE",
                "The selected RunningHub credential is not available.",
            );
            return;
        }
        Err(_) => {
            fail(
                store,
                task,
                worker_id,
                "RUNTIME_UNAVAILABLE",
                "The operating-system keyring could not be read.",
            );
            return;
        }
    };
    let client = match RunningHubClient::new() {
        Ok(client) => client,
        Err(_) => {
            fail(
                store,
                task,
                worker_id,
                "RUNTIME_UNAVAILABLE",
                "The RunningHub client could not be initialized.",
            );
            return;
        }
    };
    if !plan.source_image_task_ids.is_empty() {
        let preparing = json!({
            "phase": "preparing_inputs",
            "provider": "runningHub",
            "routeId": plan.route_id,
            "productModel": plan.product_model,
            "sourceImageIds": plan.source_image_task_ids
        });
        if !store
            .update_progress(&task.id, worker_id, &preparing)
            .unwrap_or(false)
        {
            return;
        }
        let mut image_urls = Vec::with_capacity(plan.source_image_task_ids.len());
        for source_task_id in &plan.source_image_task_ids {
            let source_task = match store.get_task(source_task_id) {
                Ok(source_task) => source_task,
                Err(_) => {
                    fail(
                        store,
                        task,
                        worker_id,
                        "SOURCE_ARTIFACT_UNAVAILABLE",
                        &format!("Source image task is unavailable: {source_task_id}"),
                    );
                    return;
                }
            };
            let artifact = source_task
                .result
                .as_ref()
                .and_then(|result| result.get("artifact"));
            let store_relpath = artifact
                .and_then(|artifact| artifact.get("storeRelpath"))
                .and_then(Value::as_str);
            let mime_type = artifact
                .and_then(|artifact| artifact.get("mimeType"))
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            if source_task.status != "completed"
                || artifact
                    .and_then(|artifact| artifact.get("kind"))
                    .and_then(Value::as_str)
                    != Some("image")
                || store_relpath.is_none()
            {
                fail(
                    store,
                    task,
                    worker_id,
                    "SOURCE_ARTIFACT_UNAVAILABLE",
                    &format!("Source task is not a completed image Artifact: {source_task_id}"),
                );
                return;
            }
            let relative = Path::new(store_relpath.unwrap())
                .strip_prefix("runtime-artifacts")
                .unwrap_or_else(|_| Path::new(store_relpath.unwrap()));
            let source_path = artifact_root.join(relative);
            let bytes = match fs::read(&source_path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    fail(
                        store,
                        task,
                        worker_id,
                        "SOURCE_ARTIFACT_UNAVAILABLE",
                        &format!("Source image Artifact cannot be read: {source_task_id}"),
                    );
                    return;
                }
            };
            let extension = source_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("png");
            let file_name = format!("{source_task_id}.{extension}");
            match client.upload_binary(&secret, bytes, &file_name, mime_type) {
                Ok(url) => image_urls.push(url),
                Err(error) => {
                    fail_runninghub(store, task, worker_id, error);
                    return;
                }
            }
        }
        plan.body["imageUrls"] = json!(image_urls);
    }
    let mut price_quote = task
        .progress
        .as_ref()
        .and_then(|progress| progress.get("priceQuote"))
        .cloned();

    let provider_task_id = match task
        .progress
        .as_ref()
        .and_then(|progress| progress.get("phase"))
        .and_then(Value::as_str)
    {
        Some("polling") | Some("downloading") => task
            .progress
            .as_ref()
            .and_then(|progress| progress.get("providerTaskId"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        Some("submitting") => {
            require_submission_reconciliation(store, task, worker_id);
            return;
        }
        _ => {
            let preflight = json!({
                "phase": "preflight",
                "provider": "runningHub",
                "routeId": plan.route_id,
                "productModel": plan.product_model
            });
            if !store
                .update_progress(&task.id, worker_id, &preflight)
                .unwrap_or(false)
            {
                return;
            }
            let quote = match client.price_preview_route(&secret, plan.route_id, &plan.body) {
                Ok(quote) => quote,
                Err(error) => {
                    fail_runninghub(store, task, worker_id, error);
                    return;
                }
            };
            price_quote = serde_json::to_value(&quote).ok();
            if cancellation_requested(store, task, worker_id) {
                return;
            }
            let submitting = json!({
                "phase": "submitting",
                "provider": "runningHub",
                "routeId": plan.route_id,
                "productModel": plan.product_model,
                "priceQuote": price_quote
            });
            if !store
                .update_progress(&task.id, worker_id, &submitting)
                .unwrap_or(false)
            {
                return;
            }
            match client.submit_route(&secret, plan.route_id, &plan.body) {
                Ok(provider_task_id) => {
                    let polling = json!({
                        "phase": "polling",
                        "provider": "runningHub",
                        "routeId": plan.route_id,
                        "productModel": plan.product_model,
                        "providerTaskId": provider_task_id,
                        "priceQuote": price_quote
                    });
                    if !store
                        .update_progress(&task.id, worker_id, &polling)
                        .unwrap_or(false)
                    {
                        return;
                    }
                    Some(provider_task_id)
                }
                Err(RunningHubError::SubmissionUnknown) => {
                    require_submission_reconciliation(store, task, worker_id);
                    return;
                }
                Err(error) => {
                    fail_runninghub(store, task, worker_id, error);
                    return;
                }
            }
        }
    };
    let Some(provider_task_id) = provider_task_id else {
        require_submission_reconciliation(store, task, worker_id);
        return;
    };

    let mut transient_errors = 0_u8;
    loop {
        if stopping.load(Ordering::Acquire) || cancellation_requested(store, task, worker_id) {
            return;
        }
        let _ = store.renew_lease(&task.id, worker_id, LEASE_MS);
        match client.poll_media(&secret, &provider_task_id, plan.media_kind) {
            Ok(RunningHubPollResult::Pending) => transient_errors = 0,
            Ok(RunningHubPollResult::Failed { code }) => {
                fail(
                    store,
                    task,
                    worker_id,
                    "PROVIDER_FAILED",
                    &format!(
                        "RunningHub reported that the generation failed{}.",
                        code.map(|code| format!(" ({code})")).unwrap_or_default()
                    ),
                );
                return;
            }
            Ok(RunningHubPollResult::Succeeded {
                download_url,
                extension,
                mime_type,
            }) => {
                let downloading = json!({
                    "phase": "downloading",
                    "provider": "runningHub",
                    "routeId": plan.route_id,
                    "productModel": plan.product_model,
                    "providerTaskId": provider_task_id,
                    "priceQuote": price_quote
                });
                let _ = store.update_progress(&task.id, worker_id, &downloading);
                match client.download(&download_url).and_then(|bytes| {
                    persist_media(
                        artifact_root,
                        &task.id,
                        plan.artifact_kind,
                        &extension,
                        &bytes,
                    )
                    .map_err(|_| RunningHubError::Transport)
                }) {
                    Ok((store_relpath, sha256, byte_size)) => {
                        let _ = store.complete_task(
                            &task.id,
                            worker_id,
                            &json!({
                                "provider": "runningHub",
                                "productModel": plan.product_model,
                                "routeId": plan.route_id,
                                "providerTaskId": provider_task_id,
                                "priceQuote": price_quote,
                                "artifact": {
                                    "kind": plan.artifact_kind,
                                    "mimeType": mime_type,
                                    "storeRelpath": store_relpath,
                                    "sha256": sha256,
                                    "byteSize": byte_size,
                                    "durationSec": plan.duration_sec
                                }
                            }),
                        );
                    }
                    Err(error) => fail_runninghub(store, task, worker_id, error),
                }
                return;
            }
            Err(RunningHubError::Transport) if transient_errors < 12 => {
                transient_errors += 1;
            }
            Err(error) => {
                fail_runninghub(store, task, worker_id, error);
                return;
            }
        }
        let wait_started = Instant::now();
        while wait_started.elapsed() < VIDEO_POLL {
            if stopping.load(Ordering::Acquire) || cancellation_requested(store, task, worker_id) {
                return;
            }
            if !store
                .renew_lease(&task.id, worker_id, LEASE_MS)
                .unwrap_or(false)
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }
}

fn persist_video(
    artifact_root: &Path,
    task_id: &str,
    bytes: &[u8],
) -> std::io::Result<(String, String, usize)> {
    persist_media(artifact_root, task_id, "video", "mp4", bytes)
}

fn persist_media(
    artifact_root: &Path,
    task_id: &str,
    kind: &str,
    extension: &str,
    bytes: &[u8],
) -> std::io::Result<(String, String, usize)> {
    let directory_name = if kind == "image" { "images" } else { "videos" };
    let directory = artifact_root.join(directory_name);
    fs::create_dir_all(&directory)?;
    let filename = format!("{task_id}.{extension}");
    let final_path = directory.join(&filename);
    let temporary_path = directory.join(format!("{filename}.part"));
    let mut file = File::create(&temporary_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temporary_path, &final_path)?;
    Ok((
        format!("runtime-artifacts/{directory_name}/{filename}"),
        hex::encode(Sha256::digest(bytes)),
        bytes.len(),
    ))
}

fn cancellation_requested(store: &RuntimeStore, task: &ClaimedTask, worker_id: &str) -> bool {
    if store
        .cancellation_requested(&task.id, worker_id)
        .unwrap_or(false)
    {
        let _ = store.cancel_task(&task.id, worker_id);
        true
    } else {
        false
    }
}

fn require_submission_reconciliation(store: &RuntimeStore, task: &ClaimedTask, worker_id: &str) {
    let _ = store.require_input(
        &task.id,
        worker_id,
        &json!({
            "code": "PROVIDER_SUBMISSION_UNKNOWN",
            "message": "The provider submission outcome is unknown; automatic resubmission is disabled.",
            "retryable": false
        }),
    );
}

fn fail(store: &RuntimeStore, task: &ClaimedTask, worker_id: &str, code: &str, message: &str) {
    let _ = store.fail_task(
        &task.id,
        worker_id,
        &json!({
            "code": code,
            "message": message,
            "retryable": false
        }),
    );
}

fn fail_google(store: &RuntimeStore, task: &ClaimedTask, worker_id: &str, error: GoogleVeoError) {
    let (code, message) = match error {
        GoogleVeoError::SubmissionUnknown => (
            "PROVIDER_SUBMISSION_UNKNOWN",
            "The provider submission outcome is unknown.",
        ),
        GoogleVeoError::ProviderRejected(status) => {
            return fail(
                store,
                task,
                worker_id,
                "PROVIDER_REJECTED",
                &format!("Google Veo rejected the request with HTTP {status}."),
            )
        }
        GoogleVeoError::PollFailed(status) => {
            return fail(
                store,
                task,
                worker_id,
                "PROVIDER_POLL_FAILED",
                &format!("Google Veo polling failed with HTTP {status}."),
            )
        }
        GoogleVeoError::DownloadFailed(status) => {
            return fail(
                store,
                task,
                worker_id,
                "ARTIFACT_DOWNLOAD_FAILED",
                &format!("Google Veo artifact download failed with HTTP {status}."),
            )
        }
        GoogleVeoError::InvalidResponse(part) => {
            return fail(
                store,
                task,
                worker_id,
                "PROVIDER_RESPONSE_INVALID",
                &format!("Google Veo returned an invalid {part}."),
            )
        }
        GoogleVeoError::Transport => (
            "PROVIDER_UNAVAILABLE",
            "Google Veo could not be reached or the artifact could not be stored.",
        ),
    };
    fail(store, task, worker_id, code, message);
}

fn fail_runninghub(
    store: &RuntimeStore,
    task: &ClaimedTask,
    worker_id: &str,
    error: RunningHubError,
) {
    let with_code = |base: &str, code: Option<String>| {
        format!(
            "{base}{}.",
            code.map(|code| format!(" ({code})")).unwrap_or_default()
        )
    };
    match error {
        RunningHubError::SubmissionUnknown => {
            require_submission_reconciliation(store, task, worker_id)
        }
        RunningHubError::PreflightRejected(status, code) => fail(
            store,
            task,
            worker_id,
            "PROVIDER_PREFLIGHT_REJECTED",
            &with_code(
                &format!("RunningHub price preview was rejected with HTTP {status}"),
                code,
            ),
        ),
        RunningHubError::ProviderRejected(status, code) => fail(
            store,
            task,
            worker_id,
            "PROVIDER_REJECTED",
            &with_code(
                &format!("RunningHub rejected the request with HTTP {status}"),
                code,
            ),
        ),
        RunningHubError::PollFailed(status, code) => fail(
            store,
            task,
            worker_id,
            "PROVIDER_POLL_FAILED",
            &with_code(
                &format!("RunningHub polling failed with HTTP {status}"),
                code,
            ),
        ),
        RunningHubError::GenerationFailed(code) => fail(
            store,
            task,
            worker_id,
            "PROVIDER_FAILED",
            &with_code("RunningHub reported that the generation failed", code),
        ),
        RunningHubError::InvalidResponse(part) => fail(
            store,
            task,
            worker_id,
            "PROVIDER_RESPONSE_INVALID",
            &format!("RunningHub returned an invalid {part}."),
        ),
        RunningHubError::DownloadFailed(status) => fail(
            store,
            task,
            worker_id,
            "ARTIFACT_DOWNLOAD_FAILED",
            &format!("RunningHub artifact download failed with HTTP {status}."),
        ),
        RunningHubError::UploadFailed(status, code) => fail(
            store,
            task,
            worker_id,
            "SOURCE_UPLOAD_FAILED",
            &with_code(
                &format!("RunningHub source upload was rejected with HTTP {status}"),
                code,
            ),
        ),
        RunningHubError::Transport => fail(
            store,
            task,
            worker_id,
            "PROVIDER_UNAVAILABLE",
            "RunningHub could not be reached or the artifact could not be stored.",
        ),
    }
}

impl Drop for RuntimeWorker {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

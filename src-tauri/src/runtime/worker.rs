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
    runninghub::{
        PollResult as RunningHubPollResult, RunningHubClient, RunningHubError, VEO_LITE_ROUTE,
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
                        "generate.video" => run_video(
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

fn run_runninghub_video(
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
                "routeId": VEO_LITE_ROUTE
            });
            if !store
                .update_progress(&task.id, worker_id, &preflight)
                .unwrap_or(false)
            {
                return;
            }
            let quote =
                match client.price_preview(&secret, prompt, duration_sec, aspect_ratio, resolution)
                {
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
                "routeId": VEO_LITE_ROUTE,
                "priceQuote": price_quote
            });
            if !store
                .update_progress(&task.id, worker_id, &submitting)
                .unwrap_or(false)
            {
                return;
            }
            match client.submit(&secret, prompt, duration_sec, aspect_ratio, resolution) {
                Ok(provider_task_id) => {
                    let polling = json!({
                        "phase": "polling",
                        "provider": "runningHub",
                        "routeId": VEO_LITE_ROUTE,
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
        match client.poll(&secret, &provider_task_id) {
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
            Ok(RunningHubPollResult::Succeeded { download_url }) => {
                let downloading = json!({
                    "phase": "downloading",
                    "provider": "runningHub",
                    "routeId": VEO_LITE_ROUTE,
                    "providerTaskId": provider_task_id,
                    "priceQuote": price_quote
                });
                let _ = store.update_progress(&task.id, worker_id, &downloading);
                match client.download(&download_url).and_then(|bytes| {
                    persist_video(artifact_root, &task.id, &bytes)
                        .map_err(|_| RunningHubError::Transport)
                }) {
                    Ok((store_relpath, sha256, byte_size)) => {
                        let _ = store.complete_task(
                            &task.id,
                            worker_id,
                            &json!({
                                "provider": "runningHub",
                                "routeId": VEO_LITE_ROUTE,
                                "providerTaskId": provider_task_id,
                                "priceQuote": price_quote,
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
    let directory = artifact_root.join("videos");
    fs::create_dir_all(&directory)?;
    let filename = format!("{task_id}.mp4");
    let final_path = directory.join(&filename);
    let temporary_path = directory.join(format!("{filename}.part"));
    let mut file = File::create(&temporary_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(&temporary_path, &final_path)?;
    Ok((
        format!("runtime-artifacts/videos/{filename}"),
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

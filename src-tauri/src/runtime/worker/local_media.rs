//! Local post-production executors: TTS narration, controlled ffmpeg render,
//! and ffprobe delivery verification. These are Runtime Capabilities — every
//! output is a durable Artifact with sha256 provenance, never an ad-hoc file.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use super::fail;
use crate::runtime::store::{ClaimedTask, RuntimeStore};

/// Resolve a completed source task's artifact into an absolute path under the
/// artifact root, mirroring the RunningHub image-to-video source resolution.
fn artifact_path(
    store: &RuntimeStore,
    artifact_root: &Path,
    task_id: &str,
) -> Result<(PathBuf, Value), String> {
    let task = store
        .get_task(task_id)
        .map_err(|error| format!("source task unavailable: {}", error.message))?;
    if task.status != "completed" {
        return Err(format!("source task is not completed: {task_id}"));
    }
    let artifact = task
        .result
        .as_ref()
        .and_then(|result| result.get("artifact"))
        .cloned()
        .ok_or_else(|| format!("source task has no artifact: {task_id}"))?;
    let store_relpath = artifact
        .get("storeRelpath")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("source artifact has no storeRelpath: {task_id}"))?;
    let relative = Path::new(store_relpath)
        .strip_prefix("runtime-artifacts")
        .unwrap_or_else(|_| Path::new(store_relpath));
    Ok((artifact_root.join(relative), artifact))
}

fn persist_artifact(
    artifact_root: &Path,
    directory_name: &str,
    file_name: &str,
    bytes: &[u8],
) -> std::io::Result<(String, String, usize)> {
    let directory = artifact_root.join(directory_name);
    fs::create_dir_all(&directory)?;
    let final_path = directory.join(file_name);
    let temporary_path = directory.join(format!("{file_name}.part"));
    fs::write(&temporary_path, bytes)?;
    fs::rename(&temporary_path, &final_path)?;
    Ok((
        format!("runtime-artifacts/{directory_name}/{file_name}"),
        hex::encode(Sha256::digest(bytes)),
        bytes.len(),
    ))
}

fn run_tool(program: &str, args: &[String]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} could not be started: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .chars()
            .rev()
            .take(600)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(format!("{program} failed: {tail}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn ffprobe_json(path: &Path) -> Result<Value, String> {
    let output = run_tool(
        "ffprobe",
        &[
            "-v".into(),
            "error".into(),
            "-show_format".into(),
            "-show_streams".into(),
            "-of".into(),
            "json".into(),
            path.to_string_lossy().into_owned(),
        ],
    )?;
    serde_json::from_str(&output).map_err(|error| format!("ffprobe returned invalid JSON: {error}"))
}

fn escape_srt_time(ms: i64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    let seconds = (ms % 60_000) / 1_000;
    let millis = ms % 1_000;
    format!("{hours:02}:{minutes:02}:{seconds:02},{millis:03}")
}

/// Escape a path for use inside an ffmpeg filter argument (Windows drive
/// colons and backslashes must be escaped).
fn escape_filter_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
}

/// audio.tts — synthesize narration with the OS speech engine (Windows
/// System.Speech via PowerShell). Input: { lines: [{text, startMs, durationMs}],
/// language, voiceProfile, targetDurationMs }.
pub fn run_tts(
    store: &RuntimeStore,
    worker_id: &str,
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
    if !cfg!(windows) {
        fail(
            store,
            task,
            worker_id,
            "CAPABILITY_UNAVAILABLE",
            "audio.tts currently requires the Windows speech engine.",
        );
        return;
    }
    let lines = task
        .args
        .get("lines")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let text = lines
        .iter()
        .filter_map(|line| line.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        fail(
            store,
            task,
            worker_id,
            "INVALID_ARGUMENT",
            "audio.tts requires narration lines.",
        );
        return;
    }
    let language = task
        .args
        .get("language")
        .and_then(Value::as_str)
        .unwrap_or("zh-CN");
    let target_ms = task
        .args
        .get("targetDurationMs")
        .and_then(Value::as_i64)
        .unwrap_or(60_000);
    let work_dir = artifact_root.join("audio");
    if fs::create_dir_all(&work_dir).is_err() {
        fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Artifact store is not writable.",
        );
        return;
    }
    let text_path = work_dir.join(format!("{}.txt", task.id));
    let wav_path = work_dir.join(format!("{}.wav", task.id));
    if fs::write(&text_path, &text).is_err() {
        fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Narration text could not be staged.",
        );
        return;
    }
    // Rate-search loop: pick the slowest rate that fits the target duration,
    // mirroring the validated evaluation script.
    let script = format!(
        r#"$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $speech.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Culture.Name -eq '{language}' }} | Select-Object -First 1
if (-not $voice) {{ throw 'no {language} voice installed' }}
$speech.SelectVoice($voice.VoiceInfo.Name)
$text = [System.IO.File]::ReadAllText('{text}')
$target = {target_sec}
foreach ($rate in 0..5) {{
  $speech.Rate = $rate
  $speech.SetOutputToWaveFile('{wav}')
  $speech.Speak($text)
  $speech.SetOutputToNull()
  $probe = & ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 '{wav}'
  if ([double]$probe -le $target) {{ Write-Output "rate=$rate duration=$probe"; exit 0 }}
}}
Write-Output "rate=5 duration=$probe overflow=true"
"#,
        language = language,
        text = text_path.to_string_lossy().replace('\'', "''"),
        wav = wav_path.to_string_lossy().replace('\'', "''"),
        target_sec = (target_ms as f64 / 1000.0) - 0.5,
    );
    let result = run_tool(
        "powershell",
        &[
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-Command".into(),
            script,
        ],
    );
    let _ = fs::remove_file(&text_path);
    let synth_info = match result {
        Ok(output) => output.trim().to_owned(),
        Err(error) => {
            fail(store, task, worker_id, "CAPABILITY_UNAVAILABLE", &error);
            return;
        }
    };
    let bytes = match fs::read(&wav_path) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        _ => {
            fail(
                store,
                task,
                worker_id,
                "PROVIDER_FAILED",
                "TTS produced no audio output.",
            );
            return;
        }
    };
    let _ = fs::remove_file(&wav_path);
    let duration_sec = synth_info
        .split_whitespace()
        .find_map(|part| part.strip_prefix("duration="))
        .and_then(|value| value.parse::<f64>().ok());
    match persist_artifact(artifact_root, "audio", &format!("{}.wav", task.id), &bytes) {
        Ok((store_relpath, sha256, byte_size)) => {
            let _ = store.complete_task(
                &task.id,
                worker_id,
                &json!({
                    "provider": "local",
                    "engine": "windows-system-speech",
                    "synthesis": synth_info,
                    "artifact": {
                        "kind": "audio",
                        "mimeType": "audio/wav",
                        "storeRelpath": store_relpath,
                        "sha256": sha256,
                        "byteSize": byte_size,
                        "durationSec": duration_sec
                    }
                }),
            );
        }
        Err(_) => fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "TTS artifact could not be stored.",
        ),
    }
}

/// media.render — controlled ffmpeg concat + subtitles + narration mix.
/// Input: { delivery, timeline: [{shotId, durationMs, sourceTaskId}],
/// narrationTaskId?, captions: [{text, startMs, durationMs}] }.
pub fn run_render(
    store: &RuntimeStore,
    worker_id: &str,
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
    let delivery = task
        .args
        .get("delivery")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let duration_ms = delivery
        .get("durationMs")
        .and_then(Value::as_i64)
        .unwrap_or(30_000);
    let timeline = task
        .args
        .get("timeline")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if timeline.is_empty() {
        fail(
            store,
            task,
            worker_id,
            "INVALID_ARGUMENT",
            "media.render requires a timeline.",
        );
        return;
    }

    // Resolve every shot's video artifact.
    let mut inputs = Vec::new();
    for (index, entry) in timeline.iter().enumerate() {
        let Some(source_task_id) = entry.get("sourceTaskId").and_then(Value::as_str) else {
            fail(
                store,
                task,
                worker_id,
                "SOURCE_ARTIFACT_UNAVAILABLE",
                &format!("timeline[{index}] has no sourceTaskId"),
            );
            return;
        };
        match artifact_path(store, artifact_root, source_task_id) {
            Ok((path, _)) => {
                let shot_ms = entry
                    .get("durationMs")
                    .and_then(Value::as_i64)
                    .unwrap_or(6_000);
                inputs.push((path, shot_ms));
            }
            Err(message) => {
                fail(
                    store,
                    task,
                    worker_id,
                    "SOURCE_ARTIFACT_UNAVAILABLE",
                    &message,
                );
                return;
            }
        }
    }
    let narration = match task.args.get("narrationTaskId").and_then(Value::as_str) {
        Some(narration_task_id) => match artifact_path(store, artifact_root, narration_task_id) {
            Ok((path, _)) => Some(path),
            Err(message) => {
                fail(
                    store,
                    task,
                    worker_id,
                    "SOURCE_ARTIFACT_UNAVAILABLE",
                    &message,
                );
                return;
            }
        },
        None => None,
    };

    let work_dir = artifact_root.join("videos");
    if fs::create_dir_all(&work_dir).is_err() {
        fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Artifact store is not writable.",
        );
        return;
    }

    // Optional hard subtitles from caption lines.
    let captions = task
        .args
        .get("captions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let srt_path = work_dir.join(format!("{}.srt", task.id));
    let mut srt_written = false;
    if !captions.is_empty() {
        let mut srt = String::new();
        for (index, caption) in captions.iter().enumerate() {
            let start = caption.get("startMs").and_then(Value::as_i64).unwrap_or(0);
            let duration = caption
                .get("durationMs")
                .and_then(Value::as_i64)
                .unwrap_or(3_000);
            let text = caption
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            srt.push_str(&format!(
                "{}\n{} --> {}\n{}\n\n",
                index + 1,
                escape_srt_time(start),
                escape_srt_time(start + duration),
                text
            ));
        }
        srt_written = fs::write(&srt_path, srt).is_ok();
    }

    let output_path = work_dir.join(format!("{}.mp4", task.id));
    let target_sec = duration_ms as f64 / 1000.0;
    let mut args: Vec<String> = vec!["-y".into()];
    for (path, _) in &inputs {
        args.push("-i".into());
        args.push(path.to_string_lossy().into_owned());
    }
    if let Some(narration_path) = &narration {
        args.push("-i".into());
        args.push(narration_path.to_string_lossy().into_owned());
    }
    let mut filter = String::new();
    for (index, (_, shot_ms)) in inputs.iter().enumerate() {
        let shot_sec = *shot_ms as f64 / 1000.0;
        filter.push_str(&format!(
            "[{index}:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=24,\
             trim=duration={shot_sec:.3},setpts=PTS-STARTPTS[v{index}];"
        ));
    }
    for index in 0..inputs.len() {
        filter.push_str(&format!("[v{index}]"));
    }
    filter.push_str(&format!("concat=n={}:v=1:a=0[base]", inputs.len()));
    if srt_written {
        filter.push_str(&format!(
            ";[base]subtitles='{}':force_style='FontName=Microsoft YaHei,FontSize=18,\
             PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,\
             Shadow=0,MarginV=32,Alignment=2'[video]",
            escape_filter_path(&srt_path)
        ));
    } else {
        filter.push_str(";[base]null[video]");
    }
    args.push("-filter_complex".into());
    args.push(filter);
    args.push("-map".into());
    args.push("[video]".into());
    if narration.is_some() {
        args.push("-map".into());
        args.push(format!("{}:a:0", inputs.len()));
        args.push("-af".into());
        args.push(format!("apad=pad_dur={target_sec:.3},alimiter=limit=0.95"));
        args.push("-c:a".into());
        args.push("aac".into());
        args.push("-b:a".into());
        args.push("192k".into());
    } else {
        args.push("-an".into());
    }
    args.extend(
        [
            "-t",
            &format!("{target_sec:.3}"),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ]
        .iter()
        .map(|value| value.to_string()),
    );
    args.push(output_path.to_string_lossy().into_owned());

    let render_result = run_tool("ffmpeg", &args);
    let _ = fs::remove_file(&srt_path);
    if let Err(message) = render_result {
        fail(store, task, worker_id, "CAPABILITY_UNAVAILABLE", &message);
        return;
    }
    let bytes = match fs::read(&output_path) {
        Ok(bytes) if !bytes.is_empty() => bytes,
        _ => {
            fail(
                store,
                task,
                worker_id,
                "PROVIDER_FAILED",
                "ffmpeg produced no output file.",
            );
            return;
        }
    };
    let sha256 = hex::encode(Sha256::digest(&bytes));
    let byte_size = bytes.len();
    let store_relpath = format!("runtime-artifacts/videos/{}.mp4", task.id);
    let _ = store.complete_task(
        &task.id,
        worker_id,
        &json!({
            "provider": "local",
            "engine": "ffmpeg",
            "sourceShots": timeline,
            "narrationIncluded": narration.is_some(),
            "captionsBurned": srt_written,
            "artifact": {
                "kind": "video",
                "mimeType": "video/mp4",
                "storeRelpath": store_relpath,
                "sha256": sha256,
                "byteSize": byte_size,
                "durationSec": target_sec
            }
        }),
    );
}

/// media.verify — ffprobe structural verification producing a JSON report
/// Artifact. Input: { delivery, sourceTaskId }.
pub fn run_verify(
    store: &RuntimeStore,
    worker_id: &str,
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
    let Some(source_task_id) = task.args.get("sourceTaskId").and_then(Value::as_str) else {
        fail(
            store,
            task,
            worker_id,
            "INVALID_ARGUMENT",
            "media.verify requires sourceTaskId.",
        );
        return;
    };
    let (source_path, source_artifact) = match artifact_path(store, artifact_root, source_task_id) {
        Ok(resolved) => resolved,
        Err(message) => {
            fail(
                store,
                task,
                worker_id,
                "SOURCE_ARTIFACT_UNAVAILABLE",
                &message,
            );
            return;
        }
    };
    let delivery = task
        .args
        .get("delivery")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let expected_ms = delivery
        .get("durationMs")
        .and_then(Value::as_i64)
        .unwrap_or(30_000);
    let media = match ffprobe_json(&source_path) {
        Ok(media) => media,
        Err(message) => {
            fail(store, task, worker_id, "CAPABILITY_UNAVAILABLE", &message);
            return;
        }
    };
    let duration_sec = media
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let expected_sec = expected_ms as f64 / 1000.0;
    let streams = media
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let video_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"));
    let audio_stream = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"));
    let expects_audio = task
        .args
        .get("expectAudio")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let checks = json!({
        "duration": {
            "passed": (duration_sec - expected_sec).abs() <= 0.5,
            "expectedSec": expected_sec,
            "actualSec": duration_sec
        },
        "video": {
            "passed": video_stream.is_some(),
            "codec": video_stream.and_then(|stream| stream.get("codec_name")).cloned()
        },
        "audio": {
            "passed": !expects_audio || audio_stream.is_some(),
            "codec": audio_stream.and_then(|stream| stream.get("codec_name")).cloned()
        },
        "resolution": {
            "passed": video_stream.is_some_and(|stream| {
                stream.get("width").and_then(Value::as_i64) == Some(1280)
                    && stream.get("height").and_then(Value::as_i64) == Some(720)
            }),
            "width": video_stream.and_then(|stream| stream.get("width")).cloned(),
            "height": video_stream.and_then(|stream| stream.get("height")).cloned()
        }
    });
    let passed = checks.as_object().is_some_and(|object| {
        object
            .values()
            .all(|check| check.get("passed").and_then(Value::as_bool) == Some(true))
    });
    let report = json!({
        "schemaVersion": "flovart.media-verify/1",
        "passed": passed,
        "sourceTaskId": source_task_id,
        "sourceSha256": source_artifact.get("sha256"),
        "checks": checks,
        "media": media
    });
    let report_bytes = match serde_json::to_vec_pretty(&report) {
        Ok(bytes) => bytes,
        Err(_) => {
            fail(
                store,
                task,
                worker_id,
                "RUNTIME_UNAVAILABLE",
                "Verification report could not be serialized.",
            );
            return;
        }
    };
    match persist_artifact(
        artifact_root,
        "reports",
        &format!("{}.verify.json", task.id),
        &report_bytes,
    ) {
        Ok((store_relpath, sha256, byte_size)) => {
            let result = json!({
                "provider": "local",
                "engine": "ffprobe",
                "passed": passed,
                "checks": report["checks"],
                "sourceTaskId": source_task_id,
                "artifact": {
                    "kind": "report",
                    "mimeType": "application/json",
                    "storeRelpath": store_relpath,
                    "sha256": sha256,
                    "byteSize": byte_size
                }
            });
            if passed {
                let _ = store.complete_task(&task.id, worker_id, &result);
            } else {
                let _ = store.fail_task(
                    &task.id,
                    worker_id,
                    &json!({
                        "code": "DELIVERY_VERIFICATION_FAILED",
                        "message": "The rendered delivery did not pass structural verification.",
                        "retryable": false,
                        "details": result
                    }),
                );
            }
        }
        Err(_) => fail(
            store,
            task,
            worker_id,
            "RUNTIME_UNAVAILABLE",
            "Verification report could not be stored.",
        ),
    }
}

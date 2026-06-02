//! flovart:// 自定义协议处理。
//!
//! 支持的 intent：
//! - `flovart://open`                                     打开/聚焦主窗口
//! - `flovart://open?intent=image-reverse-prompt&src=URL` 触发反推提示词
//! - `flovart://open?intent=add-image&href=URL&name=...` 加图片到画布
//! - `flovart://open?intent=run-command&command=...&args=...` 通用入队

use crate::bridge::BridgeEntry;
use crate::errors::{FlovartError, FlovartResult};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

#[derive(Debug, Deserialize)]
struct DeeplinkOpen {
    intent: Option<String>,
    src: Option<String>,
    href: Option<String>,
    name: Option<String>,
    command: Option<String>,
    args: Option<String>,
    blob: Option<String>,
}

pub fn handle_deeplink_url(app: &AppHandle, raw: &str) {
    log::info!("flovart deeplink: {raw}");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }

    // 解析 + 分发
    let parsed = Url::parse(raw);
    let params: std::collections::HashMap<String, String> = match &parsed {
        Ok(u) => u
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect(),
        Err(_) => Default::default(),
    };

    let intent = params.get("intent").cloned().unwrap_or_default();
    let payload = serde_json::json!({
        "url": raw,
        "intent": intent,
        "params": params,
    });

    // 1) 通知 webview（前端负责执行 UI 操作）
    let _ = app.emit("deeplink:received", &payload);

    // 2) 如果带 command 参数，bridge 入队
    if let Some(cmd) = params.get("command") {
        let args_str = params.get("args").cloned().unwrap_or_else(|| "{}".into());
        let args: serde_json::Value = serde_json::from_str(&args_str).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(ctx) = app.try_state::<std::sync::Arc<crate::FlovartContext>>() {
            let entry: BridgeEntry = ctx.bridge_queue.enqueue(
                cmd.clone(),
                args,
                "deeplink".into(),
            );
            let _ = ctx.state_db.sync_log(
                "bridge",
                &entry.id,
                "enqueue",
                "deeplink",
                Some(&serde_json::to_string(&entry).unwrap_or_default()),
            );
            let _ = app.emit("bridge:enqueue", &entry);
        }
    }
}

#[tauri::command]
pub fn deeplink_open_canvas(
    app: AppHandle,
    intent: Option<String>,
    payload: Option<serde_json::Value>,
) -> FlovartResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(
        "deeplink:received",
        &serde_json::json!({
            "intent": intent.unwrap_or_else(|| "open".into()),
            "params": payload.unwrap_or_else(|| serde_json::json!({})),
        }),
    );
    Ok(())
}

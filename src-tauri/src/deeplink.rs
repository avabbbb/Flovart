//! flovart:// 自定义协议处理。
//!
//! 支持的 intent：
//! - `flovart://open`                                     打开/聚焦主窗口
//! - `flovart://open?intent=image-reverse-prompt&src=URL` 触发反推提示词
//! - `flovart://open?intent=add-image&href=URL&name=...` 加图片到画布
//! - `flovart://open?intent=run-command&command=...&args=...` 通用入队

use crate::bridge::BridgeEntry;
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

/// R6-L07: Whitelist of commands allowed from deeplink sources.
/// Only safe, import/open-class commands are permitted to prevent
/// arbitrary command injection via deeplink URLs.
const DEEPLINK_COMMAND_WHITELIST: &[&str] = &[
    "open",
    "show_projects",
    "add-image",
    "import-image",
    "import-video",
    "image-reverse-prompt",
    "run-command",
];

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
    // R6-L07: Only whitelisted commands are enqueued from deeplink.
    if let Some(cmd) = params.get("command") {
        if !DEEPLINK_COMMAND_WHITELIST.contains(&cmd.as_str()) {
            log::warn!("flovart deeplink rejected non-whitelisted command: {cmd}");
            return;
        }
        let args_str = params.get("args").cloned().unwrap_or_else(|| "{}".into());
        let args: serde_json::Value =
            serde_json::from_str(&args_str).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(ctx) = app.try_state::<std::sync::Arc<crate::FlovartContext>>() {
            let entry: BridgeEntry = ctx
                .bridge_queue
                .enqueue(cmd.clone(), args, "deeplink".into());
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

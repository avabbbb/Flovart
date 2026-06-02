//! Flovart Tauri 库入口。
//!
//! 模块划分：
//! - `keyring` : 操作系统 Keyring 包装（API Key 持久化）
//! - `state`   : SQLite 状态库（asset / history / templates / kv）
//! - `bridge`  : 替换 .flovart/command-queue.json 的 IPC 桥
//! - `http`    : 给 Chrome 扩展用的本地 HTTP 服务（127.0.0.1:7421）
//! - `deeplink`: flovart:// 自定义协议
//!
//! 所有 Tauri command 都通过 `commands` 模块统一注册。

pub mod bridge;
pub mod deeplink;
pub mod errors;
pub mod http;
pub mod keyring;
pub mod state;

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::Manager;

use crate::bridge::BridgeQueue;
use crate::http::HttpServerHandle;
use crate::state::StateDb;

/// 跨 command 共享的运行时上下文。
pub struct FlovartContext {
    pub state_db: Arc<StateDb>,
    pub bridge_queue: Arc<BridgeQueue>,
    pub http_server: Mutex<Option<HttpServerHandle>>,
}

impl FlovartContext {
    pub fn new(state_db: Arc<StateDb>, bridge_queue: Arc<BridgeQueue>) -> Self {
        Self {
            state_db,
            bridge_queue,
            http_server: Mutex::new(None),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // 二开实例：把 argv 里的 flovart:// 链接转到已运行实例
            for arg in argv.iter().skip(1) {
                if arg.starts_with("flovart://") {
                    deeplink::handle_deeplink_url(app, arg);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.show();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // ── 1. 初始化 SQLite ──
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("resolve app_data_dir: {e}"))?;
            std::fs::create_dir_all(&app_data_dir).map_err(|e| format!("create app_data_dir: {e}"))?;
            let db_path = app_data_dir.join("flovart-state.db");
            let state_db = Arc::new(
                StateDb::open(&db_path).map_err(|e| format!("open state db: {e}"))?,
            );

            // ── 2. 初始化命令桥队列 ──
            let bridge_queue = Arc::new(BridgeQueue::new());

            // ── 3. 注册 deep link（每个平台不同）──
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("flovart");
            }

            #[cfg(not(any(target_os = "linux", all(debug_assertions, windows))))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link();
            }

            // ── 4. 启动本地 HTTP 服务（给扩展用）──
            let ctx = FlovartContext::new(state_db.clone(), bridge_queue.clone());
            let app_handle = app.handle().clone();
            let ctx_arc = Arc::new(ctx);
            match http::start_http_server(ctx_arc.clone(), app_handle.clone()) {
                Ok(handle) => {
                    log::info!("Flovart local HTTP server listening on 127.0.0.1:7421");
                    *ctx_arc.http_server.lock() = Some(handle);
                }
                Err(err) => {
                    log::warn!("Flovart local HTTP server failed to start: {err}");
                }
            }

            // ── 5. 处理启动时可能携带的 flovart:// 链接 ──
            if let Some(args) = std::env::args().nth(1) {
                if args.starts_with("flovart://") {
                    deeplink::handle_deeplink_url(&app_handle, &args);
                }
            }

            // ── 6. 注册 deep link 事件 ──
            use tauri_plugin_deep_link::DeepLinkExt;
            let app_for_deeplink = app_handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    deeplink::handle_deeplink_url(&app_for_deeplink, url.as_str());
                }
            });

            app.manage(ctx_arc);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // keyring
            keyring::keyring_set,
            keyring::keyring_get,
            keyring::keyring_delete,
            keyring::keyring_list,
            // state
            state::state_set,
            state::state_get,
            state::state_delete,
            state::state_keys,
            state::state_dump,
            // bridge
            bridge::bridge_enqueue,
            bridge::bridge_tick,
            bridge::bridge_complete,
            bridge::bridge_list,
            bridge::bridge_clear,
            // http
            http::http_status,
            // deeplink
            deeplink::deeplink_open_canvas,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flovart");
}

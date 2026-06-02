//! 给 Chrome / Edge 扩展用的本地 HTTP 服务。
//!
//! 监听 `127.0.0.1:7421`（仅本机），CORS 限制到扩展来源，
//! 防止跨站点访问。
//!
//! 路由：
//! - `GET    /status`                            runtime 健康检查
//! - `GET    /state/keys`                        列 API Key 元数据
//! - `GET    /state/keys/:provider/:keyId`       拿单个 key
//! - `POST   /state/keys`                        set 一个 key（带 secret）
//! - `DELETE /state/keys/:provider/:keyId`       删一个 key
//! - `POST   /commands/queue`                    入队一条命令
//! - `POST   /deeplink/open`                     打开 flovart:// 链接
//! - `OPTIONS *`                                 CORS preflight

use crate::bridge::BridgeEntry;
use crate::errors::{FlovartError, FlovartResult};
use crate::keyring::{self, KeyringEntry};
use crate::FlovartContext;
use serde::Deserialize;
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub struct HttpServerHandle {
    pub url: String,
}

const BIND_ADDR: &str = "127.0.0.1:7421";
const ALLOW_METHODS: &str = "GET, POST, DELETE, OPTIONS";
const ALLOW_HEADERS: &str = "Content-Type";

pub fn start_http_server(ctx: Arc<FlovartContext>, app: AppHandle) -> FlovartResult<HttpServerHandle> {
    let server = tiny_http::Server::http(BIND_ADDR)
        .map_err(|e| FlovartError::Http(format!("bind {BIND_ADDR}: {e}")))?;
    let url = format!("http://{BIND_ADDR}");

    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let ctx = ctx.clone();
            let app = app.clone();
            std::thread::spawn(move || handle_request(ctx, app, req));
        }
    });

    Ok(HttpServerHandle { url })
}

fn cors_origin(req: &tiny_http::Request) -> String {
    let origin = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .and_then(|h| std::str::from_utf8(h.value.as_bytes()).ok())
        .unwrap_or("");
    if origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin == "http://localhost:7421"
        || origin == "flovart://app"
        || origin.is_empty()
    {
        origin.to_string()
    } else {
        "null".to_string()
    }
}

fn build_response(
    req: &tiny_http::Request,
    status: u16,
    payload: serde_json::Value,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&payload).unwrap_or_else(|_| b"{}".to_vec());
    let cors = cors_origin(req);
    let mut resp = tiny_http::Response::from_data(body);
    let _ = resp.add_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
    let _ = resp.add_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], cors.as_bytes()).unwrap());
    let _ = resp.add_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Methods"[..], ALLOW_METHODS.as_bytes()).unwrap());
    let _ = resp.add_header(tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], ALLOW_HEADERS.as_bytes()).unwrap());
    let _ = resp.add_header(tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap());
    resp.with_status_code(tiny_http::StatusCode(status))
}

fn handle_request(ctx: Arc<FlovartContext>, app: AppHandle, mut req: tiny_http::Request) {
    if req.method().as_str() == "OPTIONS" {
        let response = build_response(&req, 204, serde_json::json!({}));
        let _ = req.respond(response);
        return;
    }

    let url_path = req.url().to_string();
    let method = req.method().as_str().to_string();
    let path = url_path.split('?').next().unwrap_or("/").to_string();

    let result: FlovartResult<serde_json::Value> = (|| {
        match (method.as_str(), path.as_str()) {
            ("GET", "/status") => Ok(serde_json::json!({
                "ok": true,
                "runtime": "flovart-desktop",
                "version": env!("CARGO_PKG_VERSION"),
            })),

            ("GET", "/state/keys") => {
                let entries = list_keyring_metadata(&ctx)?;
                Ok(serde_json::to_value(entries).unwrap_or(serde_json::json!([])))
            }

            ("POST", "/state/keys") => {
                #[derive(Deserialize)]
                struct Body {
                    provider: String,
                    key_id: String,
                    secret: String,
                    label: Option<String>,
                }
                let mut s = String::new();
                req.as_reader().read_to_string(&mut s).map_err(|e| FlovartError::Io(e.to_string()))?;
                let Body { provider, key_id, secret, label } = serde_json::from_str(&s)
                    .map_err(|e| FlovartError::InvalidInput(e.to_string()))?;
                let entry = keyring_set_via_ctx(&ctx, provider, key_id, secret, label)?;
                Ok(serde_json::to_value(entry).unwrap_or(serde_json::json!({})))
            }

            (m, p) if p.starts_with("/state/keys/") => {
                let rest = &p["/state/keys/".len()..];
                let parts: Vec<&str> = rest.split('/').collect();
                if parts.len() != 2 {
                    return Err(FlovartError::InvalidInput("expected /state/keys/:provider/:keyId".into()));
                }
                let (provider, key_id) = (parts[0], parts[1]);
                match m {
                    "GET" => {
                        let account = keyring::entry_account(provider, key_id);
                        let entry = build_entry_pub(&account)?;
                        match entry.get_password() {
                            Ok(secret) => Ok(serde_json::json!({ "secret": secret })),
                            Err(keyring::Error::NoEntry) => Ok(serde_json::json!({ "secret": null })),
                            Err(e) => Err(FlovartError::Keyring(e.to_string())),
                        }
                    }
                    "DELETE" => {
                        let account = keyring::entry_account(provider, key_id);
                        let entry = build_entry_pub(&account)?;
                        let removed = match entry.delete_credential() {
                            Ok(()) => true,
                            Err(keyring::Error::NoEntry) => false,
                            Err(e) => return Err(FlovartError::Keyring(e.to_string())),
                        };
                        Ok(serde_json::json!({ "removed": removed }))
                    }
                    _ => Err(FlovartError::Other(format!("method not allowed: {m}"))),
                }
            }

            ("POST", "/commands/queue") => {
                #[derive(Deserialize)]
                struct Body {
                    command: String,
                    args: Option<serde_json::Value>,
                    source: Option<String>,
                }
                let mut s = String::new();
                req.as_reader().read_to_string(&mut s).ok();
                let Body { command, args, source } = serde_json::from_str(&s)
                    .map_err(|e| FlovartError::InvalidInput(e.to_string()))?;
                let src = source.unwrap_or_else(|| "extension".into());
                let entry: BridgeEntry = ctx.bridge_queue.enqueue(
                    command,
                    args.unwrap_or_else(|| serde_json::json!({})),
                    src.clone(),
                );
                let _ = ctx.state_db.sync_log(
                    "bridge",
                    &entry.id,
                    "enqueue",
                    &src,
                    Some(&serde_json::to_string(&entry).unwrap_or_default()),
                );
                let _ = app.emit("bridge:enqueue", &entry);
                Ok(serde_json::to_value(&entry).unwrap_or(serde_json::json!({})))
            }

            ("POST", "/deeplink/open") => {
                #[derive(Deserialize)]
                struct Body {
                    url: String,
                }
                let mut s = String::new();
                req.as_reader().read_to_string(&mut s).ok();
                let Body { url } = serde_json::from_str(&s)
                    .map_err(|e| FlovartError::InvalidInput(e.to_string()))?;
                crate::deeplink::handle_deeplink_url(&app, &url);
                Ok(serde_json::json!({ "ok": true, "url": url }))
            }

            _ => Err(FlovartError::Other(format!("no route: {method} {path}"))),
        }
    })();

    let (status, body) = match result {
        Ok(v) => (200u16, v),
        Err(e) => {
            let code = e.code();
            let status = match code {
                "NOT_FOUND" => 404,
                "BAD_REQUEST" => 400,
                _ => 500,
            };
            (status, serde_json::json!({ "ok": false, "code": code, "error": e.to_string() }))
        }
    };

    let response = build_response(&req, status, body);
    let _ = req.respond(response);
}

fn list_keyring_metadata(ctx: &Arc<FlovartContext>) -> FlovartResult<Vec<KeyringEntry>> {
    let prefix = "keyring:meta:";
    let raw = ctx.state_db.kv_list_prefix(prefix)?;
    let mut out = Vec::new();
    for (k, v) in raw {
        if let Some(rest) = k.strip_prefix(prefix) {
            if let Some((provider, key_id)) = keyring::parse_account(rest) {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&v) {
                    out.push(KeyringEntry {
                        provider,
                        key_id,
                        label: meta.get("label").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        updated_at: meta.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0),
                    });
                }
            }
        }
    }
    Ok(out)
}

fn keyring_set_via_ctx(
    ctx: &Arc<FlovartContext>,
    provider: String,
    key_id: String,
    secret: String,
    label: Option<String>,
) -> FlovartResult<KeyringEntry> {
    let account = keyring::entry_account(&provider, &key_id);
    let entry = build_entry_pub(&account)?;
    entry.set_password(&secret).map_err(|e| FlovartError::Keyring(e.to_string()))?;
    let now = chrono::Utc::now().timestamp_millis();
    let json = serde_json::json!({
        "provider": provider,
        "key_id": key_id,
        "label": label,
        "updated_at": now,
    });
    let metadata_key = format!("keyring:meta:{provider}:{key_id}");
    ctx.state_db.kv_set(&metadata_key, &json.to_string())?;
    Ok(KeyringEntry { provider, key_id, label, updated_at: now })
}

fn build_entry_pub(account: &str) -> FlovartResult<keyring::Entry> {
    keyring::Entry::new(keyring::KEYRING_SERVICE, account)
        .map_err(|e| FlovartError::Keyring(e.to_string()))
}

#[tauri::command]
pub fn http_status() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "runtime": "flovart-desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "bind": BIND_ADDR,
    })
}

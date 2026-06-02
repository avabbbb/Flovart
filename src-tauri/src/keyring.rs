//! 操作系统 Keyring 包装。
//!
//! 使用 keyring v3 `default_credential_builder()` API，
//! 在每个平台上自动选合适的 native store（macOS Keychain /
//! Windows Credential Manager / Linux Secret Service）。
//!
//! Service 统一用 `com.flovart.desktop`，account 用 `{provider}:{keyId}`，
//! password 直接存 raw API Key（Keyring 自身加密）。
//!
//! 元数据（label / updated_at）走 SQLite KV 表。

use crate::errors::{FlovartError, FlovartResult};
use crate::FlovartContext;
use serde::{Deserialize, Serialize};
use tauri::State;

pub const KEYRING_SERVICE: &str = "com.flovart.desktop";

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyringEntry {
    pub provider: String,
    pub key_id: String,
    pub label: Option<String>,
    pub updated_at: i64,
}

pub fn entry_account(provider: &str, key_id: &str) -> String {
    format!("{provider}:{key_id}")
}

pub fn parse_account(account: &str) -> Option<(String, String)> {
    let mut parts = account.splitn(2, ':');
    let provider = parts.next()?.to_string();
    let key_id = parts.next()?.to_string();
    Some((provider, key_id))
}

fn build_credential(account: &str) -> FlovartResult<Box<dyn keyring::Credential>> {
    let builder = keyring::default::default_credential_builder();
    builder
        .build(None, KEYRING_SERVICE, account)
        .map_err(|e| FlovartError::Keyring(e.to_string()))
}

#[tauri::command]
pub fn keyring_set(
    ctx: State<'_, std::sync::Arc<FlovartContext>>,
    provider: String,
    key_id: String,
    secret: String,
    label: Option<String>,
) -> FlovartResult<KeyringEntry> {
    let account = entry_account(&provider, &key_id);
    let credential = build_credential(&account)?;
    credential.set_password(&secret).map_err(|e| FlovartError::Keyring(e.to_string()))?;

    let now = chrono::Utc::now().timestamp_millis();
    let json = serde_json::json!({
        "provider": provider,
        "key_id": key_id,
        "label": label,
        "updated_at": now,
    });
    let metadata_key = format!("keyring:meta:{provider}:{key_id}");
    ctx.state_db.kv_set(&metadata_key, &json.to_string())?;
    Ok(KeyringEntry {
        provider,
        key_id,
        label,
        updated_at: now,
    })
}

#[tauri::command]
pub fn keyring_get(
    _ctx: State<'_, std::sync::Arc<FlovartContext>>,
    provider: String,
    key_id: String,
) -> FlovartResult<Option<String>> {
    let account = entry_account(&provider, &key_id);
    let credential = build_credential(&account)?;
    match credential.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(FlovartError::Keyring(e.to_string())),
    }
}

#[tauri::command]
pub fn keyring_delete(
    ctx: State<'_, std::sync::Arc<FlovartContext>>,
    provider: String,
    key_id: String,
) -> FlovartResult<bool> {
    let account = entry_account(&provider, &key_id);
    let credential = build_credential(&account)?;
    match credential.delete_credential() {
        Ok(()) => {
            let metadata_key = format!("keyring:meta:{provider}:{key_id}");
            let _ = ctx.state_db.kv_delete(&metadata_key);
            Ok(true)
        }
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(FlovartError::Keyring(e.to_string())),
    }
}

#[tauri::command]
pub fn keyring_list(
    ctx: State<'_, std::sync::Arc<FlovartContext>>,
) -> FlovartResult<Vec<KeyringEntry>> {
    let prefix = "keyring:meta:";
    let raw = ctx.state_db.kv_list_prefix(prefix)?;
    let mut entries = Vec::with_capacity(raw.len());
    for (k, v) in raw {
        if let Some(rest) = k.strip_prefix(prefix) {
            if let Some((provider, key_id)) = parse_account(rest) {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&v) {
                    entries.push(KeyringEntry {
                        provider,
                        key_id,
                        label: meta
                            .get("label")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        updated_at: meta
                            .get("updated_at")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0),
                    });
                }
            }
        }
    }
    Ok(entries)
}

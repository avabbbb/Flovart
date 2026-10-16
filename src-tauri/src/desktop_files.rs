//! 桌面端另存为通道。
//! 打包后 WebView2/WKWebView 对 <a download> 的处理不可靠（静默落盘或无反应），
//! 前端把文件字节经原始 IPC 交给这里，由系统保存对话框决定落盘位置。
//! 不引入 plugin-fs，也不向 WebView 开放任意路径写权限：路径只来自用户在对话框中的选择。

use std::path::PathBuf;

use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle,
};
use tauri_plugin_dialog::DialogExt;

const FILE_NAME_HEADER: &str = "x-iris-file-name";
const MAX_FILE_NAME_CHARS: usize = 180;
const FALLBACK_FILE_NAME: &str = "download";

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// IPC header 只能携带 ASCII，前端用 encodeURIComponent 编码文件名。
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            out.push((high << 4) | low);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 只保留文件名本身：替换路径分隔符与 Windows 保留字符，避免建议名带出目录。
fn sanitize_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch == char::from(42) || ch.is_control() => '_',
            ch => ch,
        })
        .take(MAX_FILE_NAME_CHARS)
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        FALLBACK_FILE_NAME.to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn suggested_file_name(request: &Request<'_>) -> String {
    request
        .headers()
        .get(FILE_NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(percent_decode)
        .map(|name| sanitize_file_name(&name))
        .unwrap_or_else(|| FALLBACK_FILE_NAME.to_owned())
}

/// 弹出系统另存为对话框并写入文件。用户取消返回 None，不视为错误。
#[tauri::command]
pub async fn desktop_save_file(
    app: AppHandle,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw file bytes".to_owned());
    };
    let file_name = suggested_file_name(&request);
    let Some(target) = app.dialog().file().set_file_name(file_name).blocking_save_file() else {
        return Ok(None);
    };
    let path: PathBuf = target
        .into_path()
        .map_err(|error| format!("Invalid save path: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Failed to save file: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{percent_decode, sanitize_file_name, FALLBACK_FILE_NAME};

    #[test]
    fn decodes_utf8_file_names() {
        assert_eq!(percent_decode("%E5%9B%BE%E7%89%87.png").as_deref(), Some("\u{56fe}\u{7247}.png"));
        assert_eq!(percent_decode("bad%zz"), None);
        assert_eq!(percent_decode("cut%E"), None);
    }

    #[test]
    fn strips_directories_and_reserved_characters() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(sanitize_file_name("a:b?c.png"), "a_b_c.png");
        assert_eq!(sanitize_file_name(" ... "), FALLBACK_FILE_NAME);
    }
}

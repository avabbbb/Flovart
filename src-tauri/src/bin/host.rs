// `flovart-host` 二进制：作为 Chrome Native Messaging 宿主运行。
//
// Chrome / Edge 启动这个可执行文件，把 JSON 通过 stdin 传过来（4字节 little-endian
// 长度前缀 + 负载），本进程读取、转发到主 EXE 的本地 HTTP 服务（127.0.0.1:7421），
// 再把响应按相同格式写回 stdout。
//
// 这是把扩展和 EXE 解耦的标准模式：EXE 不需要关心 Chrome 的 IPC 协议。

use std::env;
use std::io::{Read, Write};
use std::net::TcpStream;

const EXE_HOST: &str = "127.0.0.1:7421";

fn main() {
    // 读 4 字节长度
    let mut len_buf = [0u8; 4];
    if let Err(e) = std::io::stdin().read_exact(&mut len_buf) {
        eprintln!("read length: {e}");
        std::process::exit(1);
    }
    let len = u32::from_le_bytes(len_buf) as usize;

    // 读 JSON
    let mut body = vec![0u8; len];
    if let Err(e) = std::io::stdin().read_exact(&mut body) {
        eprintln!("read body: {e}");
        std::process::exit(1);
    }
    let request: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            write_response(&serde_json::json!({ "ok": false, "error": format!("bad json: {e}") }));
            return;
        }
    };

    // 解析转发
    let path = request.get("path").and_then(|v| v.as_str()).unwrap_or("/status");
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
    let body = request.get("body").cloned().unwrap_or_else(|| serde_json::json!({}));

    let response = forward_to_exe(path, method, &body);
    write_response(&response);
}

fn forward_to_exe(path: &str, method: &str, body: &serde_json::Value) -> serde_json::Value {
    let mut stream = match TcpStream::connect(EXE_HOST) {
        Ok(s) => s,
        Err(e) => {
            return serde_json::json!({
                "ok": false,
                "error": format!("Cannot reach Flovart Desktop at {EXE_HOST}: {e}. Is it running?")
            });
        }
    };

    let body_str = body.to_string();
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {EXE_HOST}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body_str}",
        body_str.len()
    );

    if let Err(e) = stream.write_all(req.as_bytes()) {
        return serde_json::json!({ "ok": false, "error": format!("write: {e}") });
    }

    let mut raw = String::new();
    if let Err(e) = stream.read_to_string(&mut raw) {
        return serde_json::json!({ "ok": false, "error": format!("read: {e}") });
    }

    // 拆 header / body
    if let Some(idx) = raw.find("\r\n\r\n") {
        let payload = &raw[idx + 4..];
        serde_json::from_str(payload).unwrap_or_else(|e| {
            serde_json::json!({ "ok": false, "error": format!("bad response json: {e}; body: {payload}" )})
        })
    } else {
        serde_json::json!({ "ok": false, "error": "no body in response" })
    }
}

fn write_response(payload: &serde_json::Value) {
    let bytes = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let len = (bytes.len() as u32).to_le_bytes();
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    let _ = handle.write_all(&len);
    let _ = handle.write_all(&bytes);
    let _ = handle.flush();
}

#[allow(dead_code)]
fn _suppress_unused() {
    env::var_os("DUMMY");
}

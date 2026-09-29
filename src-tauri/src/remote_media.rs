use std::{
    net::{IpAddr, ToSocketAddrs},
    time::Duration,
};

use reqwest::{header::CONTENT_TYPE, redirect::Policy, Client, StatusCode};
use tauri::{ipc::Response, AppHandle};
use tauri_plugin_opener::OpenerExt;
use url::{Host, Url};

const MAX_REMOTE_MEDIA_BYTES: u64 = 256 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const MAX_MIME_BYTES: usize = 512;

fn is_private_or_special_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            let shared = octets[0] == 100 && (64..=127).contains(&octets[1]);
            let reserved = octets[0] >= 240;
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_multicast()
                || shared
                || reserved
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            let unique_local = (segments[0] & 0xfe00) == 0xfc00;
            let link_local = (segments[0] & 0xffc0) == 0xfe80;
            ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || unique_local || link_local
        }
    }
}

fn validate_remote_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" {
        return Err("Remote media downloads require HTTPS".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Remote media URLs must not contain credentials".to_owned());
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err("Remote media URLs must use the default HTTPS port".to_owned());
    }

    let host = url
        .host()
        .ok_or_else(|| "Remote media URL is missing a host".to_owned())?;

    match host {
        Host::Ipv4(ip) => {
            if is_private_or_special_ip(IpAddr::V4(ip)) {
                return Err("Remote media URL resolves to a private or special address".to_owned());
            }
        }
        Host::Ipv6(ip) => {
            if is_private_or_special_ip(IpAddr::V6(ip)) {
                return Err("Remote media URL resolves to a private or special address".to_owned());
            }
        }
        Host::Domain(domain) => {
            let normalized = domain.trim_end_matches('.').to_ascii_lowercase();
            if normalized == "localhost"
                || normalized.ends_with(".localhost")
                || normalized.ends_with(".local")
                || normalized.ends_with(".internal")
            {
                return Err("Remote media URL uses a local-only hostname".to_owned());
            }

            let port = url.port_or_known_default().unwrap_or(443);
            let addresses = (domain, port)
                .to_socket_addrs()
                .map_err(|error| format!("Could not resolve remote media host: {error}"))?;
            let mut resolved = false;
            for address in addresses {
                resolved = true;
                if is_private_or_special_ip(address.ip()) {
                    return Err("Remote media URL resolves to a private or special address".to_owned());
                }
            }
            if !resolved {
                return Err("Remote media host did not resolve to an address".to_owned());
            }
        }
    }

    Ok(())
}

fn frame_media_payload(mime_type: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mime = if mime_type.trim().is_empty() {
        "application/octet-stream"
    } else {
        mime_type.trim()
    };
    let mime_bytes = mime.as_bytes();
    if mime_bytes.len() > MAX_MIME_BYTES {
        return Err("Remote media Content-Type is too large".to_owned());
    }
    let mime_len = u32::try_from(mime_bytes.len())
        .map_err(|_| "Remote media Content-Type is too large".to_owned())?;
    let mut payload = Vec::with_capacity(4 + mime_bytes.len() + bytes.len());
    payload.extend_from_slice(&mime_len.to_le_bytes());
    payload.extend_from_slice(mime_bytes);
    payload.extend_from_slice(bytes);
    Ok(payload)
}

#[tauri::command]
pub async fn desktop_fetch_remote_media(url: String) -> Result<Response, String> {
    let client = Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .user_agent(concat!("Iris/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not initialize desktop media client: {error}"))?;

    let mut current = Url::parse(&url)
        .map_err(|error| format!("Invalid remote media URL: {error}"))?;

    for redirect_count in 0..=MAX_REDIRECTS {
        validate_remote_url(&current)?;

        let response = client
            .get(current.clone())
            .send()
            .await
            .map_err(|error| format!("Remote media request failed: {error}"))?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("Remote media redirected too many times".to_owned());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Remote media redirect is missing Location".to_owned())?;
            current = current
                .join(location)
                .map_err(|error| format!("Invalid remote media redirect: {error}"))?;
            continue;
        }

        if response.status() != StatusCode::OK && !response.status().is_success() {
            return Err(format!(
                "Remote media request failed with HTTP {}",
                response.status().as_u16()
            ));
        }

        if response
            .content_length()
            .is_some_and(|length| length > MAX_REMOTE_MEDIA_BYTES)
        {
            return Err(format!(
                "Remote media exceeds the {} MiB desktop download limit",
                MAX_REMOTE_MEDIA_BYTES / 1024 / 1024
            ));
        }

        let mime_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .unwrap_or("application/octet-stream")
            .trim()
            .to_owned();

        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Could not read remote media response: {error}"))?;

        if bytes.len() as u64 > MAX_REMOTE_MEDIA_BYTES {
            return Err(format!(
                "Remote media exceeds the {} MiB desktop download limit",
                MAX_REMOTE_MEDIA_BYTES / 1024 / 1024
            ));
        }

        return frame_media_payload(&mime_type, &bytes)
            .map(Response::new);
    }

    Err("Remote media redirected too many times".to_owned())
}

#[tauri::command]
pub fn desktop_open_remote_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url)
        .map_err(|error| format!("Invalid remote media URL: {error}"))?;
    validate_remote_url(&parsed)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open remote media URL: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_https_and_private_targets() {
        assert!(validate_remote_url(&Url::parse("http://example.com/video.mp4").unwrap()).is_err());
        assert!(validate_remote_url(&Url::parse("https://127.0.0.1/video.mp4").unwrap()).is_err());
        assert!(validate_remote_url(&Url::parse("https://10.0.0.1/video.mp4").unwrap()).is_err());
        assert!(validate_remote_url(&Url::parse("https://[::1]/video.mp4").unwrap()).is_err());
        assert!(validate_remote_url(&Url::parse("https://localhost/video.mp4").unwrap()).is_err());
    }

    #[test]
    fn frames_mime_type_and_bytes_for_raw_ipc() {
        let framed = frame_media_payload("video/mp4", &[1, 2, 3, 4]).unwrap();
        let mime_len = u32::from_le_bytes(framed[..4].try_into().unwrap()) as usize;
        assert_eq!(&framed[4..4 + mime_len], b"video/mp4");
        assert_eq!(&framed[4 + mime_len..], &[1, 2, 3, 4]);
    }
}

//! HTTP for AI Studio's web tools (fetching reference pages, the search API). Runs here rather
//! than in the webview because most sites don't allow cross-origin requests. Only public hosts:
//! the model chooses the URLs, so anything on the local network or this machine is refused.

use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

const MAX_BYTES: usize = 3 * 1024 * 1024;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 KatanaStudio";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    /// Final URL after redirects.
    pub url: String,
    pub status: u16,
    pub content_type: String,
    pub body: String,
    /// The body was cut at MAX_BYTES.
    pub truncated: bool,
}

/// Host names that can only mean something local.
fn local_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    !h.contains('.')
        || h == "localhost"
        || [".localhost", ".local", ".lan", ".home", ".internal", ".arpa", ".corp", ".intranet"]
            .iter()
            .any(|s| h.ends_with(s))
}

fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            v.is_loopback() || v.is_private() || v.is_link_local() || v.is_unspecified() || v.is_broadcast()
                || v.is_multicast() || v.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // carrier-grade NAT, also Tailscale
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            v.is_loopback() || v.is_unspecified() || v.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || v.to_ipv4_mapped().is_some_and(|m| private_ip(IpAddr::V4(m)))
        }
    }
}

/// Check a URL before any request (and each redirect): http(s) to a public host.
fn check_url(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("only http and https URLs are allowed, not {}", url.scheme()));
    }
    match url.host() {
        None => Err("URL has no host".into()),
        Some(url::Host::Ipv4(ip)) if private_ip(IpAddr::V4(ip)) => Err("local network addresses are not allowed".into()),
        Some(url::Host::Ipv6(ip)) if private_ip(IpAddr::V6(ip)) => Err("local network addresses are not allowed".into()),
        Some(url::Host::Domain(d)) if local_name(d) => Err("local network hosts are not allowed".into()),
        _ => Ok(()),
    }
}

/// Also refuse public-looking names that resolve to local addresses.
async fn check_resolves_public(url: &reqwest::Url) -> Result<(), String> {
    let Some(url::Host::Domain(host)) = url.host() else { return Ok(()) };
    let target = format!("{}:{}", host, url.port_or_known_default().unwrap_or(443));
    let addrs = tauri::async_runtime::spawn_blocking(move || target.to_socket_addrs().map(|a| a.collect::<Vec<_>>()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("couldn't look up {host}: {e}"))?;
    if addrs.iter().any(|a| private_ip(a.ip())) {
        return Err(format!("{host} points to a local network address"));
    }
    Ok(())
}

pub async fn request(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<Fetched, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| format!("bad URL: {e}"))?;
    check_url(&url)?;
    check_resolves_public(&url).await?;
    let client = reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 {
                a.error("too many redirects")
            } else if let Err(e) = check_url(a.url()) {
                a.error(e)
            } else {
                a.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(method.as_deref().unwrap_or("GET").as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, url).header("accept-language", "en-US,en;q=0.9");
    for (k, v) in headers.unwrap_or_default() {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let mut res = req.send().await.map_err(|e| e.to_string())?;
    let final_url = res.url().to_string();
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut bytes = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_BYTES {
            bytes.truncate(MAX_BYTES);
            truncated = true;
            break;
        }
    }
    Ok(Fetched { url: final_url, status, content_type, body: String::from_utf8_lossy(&bytes).into_owned(), truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_local_targets() {
        for u in ["http://localhost:8080/", "http://192.168.1.10/", "http://dev-box/", "http://printer.local/",
                  "http://10.0.0.1/", "http://[::1]/", "http://100.101.1.2/", "file:///etc/passwd", "http://127.0.0.1/"] {
            assert!(check_url(&reqwest::Url::parse(u).unwrap()).is_err(), "{u}");
        }
        for u in ["https://articles.boss.info/", "https://www.guitarworld.com/gear", "http://8.8.8.8/"] {
            assert!(check_url(&reqwest::Url::parse(u).unwrap()).is_ok(), "{u}");
        }
    }
}

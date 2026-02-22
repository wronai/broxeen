// src-tauri/src/network.rs
//
// Tauri commands for network device discovery and port probing.
// Add to main.rs: .invoke_handler(tauri::generate_handler![
//     network_scan_subnet,
//     network_probe_port,
//     rtsp_capture_frame,
//     db_execute,
//     db_query,
// ])

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

// ─── HTTP Fetch (base64) ────────────────────────────────────

#[derive(Serialize)]
pub struct HttpFetchBase64Result {
    pub url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub base64: String,
}

/// Fetch arbitrary bytes via HTTP(S) and return base64.
/// Useful for fetching camera snapshot images from the backend (avoids CORS).
#[tauri::command]
pub async fn http_fetch_base64(url: String) -> Result<HttpFetchBase64Result, String> {
    use base64::{engine::general_purpose, Engine as _};

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpFetchBase64Result {
        url,
        status,
        content_type,
        base64: general_purpose::STANDARD.encode(&bytes),
    })
}

// ─── Network Scan ───────────────────────────────────────────

#[derive(Serialize)]
pub struct DiscoveredHost {
    pub ip: String,
    pub mac: Option<String>,
    pub hostname: Option<String>,
    pub response_ms: f64,
}

/// Scan a subnet for live hosts using TCP connect probes.
/// Example: network_scan_subnet("192.168.1.0/24")
#[tauri::command]
pub async fn network_scan_subnet(subnet: String) -> Result<Vec<DiscoveredHost>, String> {
    let (base_ip, prefix) = parse_cidr(&subnet).map_err(|e| e.to_string())?;
    let host_count = 2u32.pow(32 - prefix) - 2; // exclude network + broadcast

    let mut hosts = Vec::new();
    let base: u32 = u32::from(base_ip);

    // Parallel probe using tokio tasks
    let mut tasks = Vec::new();

    for i in 1..=host_count {
        let ip = Ipv4Addr::from(base + i);
        tasks.push(tokio::spawn(async move {
            probe_host(ip).await
        }));
    }

    for task in tasks {
        if let Ok(Some(host)) = task.await {
            hosts.push(host);
        }
    }

    Ok(hosts)
}

async fn probe_host(ip: Ipv4Addr) -> Option<DiscoveredHost> {
    let addr = format!("{}:80", ip);
    let start = Instant::now();

    // Try TCP connect to port 80 (most common)
    let result = tokio::time::timeout(
        Duration::from_millis(500),
        tokio::net::TcpStream::connect(&addr),
    )
    .await;

    let alive = match result {
        Ok(Ok(_)) => true,
        _ => {
            // Fallback: try port 443
            let addr443 = format!("{}:443", ip);
            tokio::time::timeout(
                Duration::from_millis(300),
                tokio::net::TcpStream::connect(&addr443),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false)
        }
    };

    if !alive {
        return None;
    }

    let response_ms = start.elapsed().as_secs_f64() * 1000.0;

    // Try reverse DNS
    let hostname = tokio::task::spawn_blocking(move || {
        let sock_addr = format!("{}:0", ip);
        sock_addr
            .to_socket_addrs()
            .ok()
            .and_then(|mut addrs| addrs.next())
            .and_then(|_| dns_lookup::lookup_addr(&IpAddr::V4(ip)).ok())
    })
    .await
    .unwrap_or(None);

    Some(DiscoveredHost {
        ip: ip.to_string(),
        mac: None, // ARP table lookup would require root/elevated privileges
        hostname,
        response_ms,
    })
}

// ─── Port Probe ─────────────────────────────────────────────

#[derive(Serialize)]
pub struct ProbeResult {
    pub open: bool,
    pub response_ms: Option<f64>,
    pub banner: Option<String>,
}

#[tauri::command]
pub async fn network_probe_port(
    ip: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<ProbeResult, String> {
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(2000));
    let addr = format!("{}:{}", ip, port);
    let start = Instant::now();

    let connect_result = tokio::time::timeout(
        timeout,
        tokio::net::TcpStream::connect(&addr),
    )
    .await;

    match connect_result {
        Ok(Ok(stream)) => {
            let response_ms = start.elapsed().as_secs_f64() * 1000.0;

            // Try to read banner (for HTTP, SSH, RTSP)
            let banner = read_banner(&stream, port).await;

            Ok(ProbeResult {
                open: true,
                response_ms: Some(response_ms),
                banner,
            })
        }
        _ => Ok(ProbeResult {
            open: false,
            response_ms: None,
            banner: None,
        }),
    }
}

async fn read_banner(stream: &tokio::net::TcpStream, port: u16) -> Option<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // For HTTP ports, send a HEAD request
    if matches!(port, 80 | 443 | 8080 | 8443 | 3000 | 5000) {
        // We'd need to write HTTP request and read response
        // Simplified: just report as open
        return Some("HTTP".to_string());
    }

    // For RTSP
    if port == 554 {
        return Some("RTSP".to_string());
    }

    // For MQTT
    if matches!(port, 1883 | 9001) {
        return Some("MQTT".to_string());
    }

    // For SSH, the server sends banner first
    if port == 22 {
        return Some("SSH".to_string());
    }

    None
}

// ─── RTSP Frame Capture ─────────────────────────────────────

#[derive(Serialize)]
pub struct CapturedFrame {
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

/// Capture a single frame from an RTSP stream using ffmpeg.
#[tauri::command]
pub async fn rtsp_capture_frame(
    url: String,
    camera_id: String,
) -> Result<CapturedFrame, String> {
    use std::process::Command;
    use base64::{Engine as _, engine::general_purpose};

    let _ = camera_id;

    // Use ffmpeg to capture a single frame as JPEG
    let output = Command::new("ffmpeg")
        .args([
            "-rtsp_transport", "tcp",
            "-i", &url,
            "-frames:v", "1",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-q:v", "5",
            "pipe:1",
        ])
        .output()
        .map_err(|e| format!("ffmpeg not found: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    let base64 = general_purpose::STANDARD.encode(&output.stdout);

    // TODO: Extract actual dimensions from JPEG headers
    Ok(CapturedFrame {
        base64,
        width: 1920,
        height: 1080,
    })
}

// ─── SQLite Commands ────────────────────────────────────────

// These commands provide SQLite access from the frontend.
// Uses rusqlite for actual database operations.

use std::sync::Mutex;
use std::collections::HashMap;

// Global connection pool (lazy-initialized)
lazy_static::lazy_static! {
    static ref DB_CONNECTIONS: Mutex<HashMap<String, rusqlite::Connection>> =
        Mutex::new(HashMap::new());
}

#[tauri::command]
pub fn db_execute(db: String, sql: String, params: Vec<serde_json::Value>) -> Result<(), String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;

    let conn = conns.entry(db.clone()).or_insert_with(|| {
        let c = rusqlite::Connection::open(&db).expect("Failed to open database");
        c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("Failed to set PRAGMAs");
        c
    });

    let sqlite_params: Vec<Box<dyn rusqlite::types::ToSql>> = params
        .iter()
        .map(|v| json_to_sqlite_param(v))
        .collect();

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        sqlite_params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_query(
    db: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;

    let conn = conns.entry(db.clone()).or_insert_with(|| {
        let c = rusqlite::Connection::open(&db).expect("Failed to open database");
        c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("Failed to set PRAGMAs");
        c
    });

    let sqlite_params: Vec<Box<dyn rusqlite::types::ToSql>> = params
        .iter()
        .map(|v| json_to_sqlite_param(v))
        .collect();

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        sqlite_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mut map = HashMap::new();
            for (i, name) in column_names.iter().enumerate() {
                let value: rusqlite::types::Value = row.get(i)?;
                map.insert(name.clone(), sqlite_to_json(value));
            }
            Ok(map)
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

#[tauri::command]
pub fn db_close(db: String) -> Result<(), String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;
    conns.remove(&db);
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────

fn parse_cidr(cidr: &str) -> Result<(Ipv4Addr, u32), String> {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return Err("Invalid CIDR format".into());
    }
    let ip: Ipv4Addr = parts[0].parse().map_err(|_| "Invalid IP")?;
    let prefix: u32 = parts[1].parse().map_err(|_| "Invalid prefix")?;
    if prefix > 32 {
        return Err("Prefix must be 0-32".into());
    }
    // Mask to network address
    let mask = if prefix == 0 { 0 } else { !0u32 << (32 - prefix) };
    let network = Ipv4Addr::from(u32::from(ip) & mask);
    Ok((network, prefix))
}

fn json_to_sqlite_param(value: &serde_json::Value) -> Box<dyn rusqlite::types::ToSql> {
    match value {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(rusqlite::types::Null)
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        _ => Box::new(value.to_string()),
    }
}

fn sqlite_to_json(value: rusqlite::types::Value) -> serde_json::Value {
    match value {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::json!(i),
        rusqlite::types::Value::Real(f) => serde_json::json!(f),
        rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b) => {
            serde_json::Value::String(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &b,
            ))
        }
    }
}

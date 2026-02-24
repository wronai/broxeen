/**
 * Network scanning commands for Tauri backend.
 * Provides: ping_host, scan_ports, arp_scan, discover_onvif_cameras, discover_mdns
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::str::FromStr;
use std::time::{Duration, Instant};
use std::process::Command;
use std::process::Stdio;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::logging::{backend_info, backend_warn};

use std::sync::OnceLock;

/// Anonymizes passwords in RTSP URLs by replacing them with ***
pub fn anonymize_rtsp_url(text: &str) -> String {
    let mut result = text.to_string();
    
    // Find all RTSP URLs and anonymize them
    let mut start = 0;
    while let Some(scheme_start) = result[start..].find("rtsp://") {
        let absolute_scheme_start = start + scheme_start;
        
        // Find the end of this URL (next space, newline, or end of string)
        let url_end = result[absolute_scheme_start..]
            .find(|c| c == ' ' || c == '\n' || c == '\r')
            .map(|pos| absolute_scheme_start + pos)
            .unwrap_or(result.len());
        
        let url_fragment = &result[absolute_scheme_start..url_end];
        
        // Anonymize this specific URL
        if let Some(at_pos) = url_fragment.find('@') {
            if at_pos > 7 + 3 { // rtsp:// = 7 chars
                let before_auth = &url_fragment[..7 + 3]; // rtsp:// = 7 chars
                let after_auth = &url_fragment[at_pos..];
                if let Some(colon_pos) = url_fragment[7 + 3..at_pos].find(':') {
                    let username = &url_fragment[7 + 3..7 + 3 + colon_pos];
                    let anonymized_url = format!("{}{}:***{}", before_auth, username, after_auth);
                    result.replace_range(absolute_scheme_start..url_end, &anonymized_url);
                    
                    // Adjust start position to avoid infinite loops
                    start = absolute_scheme_start + anonymized_url.len();
                    continue;
                }
            }
        }
        
        start = absolute_scheme_start + 7; // Skip past "rtsp://"
    }
    
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anonymize_rtsp_url_with_password() {
        let url = "rtsp://admin:Tom4Camera@192.168.188.176:554/Streaming/Channels/102";
        let expected = "rtsp://admin:***@192.168.188.176:554/Streaming/Channels/102";
        assert_eq!(anonymize_rtsp_url(url), expected);
    }

    #[test]
    fn test_anonymize_rtsp_url_with_numeric_password() {
        let url = "rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main";
        let expected = "rtsp://admin:***@192.168.188.146:554/h264Preview_01_main";
        assert_eq!(anonymize_rtsp_url(url), expected);
    }

    #[test]
    fn test_anonymize_rtsp_url_without_password() {
        let url = "rtsp://admin@192.168.1.100:554/stream";
        assert_eq!(anonymize_rtsp_url(url), url);
    }

    #[test]
    fn test_anonymize_rtsp_url_no_auth() {
        let url = "rtsp://192.168.1.100:554/stream";
        assert_eq!(anonymize_rtsp_url(url), url);
    }

    #[test]
    fn test_anonymize_non_rtsp_url() {
        let url = "http://admin:password@example.com";
        assert_eq!(anonymize_rtsp_url(url), url);
    }

    #[test]
    fn test_anonymize_rtsp_url_multiline() {
        let stderr = "[tcp @ 0x59d7f4269000] Connection to tcp://192.168.188.176:554?timeout=0 failed: No route to host
[in#0 @ 0x59d7f4266180] Error opening input: No route to host
Error opening input file rtsp://admin:Tom4Camera@192.168.188.176:554/Streaming/Channels/102.
Error opening input files: No route to host";
        let expected = "[tcp @ 0x59d7f4269000] Connection to tcp://192.168.188.176:554?timeout=0 failed: No route to host
[in#0 @ 0x59d7f4266180] Error opening input: No route to host
Error opening input file rtsp://admin:***@192.168.188.176:554/Streaming/Channels/102.
Error opening input files: No route to host";
        assert_eq!(anonymize_rtsp_url(stderr), expected);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CapturedFrame {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    /// Milliseconds since the RTSP worker started when this frame was captured
    pub frame_age_ms: Option<u64>,
    /// Total frames captured by this worker so far
    pub frame_count: Option<u64>,
}

fn infer_vendor_from_ports(ports: &[u16]) -> Option<String> {
    use std::collections::HashSet;

    const RTSP_PORTS: &[u16] = &[554, 8554, 10554];
    const HIK_LIKE_PORTS: &[u16] = &[8000, 8899];
    const WEB_PORTS: &[u16] = &[80, 81, 82, 83, 443, 8080, 8081, 8443, 8888];

    let set: HashSet<u16> = ports.iter().copied().collect();
    let has_any = |list: &[u16]| list.iter().any(|p| set.contains(p));

    let has_rtsp = has_any(RTSP_PORTS);
    let has_web = has_any(WEB_PORTS);
    let has_hik_like = has_any(HIK_LIKE_PORTS);

    if has_hik_like && (has_web || has_rtsp) {
        return Some("Annke (Hikvision OEM)".to_string());
    }

    None
}

#[derive(Clone)]
struct LiveFrameCache {
    last_jpeg: Arc<Mutex<Option<Vec<u8>>>>,
    last_update_ms: Arc<Mutex<Option<u128>>>,
    last_error: Arc<Mutex<Option<String>>>,
    frame_count: Arc<Mutex<u64>>,
    started_at: Arc<Mutex<Option<Instant>>>,
}

struct RtspWorker {
    cache: LiveFrameCache,
    url: String,
    camera_id: String,
    shutdown: Arc<AtomicBool>,
}

static RTSP_WORKERS: OnceLock<Mutex<HashMap<String, RtspWorker>>> = OnceLock::new();

fn rtsp_workers() -> &'static Mutex<HashMap<String, RtspWorker>> {
    RTSP_WORKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn find_jpeg_frame(buffer: &[u8]) -> Option<(usize, usize)> {
    // Find SOI (FFD8) then EOI (FFD9) after it.
    let start = buffer
        .windows(2)
        .position(|w| w == [0xFF, 0xD8])?;

    let end = buffer
        .get(start + 2..)?
        .windows(2)
        .position(|w| w == [0xFF, 0xD9])
        .map(|p| start + 2 + p + 2)?;

    Some((start, end))
}

fn ensure_rtsp_worker(camera_id: &str, url: &str) -> LiveFrameCache {
    let worker_key = format!("{}|{}", camera_id, url);
    let mut workers = rtsp_workers().lock().expect("RTSP_WORKERS lock poisoned");
    if let Some(existing) = workers.get(&worker_key) {
        return existing.cache.clone();
    }

    let cache = LiveFrameCache {
        last_jpeg: Arc::new(Mutex::new(None)),
        last_update_ms: Arc::new(Mutex::new(None)),
        last_error: Arc::new(Mutex::new(None)),
        frame_count: Arc::new(Mutex::new(0)),
        started_at: Arc::new(Mutex::new(None)),
    };

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_for_thread = Arc::clone(&shutdown);
    let cache_for_thread = cache.clone();
    let camera_id_for_thread = camera_id.to_string();
    let url_for_thread = url.to_string();

    std::thread::spawn(move || {
        let started_at = Instant::now();
        {
            let mut sa = cache_for_thread.started_at.lock().expect("started_at lock poisoned");
            *sa = Some(started_at);
        }

        // Hard guard: this worker is RTSP-only. Prevent accidental HTTP snapshot URLs or bare paths.
        if !url_for_thread.to_lowercase().starts_with("rtsp://") {
            backend_warn(&format!(
                "rtsp worker rejected non-RTSP url: camera_id={} url={}",
                camera_id_for_thread, anonymize_rtsp_url(&url_for_thread)
            ));
            let mut err = cache_for_thread
                .last_error
                .lock()
                .expect("last_error lock poisoned");
            *err = Some(format!(
                "RTSP worker expected rtsp:// URL, got: {}",
                anonymize_rtsp_url(&url_for_thread)
            ));
            return;
        }

        let run_worker = |include_timeouts: bool| -> Result<(), String> {
            let mut cmd = Command::new("ffmpeg");
            cmd.args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
            ]);
            // Removed -rw_timeout as it's not supported in this ffmpeg version
            cmd.args([
                "-fflags",
                "nobuffer",
                "-flags",
                "low_delay",
                "-analyzeduration",
                "100000",
                "-probesize",
                "8192",
                "-i",
                &url_for_thread,
                "-vf",
                "fps=1",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-q:v",
                "5",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

            let mut child = cmd
                .spawn()
                .map_err(|e| format!("ffmpeg spawn failed for {}: {}", camera_id_for_thread, e))?;

            backend_info(&format!(
                "rtsp worker started: camera_id={} elapsed_ms={} url={}",
                camera_id_for_thread,
                started_at.elapsed().as_millis(),
                anonymize_rtsp_url(&url_for_thread)
            ));

            let mut stdout = child
                .stdout
                .take()
                .ok_or_else(|| "ffmpeg stdout not available".to_string())?;
            let mut stderr = child.stderr.take();

            let mut buf: Vec<u8> = Vec::with_capacity(1024 * 256);
            let mut tmp = [0u8; 8192];
            loop {
                if shutdown_for_thread.load(Ordering::Relaxed) {
                    let _ = child.kill();
                    return Ok(());
                }
                use std::io::Read;
                match stdout.read(&mut tmp) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&tmp[..n]);
                        while let Some((start, end)) = find_jpeg_frame(&buf) {
                            let frame = buf[start..end].to_vec();
                            {
                                let mut last = cache_for_thread
                                    .last_jpeg
                                    .lock()
                                    .expect("last_jpeg lock poisoned");
                                *last = Some(frame);
                            }
                            {
                                let mut count = cache_for_thread
                                    .frame_count
                                    .lock()
                                    .expect("frame_count lock poisoned");
                                *count += 1;
                            }
                            {
                                let mut ts = cache_for_thread
                                    .last_update_ms
                                    .lock()
                                    .expect("last_update_ms lock poisoned");
                                *ts = Some(started_at.elapsed().as_millis() as u128);
                            }
                            {
                                let mut err = cache_for_thread
                                    .last_error
                                    .lock()
                                    .expect("last_error lock poisoned");
                                *err = None;
                            }

                            buf.drain(0..end);
                        }

                        if buf.len() > 8 * 1024 * 1024 {
                            backend_warn(&format!(
                                "rtsp worker buffer overflow; dropping buffer camera_id={} size={}",
                                camera_id_for_thread,
                                buf.len()
                            ));
                            buf.clear();
                        }
                    }
                    Err(e) => {
                        let mut err = cache_for_thread
                            .last_error
                            .lock()
                            .expect("last_error lock poisoned");
                        *err = Some(format!("ffmpeg read error: {}", e));
                        break;
                    }
                }
            }

            let mut stderr_text: Option<String> = None;
            if let Some(mut st) = stderr.take() {
                use std::io::Read;
                let mut buf_err = Vec::new();
                if st.read_to_end(&mut buf_err).is_ok() {
                    let s = String::from_utf8_lossy(&buf_err).to_string();
                    let trimmed = s.trim().to_string();
                    if !trimmed.is_empty() {
                        stderr_text = Some(trimmed);
                    }
                }
            }

            let status = child.wait();
            backend_warn(&format!(
                "rtsp worker exited: camera_id={} status={:?}",
                camera_id_for_thread, status
            ));

            if let Some(msg) = &stderr_text {
                let anonymized_msg = anonymize_rtsp_url(msg);
                backend_warn(&format!(
                    "rtsp worker stderr: camera_id={} error={}",
                    camera_id_for_thread, anonymized_msg
                ));
            }

            if let Some(msg) = stderr_text {
                let anonymized_msg = anonymize_rtsp_url(&msg);
                return Err(format!("ffmpeg exited: {}", anonymized_msg));
            }

            Err("ffmpeg exited".to_string())
        };

        let mut last_err: Option<String> = None;
        for include_timeouts in [true, false] {
            match run_worker(include_timeouts) {
                Ok(()) => return,
                Err(e) => {
                    let lower = e.to_lowercase();
                    let looks_like_unknown_option = lower.contains("unrecognized option")
                        || lower.contains("option not found")
                        || lower.contains("error splitting the argument list");
                    last_err = Some(e);
                    if include_timeouts && looks_like_unknown_option {
                        continue;
                    }
                    break;
                }
            }
        }

        if let Some(msg) = last_err {
            let mut err = cache_for_thread
                .last_error
                .lock()
                .expect("last_error lock poisoned");
            *err = Some(msg);
        }
    });

    workers.insert(
        worker_key,
        RtspWorker {
            cache: cache.clone(),
            url: url.to_string(),
            camera_id: camera_id.to_string(),
            shutdown,
        },
    );
    cache
}

#[tauri::command]
pub fn rtsp_stop_worker(camera_id: String, url: String) -> Result<(), String> {
    let worker_key = format!("{}|{}", camera_id, url);
    let mut workers = rtsp_workers().lock().map_err(|e| e.to_string())?;
    if let Some(worker) = workers.remove(&worker_key) {
        worker.shutdown.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn rtsp_stop_all_workers() -> Result<(), String> {
    let mut workers = rtsp_workers().lock().map_err(|e| e.to_string())?;
    for worker in workers.values() {
        worker.shutdown.store(true, Ordering::Relaxed);
    }
    workers.clear();
    Ok(())
}

#[tauri::command]
pub async fn rtsp_capture_frame(url: String, camera_id: String) -> Result<CapturedFrame, String> {
    use base64::{engine::general_purpose, Engine as _};
    let cache = ensure_rtsp_worker(&camera_id, &url);

    let has_any_frame = cache
        .last_jpeg
        .lock()
        .expect("last_jpeg lock poisoned")
        .is_some();
    let worker_uptime_ms = cache
        .started_at
        .lock()
        .expect("started_at lock poisoned")
        .map(|t| t.elapsed().as_millis() as u64);

    let wait_ms = if has_any_frame { 1200 } else { 5000 };
    let deadline = Instant::now() + Duration::from_millis(wait_ms);
    loop {
        if let Some(err_msg) = cache
            .last_error
            .lock()
            .expect("last_error lock poisoned")
            .clone()
        {
            return Err(err_msg);
        }

        if let Some(jpeg) = cache
            .last_jpeg
            .lock()
            .expect("last_jpeg lock poisoned")
            .clone()
        {
            let frame_age_ms = cache
                .last_update_ms
                .lock()
                .expect("last_update_ms lock poisoned")
                .map(|v| v as u64);
            let frame_count = Some(
                *cache
                    .frame_count
                    .lock()
                    .expect("frame_count lock poisoned"),
            );

            return Ok(CapturedFrame {
                base64: general_purpose::STANDARD.encode(&jpeg),
                width: 1920,
                height: 1080,
                frame_age_ms,
                frame_count,
            });
        }

        if Instant::now() >= deadline {
            let err = cache
                .last_error
                .lock()
                .expect("last_error lock poisoned")
                .clone();
            return Err(err.unwrap_or_else(|| {
                if let Some(ms) = worker_uptime_ms {
                    format!("RTSP frame not available yet (uptime={}ms)", ms)
                } else {
                    "RTSP frame not available yet".to_string()
                }
            }));
        }

        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

#[tauri::command]
pub async fn resize_image(base64: String, max_width: u32) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    use image::GenericImageView;
    
    // Decode base64
    let jpeg_bytes = general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    
    // Simple thumbnail generation using image crate (already a dependency)
    let img = image::load_from_memory(&jpeg_bytes)
        .map_err(|e| format!("Failed to load image: {}", e))?;
    
    let (width, height) = img.dimensions();
    if width <= max_width {
        // No resize needed, return original
        return Ok(base64);
    }
    
    let scale = max_width as f64 / width as f64;
    let new_width = max_width;
    let new_height = (height as f64 * scale) as u32;
    
    let resized = img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3);
    
    let mut output = Vec::new();
    resized.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(&output))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RtspWorkerStat {
    pub camera_id: String,
    pub url: String,
    pub frame_count: u64,
    pub uptime_ms: Option<u64>,
    pub last_error: Option<String>,
}

#[tauri::command]
pub fn rtsp_worker_stats() -> Vec<RtspWorkerStat> {
    let workers = rtsp_workers().lock().expect("RTSP_WORKERS lock poisoned");
    workers
        .values()
        .map(|w| {
            let frame_count = *w.cache.frame_count.lock().expect("frame_count lock");
            let uptime_ms = w
                .cache
                .started_at
                .lock()
                .expect("started_at lock")
                .map(|t| t.elapsed().as_millis() as u64);
            let last_error = w
                .cache
                .last_error
                .lock()
                .expect("last_error lock")
                .clone();
            RtspWorkerStat {
                camera_id: w.camera_id.clone(),
                url: w.url.clone(),
                frame_count,
                uptime_ms,
                last_error,
            }
        })
        .collect()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpFetchBase64Result {
    pub url: String,
    pub status: u16,
    pub content_type: Option<String>,
    pub base64: String,
}

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

// ─── Camera Health Check ────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct CameraHealthStatus {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub online: bool,
    pub latency_ms: Option<u64>,
    pub uptime: Option<String>,
    #[serde(rename = "lastSnapshot")]
    pub last_snapshot: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    #[serde(rename = "errorMessage")]
    pub error_message: Option<String>,
}

fn resolve_db_path(db: &str) -> Result<String, String> {
    if db == ":memory:" {
        return Ok(db.to_string());
    }

    let path = Path::new(db);
    if path.is_absolute() || path.parent().is_some_and(|p| p != Path::new("")) {
        return Ok(db.to_string());
    }

    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "Cannot resolve local data directory".to_string())?;
    let app_dir = base.join("broxeen");
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join(path).to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn camera_health_check(camera_id: Option<String>) -> Result<Vec<CameraHealthStatus>, String> {
    // Pull last known devices from devices DB (populated by NetworkScanPlugin).
    // Important: rusqlite types are not Send; we must not hold Connection/Statement across awaits.
    let rows: Vec<(String, String, Option<String>)> = {
        let db_path = resolve_db_path("broxeen_devices.db")?;
        let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;

        // Try to find RTSP/HTTP-capable devices first; fallback to all devices.
        let query = r#"
            SELECT DISTINCT d.id, d.ip, d.hostname
            FROM devices d
            LEFT JOIN device_services ds ON ds.device_id = d.id
            WHERE (ds.type IN ('rtsp', 'http') OR ds.type IS NULL)
            ORDER BY d.last_seen DESC
            LIMIT 200
        "#;

        let mut out: Vec<(String, String, Option<String>)> = Vec::new();
        {
            let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map([], |r| {
                    let id: String = r.get(0)?;
                    let ip: String = r.get(1)?;
                    let hostname: Option<String> = r.get(2)?;
                    Ok((id, ip, hostname))
                })
                .map_err(|e| e.to_string())?;

            for item in iter {
                out.push(item.map_err(|e| e.to_string())?);
            }
        }
        out
    };

    // Filter by a specific camera (plugin uses semantic IDs, but we accept either id, hostname match, or IP)
    let filtered = if let Some(target) = camera_id.as_ref() {
        let t = target.to_lowercase();
        rows.into_iter()
            .filter(|(id, ip, hostname)| {
                id.to_lowercase() == t
                    || ip.to_lowercase() == t
                    || hostname
                        .as_ref()
                        .map(|h| h.to_lowercase().contains(&t))
                        .unwrap_or(false)
            })
            .collect::<Vec<_>>()
    } else {
        rows
    };

    let mut out: Vec<CameraHealthStatus> = Vec::new();
    for (id, ip, hostname) in filtered {
        // Use existing ping implementation (with TCP fallback)
        match ping_host(ip.clone(), Some(1)).await {
            Ok(res) => {
                out.push(CameraHealthStatus {
                    id: id.clone(),
                    name: hostname.clone().unwrap_or_else(|| id.clone()),
                    ip: ip.clone(),
                    online: res.reachable,
                    latency_ms: res.avg_rtt.map(|v| v.round() as u64),
                    uptime: None,
                    last_snapshot: None,
                    resolution: None,
                    fps: None,
                    error_message: if res.reachable { None } else { Some("unreachable".to_string()) },
                });
            }
            Err(e) => {
                out.push(CameraHealthStatus {
                    id: id.clone(),
                    name: hostname.clone().unwrap_or_else(|| id.clone()),
                    ip: ip.clone(),
                    online: false,
                    latency_ms: None,
                    uptime: None,
                    last_snapshot: None,
                    resolution: None,
                    fps: None,
                    error_message: Some(e),
                });
            }
        }
    }

    Ok(out)
}

// ─── Ping ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct PingResult {
    pub reachable: bool,
    pub sent: u32,
    pub received: u32,
    pub lost: u32,
    pub loss_percent: f32,
    pub avg_rtt: Option<f32>,
    pub min_rtt: Option<f32>,
    pub max_rtt: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimplePingResult {
    pub reachable: bool,
}

#[tauri::command]
pub async fn ping_host_simple(ip: String, timeout: Option<u64>) -> Result<SimplePingResult, String> {
    let timeout = timeout.unwrap_or(3000);
    backend_info(format!("ping_host_simple: {} (timeout: {}ms)", ip, timeout));

    // Use TCP connect probe for faster results
    let ports_to_try = vec![80, 443, 554, 8080];
    
    for port in ports_to_try {
        let addr_str = format!("{}:{}", ip, port);
        if let Ok(addr) = addr_str.parse::<SocketAddr>() {
            match TcpStream::connect_timeout(&addr, Duration::from_millis(timeout)) {
                Ok(_) => {
                    backend_info(format!("ping_host_simple: {} reachable via port {}", ip, port));
                    return Ok(SimplePingResult { reachable: true });
                }
                Err(_) => {
                    // Try next port
                    continue;
                }
            }
        }
    }

    backend_info(format!("ping_host_simple: {} not reachable", ip));
    Ok(SimplePingResult { reachable: false })
}

#[tauri::command]
pub async fn ping_host(host: String, count: Option<u32>) -> Result<PingResult, String> {
    let count = count.unwrap_or(3);
    backend_info(format!("ping_host: {} x{}", host, count));

    #[cfg(target_os = "linux")]
    let output = Command::new("ping")
        .args(["-c", &count.to_string(), "-W", "2", &host])
        .output();

    #[cfg(target_os = "macos")]
    let output = Command::new("ping")
        .args(["-c", &count.to_string(), "-W", "2000", &host])
        .output();

    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .args(["-n", &count.to_string(), "-w", "2000", &host])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            parse_ping_output(&stdout, count)
        }
        Err(e) => {
            backend_warn(format!("ping_host failed for {}: {}", host, e));
            // Fallback: TCP connect probe
            tcp_probe_ping(&host, count).await
        }
    }
}

fn parse_ping_output(output: &str, sent: u32) -> Result<PingResult, String> {
    let received = output.lines()
        .filter(|l| l.contains("bytes from") || l.contains("ttl=") || l.contains("TTL="))
        .count() as u32;

    let lost = sent.saturating_sub(received);
    let loss_percent = if sent > 0 { (lost as f32 / sent as f32) * 100.0 } else { 100.0 };

    // Parse RTT stats (Linux: "rtt min/avg/max/mdev = X/X/X/X ms")
    let mut avg_rtt = None;
    let mut min_rtt = None;
    let mut max_rtt = None;

    for line in output.lines() {
        if line.contains("rtt min/avg/max") || line.contains("round-trip min/avg/max") {
            let parts: Vec<&str> = line.split('=').collect();
            if parts.len() >= 2 {
                let vals: Vec<f32> = parts[1]
                    .split('/')
                    .filter_map(|s| s.trim().parse::<f32>().ok())
                    .collect();
                if vals.len() >= 3 {
                    min_rtt = Some(vals[0]);
                    avg_rtt = Some(vals[1]);
                    max_rtt = Some(vals[2]);
                }
            }
        }
        // Windows: "Minimum = Xms, Maximum = Xms, Average = Xms"
        if line.contains("Average =") || line.contains("Minimum =") {
            let parse_ms = |s: &str, key: &str| -> Option<f32> {
                s.split(key).nth(1)?.split("ms").next()?.trim().parse().ok()
            };
            min_rtt = parse_ms(line, "Minimum = ");
            max_rtt = parse_ms(line, "Maximum = ");
            avg_rtt = parse_ms(line, "Average = ");
        }
    }

    Ok(PingResult {
        reachable: received > 0,
        sent,
        received,
        lost,
        loss_percent,
        avg_rtt,
        min_rtt,
        max_rtt,
    })
}

async fn tcp_probe_ping(host: &str, count: u32) -> Result<PingResult, String> {
    let ports = [80u16, 443, 22, 8080, 554];
    let mut received = 0u32;
    let mut rtts = Vec::new();

    for _ in 0..count {
        for &port in &ports {
            let addr_str = format!("{}:{}", host, port);
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                let t0 = Instant::now();
                if TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok() {
                    rtts.push(t0.elapsed().as_millis() as f32);
                    received += 1;
                    break;
                }
            }
        }
    }

    let avg_rtt = if rtts.is_empty() { None } else {
        Some(rtts.iter().sum::<f32>() / rtts.len() as f32)
    };
    let min_rtt = rtts.iter().cloned().reduce(f32::min);
    let max_rtt = rtts.iter().cloned().reduce(f32::max);
    let lost = count.saturating_sub(received);

    Ok(PingResult {
        reachable: received > 0,
        sent: count,
        received,
        lost,
        loss_percent: if count > 0 { (lost as f32 / count as f32) * 100.0 } else { 100.0 },
        avg_rtt,
        min_rtt,
        max_rtt,
    })
}

// ─── Port Scan ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OpenPort {
    pub port: u16,
    pub rtt: Option<u64>,
    pub banner: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortScanResult {
    pub scanned: usize,
    pub open: Vec<OpenPort>,
    pub filtered: Vec<u16>,
}

#[tauri::command]
pub async fn scan_ports(
    host: String,
    ports: Vec<u16>,
    timeout: Option<u64>,
) -> Result<PortScanResult, String> {
    let timeout_ms = timeout.unwrap_or(2000);
    backend_info(format!("scan_ports: {} ({} ports, {}ms timeout)", host, ports.len(), timeout_ms));

    let scanned = ports.len();
    let mut open = Vec::new();
    let mut filtered = Vec::new();

    // Resolve host to IP
    let ip = resolve_host(&host)?;

    // Scan ports concurrently in batches of 50
    let batch_size = 50;
    for chunk in ports.chunks(batch_size) {
        let results: Vec<_> = chunk.iter().map(|&port| {
            let addr = SocketAddr::new(ip, port);
            let t0 = Instant::now();
            match TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)) {
                Ok(mut stream) => {
                    let rtt = t0.elapsed().as_millis() as u64;
                    // Try to read banner (non-blocking)
                    let banner = try_read_banner(&mut stream);
                    Ok(OpenPort { port, rtt: Some(rtt), banner })
                }
                Err(e) => {
                    let kind = e.kind();
                    if kind == std::io::ErrorKind::ConnectionRefused {
                        Err(false) // closed
                    } else {
                        Err(true) // filtered/timeout
                    }
                }
            }
        }).collect();

        for (i, result) in results.into_iter().enumerate() {
            match result {
                Ok(port_info) => open.push(port_info),
                Err(true) => filtered.push(chunk[i]),
                Err(false) => {}
            }
        }
    }

    open.sort_by_key(|p| p.port);
    backend_info(format!("scan_ports: {} open, {} filtered on {}", open.len(), filtered.len(), host));

    Ok(PortScanResult { scanned, open, filtered })
}

fn resolve_host(host: &str) -> Result<IpAddr, String> {
    if let Ok(ip) = IpAddr::from_str(host) {
        return Ok(ip);
    }
    use std::net::ToSocketAddrs;
    let addr = format!("{}:80", host);
    addr.to_socket_addrs()
        .map_err(|e| format!("Cannot resolve {}: {}", host, e))?
        .next()
        .map(|a| a.ip())
        .ok_or_else(|| format!("No address for {}", host))
}

fn try_read_banner(stream: &mut TcpStream) -> Option<String> {
    use std::io::Read;
    stream.set_read_timeout(Some(Duration::from_millis(300))).ok()?;
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let s = String::from_utf8_lossy(&buf[..n]).to_string();
            let clean: String = s.chars().filter(|c| c.is_ascii_graphic() || *c == ' ').collect();
            if clean.len() > 3 { Some(clean.trim().to_string()) } else { None }
        }
        _ => None,
    }
}

// ─── ARP Scan ────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ArpHost {
    pub ip: String,
    pub mac: String,
    pub vendor: Option<String>,
    pub hostname: Option<String>,
    pub response_time: Option<u64>,
}

#[tauri::command]
pub async fn arp_scan(subnet: String, timeout: Option<u64>) -> Result<Vec<ArpHost>, String> {
    let timeout_ms = timeout.unwrap_or(3000);
    backend_info(format!("arp_scan: subnet={} timeout={}ms", subnet, timeout_ms));

    // Try system arp-scan tool first
    let arp_output = if subnet == "auto" {
        Command::new("arp-scan").args(["--localnet", "--quiet"]).output()
    } else {
        Command::new("arp-scan").args([&format!("{}.0/24", subnet), "--quiet"]).output()
    };

    if let Ok(out) = arp_output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            return Ok(parse_arp_scan_output(&stdout));
        }
    }

    // Fallback: read system ARP cache
    let arp_cache = Command::new("arp").arg("-a").output();
    if let Ok(out) = arp_cache {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let hosts = parse_arp_cache(&stdout);
        if !hosts.is_empty() {
            return Ok(hosts);
        }
    }

    // Last resort: TCP ping sweep
    let target_subnet = if subnet == "auto" { "192.168.1".to_string() } else { subnet };
    let hosts = tcp_sweep(&target_subnet, timeout_ms).await;
    Ok(hosts)
}

fn parse_arp_scan_output(output: &str) -> Vec<ArpHost> {
    output.lines()
        .filter(|l| l.contains('\t'))
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                Some(ArpHost {
                    ip: parts[0].trim().to_string(),
                    mac: parts[1].trim().to_string(),
                    vendor: parts.get(2).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
                    hostname: None,
                    response_time: None,
                })
            } else {
                None
            }
        })
        .collect()
}

fn parse_arp_cache(output: &str) -> Vec<ArpHost> {
    output.lines()
        .filter_map(|line| {
            // Format: hostname (ip) at mac [ether] on interface
            let ip = line.split('(').nth(1)?.split(')').next()?.trim().to_string();
            let mac = line.split("at ").nth(1)?.split_whitespace().next()?.trim().to_string();
            if mac == "<incomplete>" || mac.is_empty() { return None; }
            let hostname = line.split_whitespace().next().map(|s| s.to_string())
                .filter(|s| s != "?" && !s.starts_with('('));
            Some(ArpHost { ip, mac, vendor: None, hostname, response_time: None })
        })
        .collect()
}

async fn tcp_sweep(subnet: &str, timeout_ms: u64) -> Vec<ArpHost> {
    let mut hosts = Vec::new();
    let ports = [80u16, 443, 22, 554, 8080];

    for i in 1..=254u8 {
        let ip = format!("{}.{}", subnet, i);
        for &port in &ports {
            let addr_str = format!("{}:{}", ip, port);
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                let t0 = Instant::now();
                if TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms / 50)).is_ok() {
                    hosts.push(ArpHost {
                        ip: ip.clone(),
                        mac: "unknown".to_string(),
                        vendor: None,
                        hostname: None,
                        response_time: Some(t0.elapsed().as_millis() as u64),
                    });
                    break;
                }
            }
        }
    }
    hosts
}

// ─── ONVIF Discovery ─────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OnvifCamera {
    pub ip: String,
    pub port: u16,
    pub name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub serial: Option<String>,
    pub rtsp_url: Option<String>,
    pub snapshot_url: Option<String>,
    pub requires_auth: bool,
    pub profiles: Vec<String>,
}

#[tauri::command]
pub async fn discover_onvif_cameras(
    timeout: Option<u64>,
    subnet: Option<String>,
) -> Result<Vec<OnvifCamera>, String> {
    let timeout_ms = timeout.unwrap_or(5000);
    backend_info(format!("discover_onvif_cameras: timeout={}ms subnet={:?}", timeout_ms, subnet));

    let mut cameras = Vec::new();

    // Probe common camera ports on subnet
    let target_subnet = subnet.unwrap_or_else(|| "192.168.1".to_string());
    let camera_ports = [80u16, 8080, 8000, 8888];

    for i in 1..=254u8 {
        let ip = format!("{}.{}", target_subnet, i);
        for &port in &camera_ports {
            let addr_str = format!("{}:{}", ip, port);
            if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                    // Try ONVIF device service endpoint
                    let onvif_url = format!("http://{}:{}/onvif/device_service", ip, port);
                    if let Some(cam) = probe_onvif_endpoint(&ip, port, &onvif_url).await {
                        cameras.push(cam);
                        break;
                    } else {
                        // Check if it looks like a camera (has RTSP port)
                        let rtsp_addr = format!("{}:554", ip);
                        if let Ok(rtsp) = rtsp_addr.parse::<SocketAddr>() {
                            if TcpStream::connect_timeout(&rtsp, Duration::from_millis(300)).is_ok() {
                                cameras.push(OnvifCamera {
                                    ip: ip.clone(),
                                    port,
                                    name: None,
                                    manufacturer: None,
                                    model: None,
                                    firmware: None,
                                    serial: None,
                                    rtsp_url: Some(format!("rtsp://{}:554/stream", ip)),
                                    snapshot_url: Some(format!("http://{}:{}/snapshot.jpg", ip, port)),
                                    requires_auth: true,
                                    profiles: vec![],
                                });
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    backend_info(format!("discover_onvif_cameras: found {} cameras", cameras.len()));
    Ok(cameras)
}

async fn probe_onvif_endpoint(ip: &str, port: u16, _url: &str) -> Option<OnvifCamera> {
    // Minimal ONVIF WS-Discovery probe via HTTP
    // In a full implementation this would send SOAP GetDeviceInformation
    // For now we detect ONVIF by checking HTTP response headers
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1000))
        .build()
        .ok()?;

    let resp = client
        .get(&format!("http://{}:{}/onvif/device_service", ip, port))
        .send()
        .await
        .ok()?;

    let headers = resp.headers();
    let server = headers.get("server")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let is_camera = server.contains("hikvision")
        || server.contains("dahua")
        || server.contains("axis")
        || server.contains("onvif")
        || server.contains("camera")
        || resp.status().as_u16() == 401; // auth required = likely camera

    if is_camera {
        let manufacturer = if server.contains("hikvision") { Some("Hikvision".to_string()) }
            else if server.contains("dahua") { Some("Dahua".to_string()) }
            else if server.contains("axis") { Some("Axis".to_string()) }
            else { None };

        Some(OnvifCamera {
            ip: ip.to_string(),
            port,
            name: Some(format!("Camera @ {}:{}", ip, port)),
            manufacturer,
            model: None,
            firmware: None,
            serial: None,
            rtsp_url: Some(format!("rtsp://{}:554/stream", ip)),
            snapshot_url: Some(format!("http://{}:{}/snapshot.jpg", ip, port)),
            requires_auth: resp.status().as_u16() == 401,
            profiles: vec![],
        })
    } else {
        None
    }
}

// ─── mDNS Discovery ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct MdnsService {
    pub name: String,
    pub service_type: String,
    pub host: String,
    pub ip: String,
    pub port: u16,
    pub txt: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn discover_mdns(
    timeout: Option<u64>,
    service_types: Option<Vec<String>>,
) -> Result<Vec<MdnsService>, String> {
    let timeout_ms = timeout.unwrap_or(5000);
    backend_info(format!("discover_mdns: timeout={}ms types={:?}", timeout_ms, service_types));

    // Use avahi-browse on Linux if available
    let avahi = Command::new("avahi-browse")
        .args(["-a", "-t", "-r", "--no-db-lookup"])
        .output();

    if let Ok(out) = avahi {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            return Ok(parse_avahi_output(&stdout));
        }
    }

    // Fallback: dns-sd on macOS
    #[cfg(target_os = "macos")]
    {
        let dns_sd = Command::new("dns-sd")
            .args(["-B", "_services._dns-sd._udp", "local"])
            .output();
        if let Ok(out) = dns_sd {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            return Ok(parse_dns_sd_output(&stdout));
        }
    }

    backend_warn("discover_mdns: no mDNS tool available (avahi-browse/dns-sd)");
    Ok(vec![])
}

fn parse_avahi_output(output: &str) -> Vec<MdnsService> {
    let mut services = Vec::new();
    let mut current: Option<(String, String)> = None;

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with('=') {
            // New service entry
            let parts: Vec<&str> = line.splitn(5, ' ').collect();
            if parts.len() >= 5 {
                current = Some((parts[3].to_string(), parts[4].to_string()));
            }
        } else if line.starts_with("hostname") {
            if let Some((stype, name)) = &current {
                let host = line.split('=').nth(1).unwrap_or("").trim().trim_matches('[').trim_matches(']').to_string();
                services.push(MdnsService {
                    name: name.clone(),
                    service_type: stype.clone(),
                    host: host.clone(),
                    ip: String::new(),
                    port: 0,
                    txt: std::collections::HashMap::new(),
                });
            }
        }
    }
    services
}

#[cfg(target_os = "macos")]
fn parse_dns_sd_output(output: &str) -> Vec<MdnsService> {
    output.lines()
        .filter(|l| l.contains("Add"))
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 5 {
                Some(MdnsService {
                    name: parts[4..].join(" "),
                    service_type: parts[3].to_string(),
                    host: String::new(),
                    ip: String::new(),
                    port: 0,
                    txt: std::collections::HashMap::new(),
                })
            } else {
                None
            }
        })
        .collect()
}

// ─── Full Network Scan ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkDevice {
    pub ip: String,
    pub mac: Option<String>,
    pub hostname: Option<String>,
    pub vendor: Option<String>,
    pub open_ports: Vec<u16>,
    pub response_time: u64,
    pub last_seen: String,
    pub device_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkScanResult {
    pub devices: Vec<NetworkDevice>,
    pub scan_duration: u64,
    pub scan_method: String,
    pub subnet: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanNetworkArgs {
    pub subnet: Option<String>,
    pub timeout: Option<u64>,
    pub incremental: Option<bool>,
    pub target_ranges: Option<Vec<String>>,
}

#[tauri::command]
pub async fn scan_network(args: Option<ScanNetworkArgs>) -> Result<NetworkScanResult, String> {
    let subnet = args.as_ref().and_then(|a| a.subnet.clone());
    let timeout = args.as_ref().and_then(|a| a.timeout);
    let incremental = args.as_ref().and_then(|a| a.incremental).unwrap_or(false);
    let target_ranges = args
        .as_ref()
        .and_then(|a| a.target_ranges.clone())
        .unwrap_or_default();

    let timeout_ms = timeout.unwrap_or(5000);
    // The scan probes many ports across many hosts. A too-low TCP connect timeout
    // causes false negatives on slower Wi-Fi devices/cameras.
    // Keep this bounded to avoid stalling a full /24 scan.
    let per_port_timeout = std::cmp::min(std::cmp::max(timeout_ms / 20, 150), 800);
    let target_subnet = subnet.unwrap_or_else(|| detect_local_subnet());
    let t0 = Instant::now();

    let scan_mode = if incremental { "incremental" } else { "full" };
    backend_info(format!(
        "scan_network: mode={} subnet={} timeout={}ms (per-port={}ms) ranges={}",
        scan_mode,
        target_subnet,
        timeout_ms,
        per_port_timeout,
        target_ranges.len()
    ));

    let camera_ports: Vec<u16> = vec![
        80, 81, 82, 83, 443, 554, 8000, 8080, 8081, 8443, 8554, 8888, 8899, 9000, 10554,
    ];

    // Build host list
    let mut hosts: Vec<u16> = if incremental && !target_ranges.is_empty() {
        let mut out: Vec<u16> = Vec::new();
        for r in &target_ranges {
            out.extend(parse_target_range(&target_subnet, r));
        }
        out.sort_unstable();
        out.dedup();
        out
    } else {
        (1u16..=254).collect()
    };
    hosts.retain(|h| (1..=254).contains(h));

    backend_info(format!(
        "scan_network: scanning {} hosts (mode={})",
        hosts.len(),
        scan_mode
    ));

    // Parallel scan: spawn a blocking task per IP, batched to avoid fd exhaustion
    let batch_size = 50usize;
    let mut devices = Vec::new();

    for batch in hosts.chunks(batch_size) {
        let mut handles = Vec::new();

        for &i in batch {
            let ip = format!("{}.{}", target_subnet, i);
            let ports = camera_ports.clone();
            let ppt = per_port_timeout;

            let handle = tokio::task::spawn_blocking(move || {
                let mut open_ports = Vec::new();
                let mut response_time = 0u64;

                for &port in &ports {
                    let addr_str = format!("{}:{}", ip, port);
                    if let Ok(addr) = addr_str.parse::<SocketAddr>() {
                        let pt = Instant::now();
                        if TcpStream::connect_timeout(&addr, Duration::from_millis(ppt)).is_ok() {
                            if response_time == 0 {
                                response_time = pt.elapsed().as_millis() as u64;
                            }
                            open_ports.push(port);
                        }
                    }
                }

                if !open_ports.is_empty() {
                    let device_type = classify_device(&open_ports);
                    let vendor = infer_vendor_from_ports(&open_ports);
                    Some(NetworkDevice {
                        ip,
                        mac: None,
                        hostname: None,
                        vendor,
                        open_ports,
                        response_time,
                        last_seen: chrono::Utc::now().to_rfc3339(),
                        device_type: Some(device_type),
                    })
                } else {
                    None
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            if let Ok(Some(device)) = handle.await {
                devices.push(device);
            }
        }
    }

    // Enrich with ARP cache
    enrich_with_arp(&mut devices);

    // Sort by IP for consistent output
    devices.sort_by(|a, b| {
        let a_last: u8 = a.ip.rsplit('.').next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let b_last: u8 = b.ip.rsplit('.').next().and_then(|s| s.parse().ok()).unwrap_or(0);
        a_last.cmp(&b_last)
    });

    let scan_duration = t0.elapsed().as_millis() as u64;
    backend_info(format!("scan_network: found {} devices in {}ms", devices.len(), scan_duration));

    Ok(NetworkScanResult {
        devices,
        scan_duration,
        scan_method: if incremental {
            "tcp-connect-parallel-incremental".to_string()
        } else {
            "tcp-connect-parallel".to_string()
        },
        subnet: target_subnet,
    })
}

fn parse_target_range(target_subnet: &str, raw: &str) -> Vec<u16> {
    let s = raw.trim();
    if s.is_empty() {
        return vec![];
    }

    // Accept:
    // - "x-y" (last octet range)
    // - "a.b.c.x-y" (full prefix)
    // - "a.b.c.d" (single ip)
    // - "a.b.c.x" (single host)
    if let Some((a, b)) = s.split_once('-') {
        let a = a.trim();
        let b = b.trim();

        // "a.b.c.x-y" -> take last part for start
        let start = a.split('.').last().and_then(|p| p.parse::<u16>().ok());
        let end = b.parse::<u16>().ok();
        if let (Some(start), Some(end)) = (start, end) {
            let lo = std::cmp::min(start, end);
            let hi = std::cmp::max(start, end);
            return (lo..=hi).filter(|h| (1..=254).contains(h)).collect();
        }
        return vec![];
    }

    // Single IP or host
    if s.contains('.') {
        if let Some(last) = s.split('.').last().and_then(|p| p.parse::<u16>().ok()) {
            if s.starts_with(target_subnet) {
                return vec![last];
            }
            // If it's an IP from another subnet, ignore.
            return vec![];
        }
        return vec![];
    }

    if let Ok(h) = s.parse::<u16>() {
        if (1..=254).contains(&h) {
            return vec![h];
        }
    }

    vec![]
}

fn detect_local_subnet() -> String {
    // Try to detect local subnet from network interfaces
    let output = Command::new("ip").args(["route", "show", "default"]).output();
    if let Ok(out) = output {
        let s = String::from_utf8_lossy(&out.stdout).to_string();
        for line in s.lines() {
            if line.contains("src") {
                if let Some(src) = line.split("src").nth(1) {
                    let ip = src.trim().split_whitespace().next().unwrap_or("");
                    let parts: Vec<&str> = ip.split('.').collect();
                    if parts.len() == 4 {
                        return format!("{}.{}.{}", parts[0], parts[1], parts[2]);
                    }
                }
            }
        }
    }
    "192.168.1".to_string()
}

fn classify_device(ports: &[u16]) -> String {
    use std::collections::HashSet;

    const RTSP_PORTS: &[u16] = &[554, 8554, 10554];
    const HIK_LIKE_PORTS: &[u16] = &[8000, 8899];
    const WEB_PORTS: &[u16] = &[80, 81, 82, 83, 443, 8080, 8081, 8443, 8888];

    let set: HashSet<u16> = ports.iter().copied().collect();
    let has_any = |list: &[u16]| list.iter().any(|p| set.contains(p));

    let has_rtsp = has_any(RTSP_PORTS);
    let has_web = has_any(WEB_PORTS);
    let has_hik_like = has_any(HIK_LIKE_PORTS);

    if has_rtsp || (has_hik_like && has_web) {
        "camera".to_string()
    } else if set.contains(&1883) || set.contains(&9001) {
        "iot-broker".to_string()
    } else if set.contains(&22) {
        "server".to_string()
    } else if has_web {
        "web-device".to_string()
    } else {
        "unknown".to_string()
    }
}

fn enrich_with_arp(devices: &mut Vec<NetworkDevice>) {
    fn parse_arp_line(line: &str) -> Option<(String, Option<String>, Option<String>)> {
        // Format: hostname (ip) at mac [ether] on interface
        let ip = line
            .split('(')
            .nth(1)?
            .split(')')
            .next()?
            .trim()
            .to_string();

        let mac_str = line
            .split("at ")
            .nth(1)?
            .split_whitespace()
            .next()?
            .trim();
        if mac_str == "<incomplete>" || mac_str.is_empty() {
            return None;
        }

        let mac = Some(mac_str.to_string());
        let hostname = line
            .split_whitespace()
            .next()
            .filter(|s| *s != "?" && !s.starts_with('('))
            .map(|s| s.to_string());

        Some((ip, mac, hostname))
    }

    let Ok(out) = Command::new("arp").arg("-a").output() else {
        return;
    };

    let stdout = String::from_utf8_lossy(&out.stdout);

    let arp_map: HashMap<String, (Option<String>, Option<String>)> = stdout
        .lines()
        .filter_map(parse_arp_line)
        .map(|(ip, mac, hostname)| (ip, (mac, hostname)))
        .collect();

    for device in devices.iter_mut() {
        if let Some((mac, hostname)) = arp_map.get(&device.ip) {
            device.mac = mac.clone();
            device.hostname = hostname.clone();
        }
    }
}

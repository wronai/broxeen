/**
 * Network scanning commands for Tauri backend.
 * Provides: ping_host, scan_ports, arp_scan, discover_onvif_cameras, discover_mdns
 */

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::str::FromStr;
use std::time::{Duration, Instant};
use std::process::Command;

use crate::logging::{backend_info, backend_warn};

#[derive(Debug, Serialize, Deserialize)]
pub struct CapturedFrame {
    pub base64: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub async fn rtsp_capture_frame(url: String, _camera_id: String) -> Result<CapturedFrame, String> {
    use base64::{engine::general_purpose, Engine as _};

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

    Ok(CapturedFrame {
        base64: general_purpose::STANDARD.encode(&output.stdout),
        width: 1920,
        height: 1080,
    })
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

#[tauri::command]
pub async fn scan_network(subnet: Option<String>, timeout: Option<u64>) -> Result<NetworkScanResult, String> {
    let timeout_ms = timeout.unwrap_or(5000);
    let per_port_timeout = std::cmp::max(timeout_ms / 100, 50);
    let target_subnet = subnet.unwrap_or_else(|| detect_local_subnet());
    let t0 = Instant::now();

    backend_info(format!("scan_network: subnet={} timeout={}ms (per-port={}ms)", target_subnet, timeout_ms, per_port_timeout));

    let camera_ports: Vec<u16> = vec![80, 443, 554, 8080, 8443, 8554, 8000, 9000];

    // Parallel scan: spawn a blocking task per IP, batched to avoid fd exhaustion
    let batch_size = 50usize;
    let mut devices = Vec::new();

    for batch_start in (1u16..=254).step_by(batch_size) {
        let batch_end = std::cmp::min(batch_start + batch_size as u16 - 1, 254);
        let mut handles = Vec::new();

        for i in batch_start..=batch_end {
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
                            if response_time == 0 { response_time = pt.elapsed().as_millis() as u64; }
                            open_ports.push(port);
                        }
                    }
                }

                if !open_ports.is_empty() {
                    let device_type = classify_device(&open_ports);
                    Some(NetworkDevice {
                        ip,
                        mac: None,
                        hostname: None,
                        vendor: None,
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
        scan_method: "tcp-connect-parallel".to_string(),
        subnet: target_subnet,
    })
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
    if ports.contains(&554) || ports.contains(&8554) {
        "camera".to_string()
    } else if ports.contains(&1883) || ports.contains(&9001) {
        "iot-broker".to_string()
    } else if ports.contains(&22) {
        "server".to_string()
    } else if ports.contains(&80) || ports.contains(&443) {
        "web-device".to_string()
    } else {
        "unknown".to_string()
    }
}

fn enrich_with_arp(devices: &mut Vec<NetworkDevice>) {
    let arp = Command::new("arp").arg("-a").output();
    if let Ok(out) = arp {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        for device in devices.iter_mut() {
            for line in stdout.lines() {
                if line.contains(&device.ip) {
                    // Parse MAC
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    for (i, part) in parts.iter().enumerate() {
                        if *part == "at" && i + 1 < parts.len() {
                            let mac = parts[i + 1];
                            if mac != "<incomplete>" {
                                device.mac = Some(mac.to_string());
                            }
                        }
                    }
                    // Parse hostname
                    if let Some(hostname) = parts.first() {
                        if *hostname != "?" {
                            device.hostname = Some(hostname.to_string());
                        }
                    }
                }
            }
        }
    }
}

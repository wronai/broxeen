/**
 * SSH commands for Tauri backend.
 * Provides: ssh_execute, ssh_test_connection, ssh_list_known_hosts
 * Supports text2ssh: natural language → SSH command translation and execution.
 */

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Instant;

use crate::logging::{backend_info, backend_warn, backend_error};

// ─── SSH Execute ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SshResult {
    pub host: String,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn ssh_execute(
    host: String,
    command: String,
    user: Option<String>,
    port: Option<u16>,
    timeout: Option<u64>,
) -> Result<SshResult, String> {
    let ssh_user = user.unwrap_or_else(|| "root".to_string());
    let ssh_port = port.unwrap_or(22);
    let timeout_secs = timeout.unwrap_or(10);

    backend_info(format!(
        "ssh_execute: {}@{}:{} cmd='{}' timeout={}s",
        ssh_user, host, ssh_port, command, timeout_secs
    ));

    let t0 = Instant::now();

    let output = Command::new("ssh")
        .args([
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            "-o", &format!("ServerAliveInterval={}", timeout_secs),
            "-o", "BatchMode=yes",
            "-p", &ssh_port.to_string(),
            &format!("{}@{}", ssh_user, host),
            &command,
        ])
        .output()
        .map_err(|e| {
            backend_error(format!("ssh_execute failed to spawn: {}", e));
            format!("Nie można uruchomić SSH: {}", e)
        })?;

    let duration_ms = t0.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    backend_info(format!(
        "ssh_execute: exit={}, stdout_len={}, stderr_len={}, duration={}ms",
        exit_code, stdout.len(), stderr.len(), duration_ms
    ));

    Ok(SshResult {
        host,
        command,
        stdout,
        stderr,
        exit_code,
        duration_ms,
    })
}

// ─── SSH Test Connection ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SshTestResult {
    pub host: String,
    pub port: u16,
    pub reachable: bool,
    pub auth_ok: bool,
    pub ssh_version: Option<String>,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ssh_test_connection(
    host: String,
    user: Option<String>,
    port: Option<u16>,
) -> Result<SshTestResult, String> {
    let ssh_user = user.unwrap_or_else(|| "root".to_string());
    let ssh_port = port.unwrap_or(22);

    backend_info(format!(
        "ssh_test_connection: {}@{}:{}",
        ssh_user, host, ssh_port
    ));

    let t0 = Instant::now();

    // First: TCP connectivity check
    let addr = format!("{}:{}", host, ssh_port);
    let tcp_ok = std::net::TcpStream::connect_timeout(
        &addr.parse().map_err(|e| format!("Invalid address: {}", e))?,
        std::time::Duration::from_secs(3),
    );

    if tcp_ok.is_err() {
        let duration_ms = t0.elapsed().as_millis() as u64;
        return Ok(SshTestResult {
            host,
            port: ssh_port,
            reachable: false,
            auth_ok: false,
            ssh_version: None,
            duration_ms,
            error: Some("Port SSH niedostępny".to_string()),
        });
    }

    // Try SSH command 'echo ok'
    let output = Command::new("ssh")
        .args([
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=5",
            "-o", "BatchMode=yes",
            "-p", &ssh_port.to_string(),
            &format!("{}@{}", ssh_user, host),
            "echo", "broxeen-ssh-ok",
        ])
        .output();

    let duration_ms = t0.elapsed().as_millis() as u64;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let auth_ok = stdout.contains("broxeen-ssh-ok");

            // Try to get SSH version from banner
            let ssh_version = get_ssh_banner(&host, ssh_port);

            Ok(SshTestResult {
                host,
                port: ssh_port,
                reachable: true,
                auth_ok,
                ssh_version,
                duration_ms,
                error: if auth_ok { None } else { Some(stderr.lines().next().unwrap_or("Auth failed").to_string()) },
            })
        }
        Err(e) => {
            backend_warn(format!("ssh_test_connection: spawn failed: {}", e));
            Ok(SshTestResult {
                host,
                port: ssh_port,
                reachable: true,
                auth_ok: false,
                ssh_version: None,
                duration_ms,
                error: Some(format!("SSH binary error: {}", e)),
            })
        }
    }
}

// ─── Known Hosts ─────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct KnownHost {
    pub host: String,
    pub key_type: String,
}

#[tauri::command]
pub async fn ssh_list_known_hosts() -> Result<Vec<KnownHost>, String> {
    backend_info("ssh_list_known_hosts invoked");

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let known_hosts_path = home.join(".ssh").join("known_hosts");

    if !known_hosts_path.exists() {
        return Ok(vec![]);
    }

    let content = std::fs::read_to_string(&known_hosts_path)
        .map_err(|e| format!("Cannot read known_hosts: {}", e))?;

    let hosts: Vec<KnownHost> = content
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let host = parts[0]
                    .split(',')
                    .next()
                    .unwrap_or(parts[0])
                    .trim_start_matches('|')
                    .to_string();
                // Skip hashed entries
                if host.starts_with('|') {
                    return None;
                }
                Some(KnownHost {
                    host,
                    key_type: parts[1].to_string(),
                })
            } else {
                None
            }
        })
        .collect();

    backend_info(format!("ssh_list_known_hosts: found {} entries", hosts.len()));
    Ok(hosts)
}

fn get_ssh_banner(host: &str, port: u16) -> Option<String> {
    use std::io::Read;
    use std::net::TcpStream;

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect_timeout(
        &addr.parse().ok()?,
        std::time::Duration::from_secs(2),
    ).ok()?;

    stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).ok()?;
    let mut buf = [0u8; 256];
    let n = stream.read(&mut buf).ok()?;
    let banner = String::from_utf8_lossy(&buf[..n]).trim().to_string();

    if banner.starts_with("SSH-") {
        Some(banner)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssh_banner_localhost() {
        // This test only works if SSH is running locally
        let banner = get_ssh_banner("127.0.0.1", 22);
        if let Some(b) = &banner {
            println!("SSH banner: {}", b);
            assert!(b.starts_with("SSH-"));
        } else {
            println!("No local SSH server detected (ok in CI)");
        }
    }
}

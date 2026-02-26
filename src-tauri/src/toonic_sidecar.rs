//! toonic_sidecar.rs — Manage the Toonic Python sidecar process.
//!
//! Spawns `python3 -m toonic.server` as a child process, monitors health,
//! and exposes Tauri commands for the frontend to control it.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::logging::{backend_info, backend_error};

// ── State ────────────────────────────────────────────────────

static TOONIC_PROCESS: std::sync::OnceLock<Mutex<Option<Child>>> = std::sync::OnceLock::new();

fn toonic_lock() -> &'static Mutex<Option<Child>> {
    TOONIC_PROCESS.get_or_init(|| Mutex::new(None))
}

/// Default port for the toonic server
const DEFAULT_PORT: u16 = 8900;

/// Discover toonic install path — checks local dev path first, then system
fn find_toonic_path() -> Option<String> {
    // 1. Check env override
    if let Ok(path) = std::env::var("TOONIC_PATH") {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    // 2. Check sibling directory (dev layout: ~/github/wronai/toonic)
    if let Ok(home) = std::env::var("HOME") {
        let dev_path = format!("{}/github/wronai/toonic", home);
        if std::path::Path::new(&dev_path).join("toonic/__init__.py").exists() {
            return Some(dev_path);
        }
    }
    // 3. Check if toonic is pip-installed (importable)
    let check = Command::new("python3")
        .args(["-c", "import toonic; print(toonic.__file__)"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    if let Ok(output) = check {
        if output.status.success() {
            return Some("__installed__".to_string());
        }
    }
    None
}

/// Find python3 binary
fn find_python() -> String {
    if let Ok(p) = std::env::var("TOONIC_PYTHON") {
        return p;
    }
    // Check common locations
    for candidate in ["python3", "/usr/bin/python3", "/usr/local/bin/python3"] {
        let r = Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if let Ok(s) = r {
            if s.success() {
                return candidate.to_string();
            }
        }
    }
    "python3".to_string()
}

// ── Tauri commands ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ToonicStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: u16,
    pub url: String,
    pub toonic_path: Option<String>,
    pub python: String,
}

#[tauri::command]
pub async fn toonic_start(port: Option<u16>, goal: Option<String>) -> Result<ToonicStatus, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let goal = goal.unwrap_or_else(|| "broxeen monitoring bridge".to_string());

    // Check if already running
    {
        let guard = toonic_lock().lock().map_err(|e| e.to_string())?;
        if let Some(ref child) = *guard {
            let pid = child.id();
            backend_info(format!("Toonic already running (pid={})", pid));
            return Ok(ToonicStatus {
                running: true,
                pid: Some(pid),
                port,
                url: format!("http://127.0.0.1:{}", port),
                toonic_path: find_toonic_path(),
                python: find_python(),
            });
        }
    }

    let toonic_path = find_toonic_path().ok_or_else(|| {
        "Toonic not found. Set TOONIC_PATH or install: pip install -e /path/to/toonic".to_string()
    })?;

    let python = find_python();
    backend_info(format!(
        "Starting toonic sidecar: python={}, path={}, port={}, goal={}",
        python, toonic_path, port, goal
    ));

    let mut cmd = Command::new(&python);
    cmd.args(["-m", "toonic.server"])
        .args(["--port", &port.to_string()])
        .args(["--goal", &goal])
        .args(["--interval", "0"])  // event-driven mode, no periodic
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // If using local dev path, add it to PYTHONPATH
    if toonic_path != "__installed__" {
        let existing = std::env::var("PYTHONPATH").unwrap_or_default();
        let new_path = if existing.is_empty() {
            toonic_path.clone()
        } else {
            format!("{}:{}", toonic_path, existing)
        };
        cmd.env("PYTHONPATH", new_path);
    }

    // Forward LLM keys from Broxeen env
    for key in ["LLM_API_KEY", "OPENROUTER_API_KEY", "VITE_OPENROUTER_API_KEY", "LLM_MODEL"] {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, &val);
            // Also set the toonic-specific key
            if key == "VITE_OPENROUTER_API_KEY" || key == "OPENROUTER_API_KEY" {
                cmd.env("LLM_API_KEY", &val);
            }
        }
    }

    let child = cmd.spawn().map_err(|e| {
        backend_error(format!("Failed to spawn toonic: {}", e));
        format!("Failed to spawn toonic: {}", e)
    })?;

    let pid = child.id();
    backend_info(format!("Toonic sidecar started (pid={})", pid));

    let status = ToonicStatus {
        running: true,
        pid: Some(pid),
        port,
        url: format!("http://127.0.0.1:{}", port),
        toonic_path: Some(toonic_path),
        python,
    };

    let mut guard = toonic_lock().lock().map_err(|e| e.to_string())?;
    *guard = Some(child);

    Ok(status)
}

#[tauri::command]
pub async fn toonic_stop() -> Result<String, String> {
    let mut guard = toonic_lock().lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let pid = child.id();
        backend_info(format!("Stopping toonic sidecar (pid={})", pid));
        let _ = child.kill();
        let _ = child.wait();
        Ok(format!("Toonic stopped (pid={})", pid))
    } else {
        Ok("Toonic was not running".to_string())
    }
}

#[tauri::command]
pub async fn toonic_status(port: Option<u16>) -> Result<ToonicStatus, String> {
    let port = port.unwrap_or(DEFAULT_PORT);

    // Check if process is alive
    let (running, pid) = {
        let mut guard = toonic_lock().lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *guard {
            match child.try_wait() {
                Ok(Some(_exit)) => {
                    // Process exited
                    guard.take();
                    (false, None)
                }
                Ok(None) => (true, Some(child.id())),
                Err(_) => {
                    guard.take();
                    (false, None)
                }
            }
        } else {
            (false, None)
        }
    };

    // If process says running, also verify HTTP health
    let health_ok = if running {
        let url = format!("http://127.0.0.1:{}/api/broxeen/health", port);
        match reqwest::Client::new()
            .get(&url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
        {
            Ok(resp) => resp.status().is_success(),
            Err(_) => false,
        }
    } else {
        false
    };

    Ok(ToonicStatus {
        running: running && health_ok,
        pid,
        port,
        url: format!("http://127.0.0.1:{}", port),
        toonic_path: find_toonic_path(),
        python: find_python(),
    })
}

/// Proxy a GET request to the toonic server (avoids CORS from frontend)
#[tauri::command]
pub async fn toonic_proxy_get(path: String, port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}{}", port, path);

    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Toonic request failed: {}", e))?;

    resp.text()
        .await
        .map_err(|e| format!("Toonic response read error: {}", e))
}

/// Proxy a POST request to the toonic server
#[tauri::command]
pub async fn toonic_proxy_post(path: String, body: String, port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}{}", port, path);

    let resp = reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Toonic request failed: {}", e))?;

    resp.text()
        .await
        .map_err(|e| format!("Toonic response read error: {}", e))
}

/// Proxy a DELETE request to the toonic server
#[tauri::command]
pub async fn toonic_proxy_delete(path: String, port: Option<u16>) -> Result<String, String> {
    let port = port.unwrap_or(DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{}{}", port, path);

    let resp = reqwest::Client::new()
        .delete(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Toonic request failed: {}", e))?;

    resp.text()
        .await
        .map_err(|e| format!("Toonic response read error: {}", e))
}

/**
 * Motion Detection Pipeline — Tauri backend commands
 *
 * Manages Python subprocess running motion_pipeline.py.
 * Reads JSON events from stdout and forwards them to the frontend
 * via Tauri events.
 *
 * Commands:
 *   motion_pipeline_start  — start pipeline for a camera
 *   motion_pipeline_stop   — stop pipeline for a camera
 *   motion_pipeline_status — list active pipelines + stats
 *   motion_pipeline_stats  — query SQLite detections DB
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use crate::logging::{backend_info, backend_warn, backend_error};

// ── Shared state ──────────────────────────────────────────────────────────────

#[derive(Debug)]
struct PipelineProcess {
    child: Child,
    camera_id: String,
    rtsp_url: String,
    started_at: u64,
}

lazy_static::lazy_static! {
    static ref PIPELINES: Mutex<HashMap<String, PipelineProcess>> =
        Mutex::new(HashMap::new());
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── Request / Response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StartPipelineRequest {
    pub camera_id: String,
    pub rtsp_url: String,
    pub db_path: Option<String>,
    pub python_path: Option<String>,
    pub pipeline_script: Option<String>,
    pub process_every: Option<u32>,
    pub min_area: Option<u32>,
    pub max_area: Option<u32>,
    pub var_threshold: Option<u32>,
    pub bg_history: Option<u32>,
    pub llm_threshold: Option<f32>,
    pub cooldown_sec: Option<f32>,
    pub max_crop_px: Option<u32>,
    pub llm_model: Option<String>,
    pub api_key: Option<String>,
    pub platform: Option<String>,
    pub night_mode: Option<bool>,
    pub stats_interval: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct PipelineStatus {
    pub camera_id: String,
    pub rtsp_url: String,
    pub started_at: u64,
    pub running: bool,
}

#[derive(Debug, Serialize)]
pub struct PipelineListResult {
    pub pipelines: Vec<PipelineStatus>,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct DetectionRow {
    pub id: i64,
    pub timestamp: String,
    pub camera_id: String,
    pub label: String,
    pub confidence: f64,
    pub llm_label: Option<String>,
    pub llm_description: Option<String>,
    pub bbox_x1: i64,
    pub bbox_y1: i64,
    pub bbox_x2: i64,
    pub bbox_y2: i64,
    pub area: i64,
    pub sent_to_llm: bool,
    pub thumbnail_b64: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DetectionStats {
    pub total: i64,
    pub by_class: HashMap<String, i64>,
    pub by_hour: HashMap<String, i64>,
    pub unique_events_30s: i64,
    pub llm_sent: i64,
    pub llm_reduction_pct: f64,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn resolve_db_path(db_path: &str) -> String {
    if std::path::Path::new(db_path).is_absolute() {
        return db_path.to_string();
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        let full = data_dir.join("broxeen").join(db_path);
        if let Some(parent) = full.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        return full.to_string_lossy().to_string();
    }
    db_path.to_string()
}

fn resolve_script_path(script: &str) -> String {
    // Try relative to current exe dir, then cwd
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join(script);
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
            // Go up to project root (dev mode: target/debug/broxeen → ../../..)
            let candidate2 = exe_dir.join("../../../").join(script);
            if candidate2.exists() {
                return candidate2
                    .canonicalize()
                    .unwrap_or(candidate2)
                    .to_string_lossy()
                    .to_string();
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join(script);
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    script.to_string()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn motion_pipeline_start(
    app_handle: tauri::AppHandle,
    request: StartPipelineRequest,
) -> Result<String, String> {
    let camera_id = request.camera_id.clone();

    {
        let pipelines = PIPELINES.lock().map_err(|e| e.to_string())?;
        if pipelines.contains_key(&camera_id) {
            return Err(format!("Pipeline already running for camera: {}", camera_id));
        }
    }

    let python = request.python_path.unwrap_or_else(|| "python3".to_string());
    let script_rel = request
        .pipeline_script
        .unwrap_or_else(|| "scripts/motion_pipeline.py".to_string());
    let script = resolve_script_path(&script_rel);

    let db_raw = request
        .db_path
        .unwrap_or_else(|| "detections.db".to_string());
    let db = resolve_db_path(&db_raw);

    let process_every = request.process_every.unwrap_or(5).to_string();
    let min_area = request.min_area.unwrap_or(2000).to_string();
    let max_area = request.max_area.unwrap_or(200000).to_string();
    let var_threshold = request.var_threshold.unwrap_or(50).to_string();
    let bg_history = request.bg_history.unwrap_or(500).to_string();
    let llm_threshold = request.llm_threshold.unwrap_or(0.6).to_string();
    let cooldown = request.cooldown_sec.unwrap_or(10.0).to_string();
    let max_crop = request.max_crop_px.unwrap_or(500).to_string();
    let llm_model = request
        .llm_model
        .unwrap_or_else(|| "anthropic/claude-haiku-4-5".to_string());
    let platform = request.platform.unwrap_or_else(|| "auto".to_string());
    let stats_interval = request.stats_interval.unwrap_or(60).to_string();

    let mut cmd = Command::new(&python);
    cmd.arg(&script)
        .arg("--rtsp").arg(&request.rtsp_url)
        .arg("--camera-id").arg(&camera_id)
        .arg("--db").arg(&db)
        .arg("--platform").arg(&platform)
        .arg("--process-every").arg(&process_every)
        .arg("--min-area").arg(&min_area)
        .arg("--max-area").arg(&max_area)
        .arg("--var-threshold").arg(&var_threshold)
        .arg("--bg-history").arg(&bg_history)
        .arg("--llm-threshold").arg(&llm_threshold)
        .arg("--cooldown").arg(&cooldown)
        .arg("--max-crop").arg(&max_crop)
        .arg("--llm-model").arg(&llm_model)
        .arg("--stats-interval").arg(&stats_interval)
        .arg("--output-events")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if request.night_mode.unwrap_or(false) {
        cmd.arg("--night-mode");
    }

    if let Some(ref key) = request.api_key {
        if !key.is_empty() {
            cmd.arg("--api-key").arg(key);
        }
    }

    // Inherit OPENROUTER_API_KEY from environment
    if let Ok(env_key) = std::env::var("OPENROUTER_API_KEY") {
        cmd.env("OPENROUTER_API_KEY", env_key);
    }

    backend_info(format!(
        "Starting motion pipeline: camera={} rtsp={} script={}",
        camera_id, request.rtsp_url, script
    ));

    let mut child = cmd.spawn().map_err(|e| {
        backend_error(format!("Failed to spawn motion_pipeline.py: {}", e));
        format!("Failed to start pipeline: {}. Is python3 installed and opencv/ultralytics available?", e)
    })?;

    // Spawn stdout reader thread — forwards JSON events to frontend
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let cam_id_clone = camera_id.clone();
    let app_clone = app_handle.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    backend_info(format!("[motion:{}] {}", cam_id_clone, &l[..l.len().min(200)]));
                    use tauri::Emitter;
                    let _ = app_clone.emit("broxeen:motion_event", serde_json::json!({
                        "camera_id": cam_id_clone,
                        "raw": l,
                    }));
                }
                Err(e) => {
                    backend_warn(format!("[motion:{}] stdout read error: {}", cam_id_clone, e));
                    break;
                }
                _ => {}
            }
        }
        backend_info(format!("[motion:{}] stdout reader exited", cam_id_clone));
    });

    // Spawn stderr reader thread — logs warnings
    let stderr = child.stderr.take().ok_or("No stderr")?;
    let cam_id_err = camera_id.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(l) = line {
                if !l.trim().is_empty() {
                    backend_warn(format!("[motion:{}] {}", cam_id_err, l));
                }
            }
        }
    });

    let started_at = now_ms();
    let process = PipelineProcess {
        child,
        camera_id: camera_id.clone(),
        rtsp_url: request.rtsp_url.clone(),
        started_at,
    };

    {
        let mut pipelines = PIPELINES.lock().map_err(|e| e.to_string())?;
        pipelines.insert(camera_id.clone(), process);
    }

    backend_info(format!("Motion pipeline started for camera: {}", camera_id));
    Ok(format!("Pipeline started for camera: {}", camera_id))
}

#[tauri::command]
pub async fn motion_pipeline_stop(camera_id: String) -> Result<String, String> {
    let mut pipelines = PIPELINES.lock().map_err(|e| e.to_string())?;

    if let Some(mut process) = pipelines.remove(&camera_id) {
        backend_info(format!("Stopping motion pipeline for camera: {}", camera_id));
        let _ = process.child.kill();
        let _ = process.child.wait();
        backend_info(format!("Motion pipeline stopped for camera: {}", camera_id));
        Ok(format!("Pipeline stopped for camera: {}", camera_id))
    } else {
        Err(format!("No active pipeline for camera: {}", camera_id))
    }
}

#[tauri::command]
pub async fn motion_pipeline_status() -> Result<PipelineListResult, String> {
    let mut pipelines = PIPELINES.lock().map_err(|e| e.to_string())?;

    // Reap any finished processes
    let dead_keys: Vec<String> = pipelines
        .iter_mut()
        .filter_map(|(k, p)| {
            match p.child.try_wait() {
                Ok(Some(_)) => Some(k.clone()),
                _ => None,
            }
        })
        .collect();

    for k in &dead_keys {
        backend_warn(format!("Motion pipeline for camera {} exited unexpectedly", k));
        pipelines.remove(k);
    }

    let statuses: Vec<PipelineStatus> = pipelines
        .values()
        .map(|p| PipelineStatus {
            camera_id: p.camera_id.clone(),
            rtsp_url: p.rtsp_url.clone(),
            started_at: p.started_at,
            running: true,
        })
        .collect();

    let count = statuses.len();
    Ok(PipelineListResult {
        pipelines: statuses,
        count,
    })
}

#[tauri::command]
pub async fn motion_pipeline_stats(
    db_path: String,
    camera_id: Option<String>,
    hours: Option<u32>,
) -> Result<DetectionStats, String> {
    let db = resolve_db_path(&db_path);
    let hours = hours.unwrap_or(24);

    let conn = rusqlite::Connection::open(&db).map_err(|e| {
        format!("Cannot open detections DB at {}: {}", db, e)
    })?;

    let where_base = format!("timestamp > datetime('now', '-{} hours')", hours);
    let where_clause = if let Some(ref cam) = camera_id {
        format!("{} AND camera_id = '{}'", where_base, cam.replace('\'', "''"))
    } else {
        where_base
    };

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM detections WHERE {}", where_clause),
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let llm_sent: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM detections WHERE {} AND sent_to_llm=1",
                where_clause
            ),
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let mut by_class: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT label, COUNT(*) FROM detections WHERE {} GROUP BY label ORDER BY 2 DESC",
                where_clause
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            by_class.insert(row.0, row.1);
        }
    }

    let mut by_hour: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT strftime('%H', timestamp), COUNT(*) FROM detections WHERE {} GROUP BY 1",
                where_clause
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            by_hour.insert(row.0, row.1);
        }
    }

    let unique_events_30s: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(DISTINCT CAST(strftime('%s', timestamp) / 30 AS INTEGER) || '_' || label) \
                 FROM detections WHERE {} AND label IN ('person', 'car', 'truck')",
                where_clause
            ),
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let llm_reduction_pct = if total > 0 {
        ((1.0 - llm_sent as f64 / total as f64) * 100.0 * 10.0).round() / 10.0
    } else {
        0.0
    };

    Ok(DetectionStats {
        total,
        by_class,
        by_hour,
        unique_events_30s,
        llm_sent,
        llm_reduction_pct,
    })
}

#[tauri::command]
pub async fn motion_pipeline_detections(
    db_path: String,
    camera_id: Option<String>,
    label: Option<String>,
    hours: Option<u32>,
    limit: Option<u32>,
    include_thumbnails: Option<bool>,
) -> Result<Vec<DetectionRow>, String> {
    let db = resolve_db_path(&db_path);
    let hours = hours.unwrap_or(24);
    let limit = limit.unwrap_or(50);
    let include_thumbs = include_thumbnails.unwrap_or(false);

    let conn = rusqlite::Connection::open(&db).map_err(|e| {
        format!("Cannot open detections DB at {}: {}", db, e)
    })?;

    let mut conditions = vec![format!("timestamp > datetime('now', '-{} hours')", hours)];
    if let Some(ref cam) = camera_id {
        conditions.push(format!("camera_id = '{}'", cam.replace('\'', "''")));
    }
    if let Some(ref lbl) = label {
        conditions.push(format!("label = '{}'", lbl.replace('\'', "''")));
    }
    let where_clause = conditions.join(" AND ");

    let thumb_col = if include_thumbs { "thumbnail" } else { "NULL as thumbnail" };
    let sql = format!(
        "SELECT id, timestamp, camera_id, label, confidence, llm_label, llm_description, \
         bbox_x1, bbox_y1, bbox_x2, bbox_y2, area, sent_to_llm, {} \
         FROM detections WHERE {} ORDER BY timestamp DESC LIMIT {}",
        thumb_col, where_clause, limit
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let thumb_bytes: Option<Vec<u8>> = r.get(13).ok();
            Ok(DetectionRow {
                id: r.get(0)?,
                timestamp: r.get(1)?,
                camera_id: r.get(2)?,
                label: r.get(3)?,
                confidence: r.get(4)?,
                llm_label: r.get(5)?,
                llm_description: r.get(6)?,
                bbox_x1: r.get(7)?,
                bbox_y1: r.get(8)?,
                bbox_x2: r.get(9)?,
                bbox_y2: r.get(10)?,
                area: r.get(11)?,
                sent_to_llm: r.get::<_, i64>(12)? != 0,
                thumbnail_b64: thumb_bytes.map(|b| base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD, b
                )),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }

    Ok(result)
}

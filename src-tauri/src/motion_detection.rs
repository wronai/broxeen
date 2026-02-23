/**
 * Motion Detection Pipeline — Tauri backend commands
 *
 * When compiled with `vision` feature:
 *   Native Rust pipeline: RTSP → MOG2 → YOLOv8s (ONNX) → OpenRouter/Ollama LLM
 *
 * Without `vision` feature:
 *   Manages Python subprocess running motion_pipeline.py.
 *
 * Commands:
 *   motion_pipeline_start      — start pipeline for a camera
 *   motion_pipeline_stop       — stop pipeline for a camera
 *   motion_pipeline_status     — list active pipelines + stats
 *   motion_pipeline_stats      — query SQLite detections DB
 *   motion_pipeline_detections — get detection rows
 *   vision_query               — natural language → SQL → real DB results
 *   vision_query_direct        — run raw SQL SELECT on monitoring DB
 */

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[cfg(not(feature = "vision"))]
use std::io::{BufRead, BufReader};
#[cfg(not(feature = "vision"))]
use std::process::{Child, Command, Stdio};
#[cfg(not(feature = "vision"))]
use std::thread;

use crate::logging::{backend_info, backend_warn, backend_error};

// ── Shared state ──────────────────────────────────────────────────────────────

#[cfg(not(feature = "vision"))]
#[derive(Debug)]
struct PipelineProcess {
    child: Child,
    camera_id: String,
    rtsp_url: String,
    started_at: u64,
}

#[cfg(feature = "vision")]
struct NativePipeline {
    handle: crate::vision_pipeline::PipelineHandle,
}

#[cfg(not(feature = "vision"))]
lazy_static::lazy_static! {
    static ref PIPELINES: Mutex<HashMap<String, PipelineProcess>> =
        Mutex::new(HashMap::new());
}

#[cfg(feature = "vision")]
lazy_static::lazy_static! {
    static ref PIPELINES_NATIVE: Mutex<HashMap<String, NativePipeline>> =
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

#[cfg(feature = "vision")]
#[tauri::command]
pub async fn motion_pipeline_start(
    app_handle: tauri::AppHandle,
    request: StartPipelineRequest,
) -> Result<String, String> {
    let camera_id = request.camera_id.clone();

    {
        let pipelines = PIPELINES_NATIVE.lock().map_err(|e| e.to_string())?;
        if pipelines.contains_key(&camera_id) {
            return Err(format!("Pipeline already running for camera: {}", camera_id));
        }
    }

    backend_info(format!(
        "Starting native vision pipeline: camera={} rtsp={}",
        camera_id, request.rtsp_url
    ));

    // Build VisionConfig from StartPipelineRequest fields (v0.3)
    let mut vision_cfg = crate::vision_config::default_config();
    vision_cfg.camera.url = request.rtsp_url.clone();
    vision_cfg.camera.camera_id = camera_id.clone();
    vision_cfg.detector.confidence_threshold = request.llm_threshold.unwrap_or(0.50);
    vision_cfg.pipeline.process_every_n_frames = request.process_every.unwrap_or(4);
    vision_cfg.pipeline.bg_history = request.bg_history.unwrap_or(500) as i32;
    vision_cfg.pipeline.bg_var_threshold = request.var_threshold.unwrap_or(40) as f64;
    vision_cfg.database.path = request.db_path.unwrap_or_else(|| "monitoring.db".to_string());
    // LLM: prefer OpenRouter key from request or env
    if let Some(ref key) = request.api_key {
        if !key.is_empty() {
            vision_cfg.llm.openrouter_api_key = Some(key.clone());
        }
    }
    if vision_cfg.llm.openrouter_api_key.is_none() {
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            if !key.is_empty() { vision_cfg.llm.openrouter_api_key = Some(key); }
        }
    }
    if let Some(ref model) = request.llm_model {
        vision_cfg.llm.openrouter_model = model.clone();
    }

    let pipeline = crate::vision_pipeline::Pipeline::new(vision_cfg);
    let handle = pipeline.start(Some(app_handle)).map_err(|e| {
        backend_error(format!("Failed to start native vision pipeline: {}", e));
        format!("Failed to start pipeline: {}", e)
    })?;

    {
        let mut pipelines = PIPELINES_NATIVE.lock().map_err(|e| e.to_string())?;
        pipelines.insert(camera_id.clone(), NativePipeline { handle });
    }

    backend_info(format!("Native vision pipeline started for camera: {}", camera_id));
    Ok(format!("Pipeline started for camera: {} (native Rust)", camera_id))
}

#[cfg(not(feature = "vision"))]
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
    Ok(format!("Pipeline started for camera: {} (Python)", camera_id))
}

#[cfg(feature = "vision")]
#[tauri::command]
pub async fn motion_pipeline_stop(camera_id: String) -> Result<String, String> {
    let mut pipelines = PIPELINES_NATIVE.lock().map_err(|e| e.to_string())?;

    if let Some(native) = pipelines.remove(&camera_id) {
        backend_info(format!("Stopping native vision pipeline for camera: {}", camera_id));
        native.handle.stop();
        backend_info(format!("Native vision pipeline stopped for camera: {}", camera_id));
        Ok(format!("Pipeline stopped for camera: {}", camera_id))
    } else {
        Err(format!("No active pipeline for camera: {}", camera_id))
    }
}

#[cfg(not(feature = "vision"))]
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

#[cfg(feature = "vision")]
#[tauri::command]
pub async fn motion_pipeline_status() -> Result<PipelineListResult, String> {
    let pipelines = PIPELINES_NATIVE.lock().map_err(|e| e.to_string())?;

    let statuses: Vec<PipelineStatus> = pipelines
        .values()
        .map(|n| PipelineStatus {
            camera_id: n.handle.camera_id.clone(),
            rtsp_url: n.handle.rtsp_url.clone(),
            started_at: n.handle.started_at,
            running: true,
        })
        .collect();

    let count = statuses.len();
    Ok(PipelineListResult {
        pipelines: statuses,
        count,
    })
}

#[cfg(not(feature = "vision"))]
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

// ── Vision Query commands ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct VisionQueryResult {
    pub question: String,
    pub sql: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    pub source: String,
}

/// Natural language → SQL → real DB results.
/// Uses LLM text-to-SQL to convert the question, then executes against monitoring.db.
/// Falls back to direct keyword-based SQL if LLM is unavailable.
#[tauri::command]
pub async fn vision_query(
    question: String,
    db_path: Option<String>,
) -> Result<VisionQueryResult, String> {
    let db_file = db_path.unwrap_or_else(|| "monitoring.db".to_string());
    let resolved = resolve_db_path(&db_file);

    // Open the DB directly with rusqlite (works with both old and new schema)
    let conn = rusqlite::Connection::open(&resolved).map_err(|e| {
        format!("Cannot open monitoring DB at {}: {}", resolved, e)
    })?;

    // Try to detect schema version by checking for new columns
    let has_new_schema = conn
        .prepare("SELECT track_id FROM detections LIMIT 1")
        .is_ok();

    // Convert natural language to SQL using keyword matching (no LLM needed)
    let sql = nl_to_sql(&question, has_new_schema);

    // Execute the query
    let mut stmt = conn.prepare(&sql).map_err(|e| {
        format!("SQL error: {} — query: {}", e, sql)
    })?;

    let col_names: Vec<String> = stmt.column_names()
        .into_iter().map(String::from).collect();

    let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
        let n = row.as_ref().column_count();
        let mut vals = Vec::with_capacity(n);
        for i in 0..n {
            let v = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null)       => "—".into(),
                Ok(rusqlite::types::ValueRef::Integer(i))  => i.to_string(),
                Ok(rusqlite::types::ValueRef::Real(f))     => format!("{:.2}", f),
                Ok(rusqlite::types::ValueRef::Text(t))     => String::from_utf8_lossy(t).into_owned(),
                Ok(rusqlite::types::ValueRef::Blob(b))     => format!("[BLOB {}B]", b.len()),
                Err(_) => "?".into(),
            };
            vals.push(v);
        }
        Ok(vals)
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    let row_count = rows.len();

    Ok(VisionQueryResult {
        question,
        sql,
        columns: col_names,
        rows,
        row_count,
        source: resolved,
    })
}

/// Run a raw SQL SELECT on the monitoring DB (for advanced users / frontend).
#[tauri::command]
pub async fn vision_query_direct(
    sql: String,
    db_path: Option<String>,
) -> Result<VisionQueryResult, String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("SELECT") && !trimmed.starts_with("WITH") {
        return Err("Only SELECT queries are allowed".into());
    }

    let db_file = db_path.unwrap_or_else(|| "monitoring.db".to_string());
    let resolved = resolve_db_path(&db_file);

    let conn = rusqlite::Connection::open(&resolved).map_err(|e| {
        format!("Cannot open monitoring DB at {}: {}", resolved, e)
    })?;

    let mut stmt = conn.prepare(&sql).map_err(|e| {
        format!("SQL error: {} — query: {}", e, sql)
    })?;

    let col_names: Vec<String> = stmt.column_names()
        .into_iter().map(String::from).collect();

    let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
        let n = row.as_ref().column_count();
        let mut vals = Vec::with_capacity(n);
        for i in 0..n {
            let v = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null)       => "—".into(),
                Ok(rusqlite::types::ValueRef::Integer(i))  => i.to_string(),
                Ok(rusqlite::types::ValueRef::Real(f))     => format!("{:.2}", f),
                Ok(rusqlite::types::ValueRef::Text(t))     => String::from_utf8_lossy(t).into_owned(),
                Ok(rusqlite::types::ValueRef::Blob(b))     => format!("[BLOB {}B]", b.len()),
                Err(_) => "?".into(),
            };
            vals.push(v);
        }
        Ok(vals)
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    let row_count = rows.len();

    Ok(VisionQueryResult {
        question: "(direct SQL)".into(),
        sql,
        columns: col_names,
        rows,
        row_count,
        source: resolved,
    })
}

/// Keyword-based natural language → SQL converter.
/// Works without LLM — pattern matches common Polish monitoring questions.
fn nl_to_sql(question: &str, new_schema: bool) -> String {
    let q = question.to_lowercase();

    // ── "last person" / "when did someone enter" ─────────────────────────
    if (q.contains("ostatni") || q.contains("kiedy") || q.contains("o której") || q.contains("o ktorej"))
        && (q.contains("osob") || q.contains("ktoś") || q.contains("ktos") || q.contains("wszed") || q.contains("weszł") || q.contains("weszl") || q.contains("człowiek") || q.contains("czlowiek"))
    {
        return if new_schema {
            "SELECT id, timestamp, camera_id, track_id, label, confidence, movement, direction, duration_s \
             FROM detections WHERE label='person' ORDER BY timestamp DESC LIMIT 5".into()
        } else {
            "SELECT id, timestamp, camera_id, label, confidence, llm_label, llm_description \
             FROM detections WHERE label='person' ORDER BY timestamp DESC LIMIT 5".into()
        };
    }

    // ── "how many people today" ──────────────────────────────────────────
    if (q.contains("ile") || q.contains("policz") || q.contains("liczba"))
        && (q.contains("osób") || q.contains("osob") || q.contains("ludzi") || q.contains("person"))
    {
        let date_filter = if q.contains("dzisiaj") || q.contains("dziś") || q.contains("dzis") || q.contains("today") {
            if new_schema { "AND local_date = date('now','localtime')" } else { "AND date(timestamp) = date('now')" }
        } else if q.contains("wczoraj") || q.contains("yesterday") {
            if new_schema { "AND local_date = date('now','-1 day','localtime')" } else { "AND date(timestamp) = date('now','-1 day')" }
        } else {
            // Check for time-based filters like "10 minut", "5 minut", etc.
            let filter = extract_date_filter(&q, new_schema);
            return format!(
                "SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen \
                 FROM detections WHERE label='person' {}", filter
            );
        };
        return format!(
            "SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen \
             FROM detections WHERE label='person' {}", date_filter
        );
    }

    // ── "show cars" / "samochody" ────────────────────────────────────────
    if q.contains("samochod") || q.contains("samochód") || (q.contains("car") && !q.contains("card")) || q.contains("auto ") || q.contains("auta") {
        let date_filter = extract_date_filter(&q, new_schema);
        return if new_schema {
            format!("SELECT id, timestamp, camera_id, track_id, label, confidence, movement, direction, duration_s \
                     FROM detections WHERE label IN ('car','truck','bus') {} ORDER BY timestamp DESC LIMIT 20", date_filter)
        } else {
            format!("SELECT id, timestamp, camera_id, label, confidence, llm_label \
                     FROM detections WHERE label IN ('car','truck','bus') {} ORDER BY timestamp DESC LIMIT 20", date_filter)
        };
    }

    // ── "show all between hours" / "między godzinami" ────────────────────
    if q.contains("między") || q.contains("miedzy") || q.contains("between") {
        // Try to extract hour range
        let re = regex_lite::Regex::new(r"(\d{1,2})[:.:]?(\d{2})?\s*(?:a|i|do|-|—)\s*(\d{1,2})[:.:]?(\d{2})?").ok();
        if let Some(caps) = re.and_then(|r| r.captures(&q)) {
            let h1: String = caps.get(1).map(|m| m.as_str()).unwrap_or("0").to_string();
            let m1: String = caps.get(2).map(|m| m.as_str()).unwrap_or("00").to_string();
            let h2: String = caps.get(3).map(|m| m.as_str()).unwrap_or("23").to_string();
            let m2: String = caps.get(4).map(|m| m.as_str()).unwrap_or("59").to_string();
            return if new_schema {
                format!("SELECT id, timestamp, camera_id, label, confidence, movement, direction \
                         FROM detections WHERE time(timestamp) BETWEEN '{h1:0>2}:{m1:0>2}' AND '{h2:0>2}:{m2:0>2}' \
                         ORDER BY timestamp DESC LIMIT 50")
            } else {
                format!("SELECT id, timestamp, camera_id, label, confidence, llm_label \
                         FROM detections WHERE time(timestamp) BETWEEN '{h1:0>2}:{m1:0>2}' AND '{h2:0>2}:{m2:0>2}' \
                         ORDER BY timestamp DESC LIMIT 50")
            };
        }
    }

    // ── "most active hours" / "najbardziej aktywne" ──────────────────────
    if q.contains("aktywn") || q.contains("godzin") || q.contains("active") || q.contains("peak") {
        return if new_schema {
            "SELECT local_hour as hour, COUNT(*) as detections, \
             COUNT(DISTINCT track_id) as unique_objects \
             FROM detections GROUP BY local_hour ORDER BY detections DESC".into()
        } else {
            "SELECT strftime('%H', timestamp) as hour, COUNT(*) as detections \
             FROM detections GROUP BY hour ORDER BY detections DESC".into()
        };
    }

    // ── "last N detections" / "ostatnie wykrycia" ────────────────────────
    if q.contains("ostatni") || q.contains("recent") || q.contains("pokaz") || q.contains("pokaż") || q.contains("wyświetl") {
        let limit = extract_limit(&q).unwrap_or(10);
        let label_filter = extract_label_filter(&q);
        let date_filter = extract_date_filter(&q, new_schema);
        return if new_schema {
            format!("SELECT id, timestamp, camera_id, track_id, label, confidence, movement, direction, speed_label, duration_s \
                     FROM detections WHERE 1=1 {}{} ORDER BY timestamp DESC LIMIT {}", label_filter, date_filter, limit)
        } else {
            format!("SELECT id, timestamp, camera_id, label, confidence, llm_label, llm_description \
                     FROM detections WHERE 1=1 {}{} ORDER BY timestamp DESC LIMIT {}", label_filter, date_filter, limit)
        };
    }

    // ── "statistics" / "statystyki" ──────────────────────────────────────
    if q.contains("statyst") || q.contains("podsumow") || q.contains("summary") || q.contains("stats") {
        return if new_schema {
            "SELECT label, COUNT(*) as count, \
             COUNT(DISTINCT track_id) as unique_tracks, \
             ROUND(AVG(confidence),2) as avg_conf, \
             MIN(timestamp) as first, MAX(timestamp) as last \
             FROM detections GROUP BY label ORDER BY count DESC".into()
        } else {
            "SELECT label, COUNT(*) as count, \
             ROUND(AVG(confidence),2) as avg_conf, \
             MIN(timestamp) as first, MAX(timestamp) as last \
             FROM detections GROUP BY label ORDER BY count DESC".into()
        };
    }

    // ── "which cameras" / "ile kamer" ────────────────────────────────────
    if q.contains("kamer") || q.contains("camera") {
        return "SELECT camera_id, COUNT(*) as detections, \
                MIN(timestamp) as first, MAX(timestamp) as last \
                FROM detections GROUP BY camera_id ORDER BY detections DESC".into();
    }

    // ── LLM events / narratives ──────────────────────────────────────────
    if new_schema && (q.contains("narr") || q.contains("llm") || q.contains("opis") || q.contains("description")) {
        return "SELECT id, timestamp, camera_id, narrative, provider, crops_sent \
                FROM llm_events ORDER BY timestamp DESC LIMIT 10".into();
    }

    // ── Fallback: show recent detections ─────────────────────────────────
    if new_schema {
        format!("SELECT id, timestamp, camera_id, track_id, label, confidence, movement, direction, duration_s \
                 FROM detections ORDER BY timestamp DESC LIMIT 10")
    } else {
        format!("SELECT id, timestamp, camera_id, label, confidence, llm_label, llm_description \
                 FROM detections ORDER BY timestamp DESC LIMIT 10")
    }
}

fn extract_date_filter(q: &str, new_schema: bool) -> String {
    if q.contains("dzisiaj") || q.contains("dziś") || q.contains("dzis") || q.contains("today") {
        if new_schema { " AND local_date = date('now','localtime')".into() }
        else { " AND date(timestamp) = date('now')".into() }
    } else if q.contains("wczoraj") || q.contains("yesterday") {
        if new_schema { " AND local_date = date('now','-1 day','localtime')".into() }
        else { " AND date(timestamp) = date('now','-1 day')".into() }
    } else if q.contains("10 minut") || q.contains("10 min") || q.contains("dziesięć minut") || q.contains("dziesiec minut") {
        " AND timestamp > datetime('now', '-10 minutes')".into()
    } else if q.contains("5 minut") || q.contains("5 min") || q.contains("pięć minut") || q.contains("piec minut") {
        " AND timestamp > datetime('now', '-5 minutes')".into()
    } else if q.contains("30 minut") || q.contains("30 min") || q.contains("pół godziny") || q.contains("pol godziny") {
        " AND timestamp > datetime('now', '-30 minutes')".into()
    } else if q.contains("2 godzin") || q.contains("dwóch godzin") || q.contains("2h") {
        " AND timestamp > datetime('now', '-2 hours')".into()
    } else if q.contains("godzin") || q.contains("1h") || q.contains("hour") {
        " AND timestamp > datetime('now', '-1 hours')".into()
    } else {
        String::new()
    }
}

fn extract_label_filter(q: &str) -> String {
    if q.contains("osob") || q.contains("osób") || q.contains("person") || q.contains("ludzi") {
        " AND label='person'".into()
    } else if q.contains("samochod") || q.contains("car") || q.contains("auto") {
        " AND label IN ('car','truck','bus')".into()
    } else if q.contains("rower") || q.contains("bicycle") {
        " AND label='bicycle'".into()
    } else if q.contains("pies") || q.contains("dog") {
        " AND label='dog'".into()
    } else if q.contains("kot") || q.contains("cat") {
        " AND label='cat'".into()
    } else {
        String::new()
    }
}

fn extract_limit(q: &str) -> Option<u32> {
    let re = regex_lite::Regex::new(r"(\d+)\s*(ostatni|recent|wykry|detect|rekord|record|wynik)").ok()?;
    re.captures(q).and_then(|c| c.get(1)?.as_str().parse().ok())
        .or_else(|| {
            let re2 = regex_lite::Regex::new(r"(ostatni|recent|pokaz|pokaż)\s*(\d+)").ok()?;
            re2.captures(q).and_then(|c| c.get(2)?.as_str().parse().ok())
        })
}

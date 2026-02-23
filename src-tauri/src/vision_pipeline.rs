/// Vision Pipeline — Full async orchestration
///
/// Architecture:
///   RTSP capture (blocking thread)
///     → motion detection (MOG2)
///     → crop + JPEG encode
///     → [flume channel] → detection worker (ONNX YOLOv8n)
///       → confidence ≥ threshold → save to SQLite
///       → confidence < threshold → [flume channel] → LLM worker (Claude Haiku)
///         → update SQLite with LLM verification
///
/// Emits `broxeen:vision_detection` events to the Tauri frontend.

use anyhow::Result;
use opencv::{
    core::Vector,
    imgcodecs::IMWRITE_JPEG_QUALITY,
    prelude::*,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::watch;
use tracing::{debug, info, warn};

use crate::vision_capture::CaptureStream;
use crate::vision_config::VisionConfig;
use crate::vision_db::VisionDatabase;
use crate::vision_detector::{Detector, ObjectClass};
use crate::vision_llm::LlmClient;
use crate::vision_motion::MotionDetector;

// ─── Messages flowing through pipeline channels ─────────────────────────────

struct WorkItem {
    camera_id: String,
    jpeg_bytes: Vec<u8>,
    bbox: (i32, i32, i32, i32),
    area: i64,
}

struct LlmWorkItem {
    detection_id: i64,
    jpeg_bytes: Vec<u8>,
    local_label: String,
    camera_id: String,
}

// ─── Pipeline handle returned to Tauri commands ─────────────────────────────

/// A running pipeline that can be stopped via the stop signal.
pub struct PipelineHandle {
    pub camera_id: String,
    pub rtsp_url: String,
    pub started_at: u64,
    stop_tx: watch::Sender<bool>,
}

impl PipelineHandle {
    /// Signal the pipeline to stop.
    pub fn stop(&self) {
        let _ = self.stop_tx.send(true);
    }
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

pub struct Pipeline {
    cfg: VisionConfig,
}

impl Pipeline {
    pub fn new(cfg: VisionConfig) -> Self {
        Self { cfg }
    }

    /// Start the pipeline in background tasks. Returns a handle to stop it.
    ///
    /// If `app_handle` is provided, detection events are emitted to the frontend.
    pub fn start(
        self,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<PipelineHandle> {
        let cfg = Arc::new(self.cfg);
        let (stop_tx, stop_rx) = watch::channel(false);

        // Shared database
        let db = Arc::new(std::sync::Mutex::new(
            VisionDatabase::open(&cfg.database.path)?,
        ));

        // Channel: capture → detection (bounded, drop old frames under load)
        let (detect_tx, detect_rx) = flume::bounded::<WorkItem>(16);

        // Channel: detection → LLM (small buffer)
        let (llm_tx, llm_rx) = flume::bounded::<LlmWorkItem>(8);

        let camera_id = cfg.camera.camera_id.clone();
        let rtsp_url = cfg.camera.url.clone();

        // ── Spawn LLM worker ────────────────────────────────────────────────
        let llm_db = Arc::clone(&db);
        let llm_cfg = cfg.clone();
        let llm_app = app_handle.clone();
        tokio::spawn(async move {
            match LlmClient::new(&llm_cfg.llm) {
                Ok(client) => {
                    while let Ok(item) = llm_rx.recv_async().await {
                        match client
                            .classify_object(
                                &item.jpeg_bytes,
                                &item.local_label,
                                &item.camera_id,
                            )
                            .await
                        {
                            Ok(result) => {
                                let db = llm_db.lock().unwrap();
                                if let Err(e) = db.update_llm_result(
                                    item.detection_id,
                                    &result.label,
                                    &result.description,
                                ) {
                                    warn!("DB update error: {}", e);
                                } else {
                                    info!(
                                        "LLM verified det#{}: {} → {} ({})",
                                        item.detection_id,
                                        item.local_label,
                                        result.label,
                                        result.description
                                    );
                                    // Emit LLM verification event
                                    if let Some(ref app) = llm_app {
                                        use tauri::Emitter;
                                        let _ = app.emit(
                                            "broxeen:vision_llm_result",
                                            serde_json::json!({
                                                "detection_id": item.detection_id,
                                                "camera_id": item.camera_id,
                                                "local_label": item.local_label,
                                                "llm_label": result.label,
                                                "llm_description": result.description,
                                            }),
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("LLM error for det#{}: {}", item.detection_id, e)
                            }
                        }
                    }
                }
                Err(e) => {
                    warn!("LLM client init failed (running without LLM): {}", e)
                }
            }
        });

        // ── Spawn detection worker ──────────────────────────────────────────
        let det_db = Arc::clone(&db);
        let det_cfg = cfg.clone();
        let det_app = app_handle.clone();
        tokio::task::spawn_blocking(move || {
            let use_openvino = cfg!(feature = "openvino");
            let detector = match Detector::new(
                &det_cfg.detector.model_path,
                det_cfg.detector.max_input_size,
                det_cfg.detector.confidence_threshold,
                det_cfg.detector.nms_threshold,
                use_openvino,
            ) {
                Ok(d) => d,
                Err(e) => {
                    warn!("Detector init failed: {}", e);
                    return;
                }
            };

            while let Ok(item) = detect_rx.recv() {
                match detector.detect_from_jpeg(&item.jpeg_bytes) {
                    Ok(Some(det)) => {
                        let label = det.class.as_str().to_string();
                        let confidence = det.confidence;

                        // Save to DB
                        let id = {
                            let db = det_db.lock().unwrap();
                            db.insert_detection(
                                &item.camera_id,
                                &label,
                                confidence,
                                &item.jpeg_bytes,
                                item.bbox,
                                item.area,
                            )
                        };

                        match id {
                            Ok(det_id) => {
                                info!(
                                    "Detected: {} ({:.0}%) cam={} area={}",
                                    label,
                                    confidence * 100.0,
                                    item.camera_id,
                                    item.area
                                );

                                // Emit detection event to frontend
                                if let Some(ref app) = det_app {
                                    use tauri::Emitter;
                                    let _ = app.emit(
                                        "broxeen:vision_detection",
                                        serde_json::json!({
                                            "detection_id": det_id,
                                            "camera_id": item.camera_id,
                                            "label": label,
                                            "confidence": confidence,
                                            "bbox": item.bbox,
                                            "area": item.area,
                                        }),
                                    );
                                }

                                // Send to LLM only if low confidence or unknown
                                if confidence < det_cfg.detector.confidence_threshold
                                    || det.class == ObjectClass::Unknown
                                {
                                    let _ = llm_tx.try_send(LlmWorkItem {
                                        detection_id: det_id,
                                        jpeg_bytes: item.jpeg_bytes,
                                        local_label: label,
                                        camera_id: item.camera_id,
                                    });
                                }
                            }
                            Err(e) => warn!("DB insert error: {}", e),
                        }
                    }
                    Ok(None) => debug!("No detection in crop"),
                    Err(e) => warn!("Detector error: {}", e),
                }
            }
        });

        // ── Spawn capture loop (blocking thread) ────────────────────────────
        let cap_cfg = cfg.clone();
        let mut stop_rx_cap = stop_rx.clone();
        tokio::task::spawn_blocking(move || {
            let cam = &cap_cfg.camera;
            let mut stream = match CaptureStream::open(
                &cam.url,
                &cam.camera_id,
                cap_cfg.pipeline.process_every_n_frames,
            ) {
                Ok(s) => s,
                Err(e) => {
                    warn!("Failed to open camera stream: {}", e);
                    return;
                }
            };

            let mut motion = match MotionDetector::new(
                cap_cfg.pipeline.bg_history,
                cap_cfg.pipeline.bg_var_threshold,
                cap_cfg.pipeline.min_contour_area,
                cap_cfg.pipeline.max_contour_area,
                cap_cfg.detector.max_input_size,
            ) {
                Ok(m) => m,
                Err(e) => {
                    warn!("Failed to init motion detector: {}", e);
                    return;
                }
            };

            // Per-area-bucket cooldown tracker
            let mut cooldowns: HashMap<String, Instant> = HashMap::new();
            let cooldown_dur =
                std::time::Duration::from_secs(cap_cfg.pipeline.cooldown_seconds);

            info!("Pipeline running. Camera: {}", cam.camera_id);

            loop {
                // Check stop signal (non-blocking)
                if *stop_rx_cap.borrow() {
                    info!("Pipeline stop signal received for {}", cam.camera_id);
                    break;
                }

                let frame = match stream.next_frame() {
                    Ok(Some(f)) => f,
                    Ok(None) => continue, // skipped frame
                    Err(e) => {
                        warn!("Capture error: {} — reconnecting", e);
                        match stream.reconnect() {
                            Ok(_) => continue,
                            Err(re) => {
                                warn!("Reconnect failed: {}", re);
                                break;
                            }
                        }
                    }
                };

                let objects = match motion.process_frame(&frame) {
                    Ok(o) => o,
                    Err(e) => {
                        warn!("Motion error: {}", e);
                        continue;
                    }
                };

                for obj in objects {
                    // Encode crop to JPEG
                    let mut buf: Vector<u8> = Vector::new();
                    let params: Vector<i32> = Vector::from_iter([IMWRITE_JPEG_QUALITY, 75]);

                    if let Err(e) =
                        opencv::imgcodecs::imencode(".jpg", &obj.crop, &mut buf, &params)
                    {
                        warn!("JPEG encode error: {}", e);
                        continue;
                    }
                    let jpeg = buf.to_vec();

                    // Skip tiny crops (noise)
                    if jpeg.len() < 512 {
                        continue;
                    }

                    // Area-based rate limit to avoid flooding the channel
                    let area_key = format!("area_{}", (obj.area as i64 / 5000) * 5000);
                    let now = Instant::now();
                    if let Some(last) = cooldowns.get(&area_key) {
                        if now.duration_since(*last) < cooldown_dur {
                            continue;
                        }
                    }
                    cooldowns.insert(area_key, now);

                    // Non-blocking send — drop if detection worker is overwhelmed
                    let _ = detect_tx.try_send(WorkItem {
                        camera_id: cam.camera_id.clone(),
                        jpeg_bytes: jpeg,
                        bbox: obj.bbox,
                        area: obj.area as i64,
                    });
                }
            }

            info!("Capture loop exited for camera {}", cam.camera_id);
        });

        let started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        Ok(PipelineHandle {
            camera_id,
            rtsp_url,
            started_at,
            stop_tx,
        })
    }
}

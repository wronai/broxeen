use anyhow::Result;
use opencv::{
    imgcodecs::{self, IMWRITE_JPEG_QUALITY},
    core::Vector,
    prelude::*,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::{
    capture::CaptureStream,
    config::AppConfig,
    database::Database,
    detector::{Detector, ObjectClass},
    llm::LlmClient,
    motion::MotionDetector,
};

// ─── Messages flowing through pipeline channels ─────────────────────────────

/// Sent from capture thread → detection worker
struct WorkItem {
    camera_id: String,
    jpeg_bytes: Vec<u8>,       // crop JPEG ≤ 500px
    bbox: (i32, i32, i32, i32),
    area: i64,
}

/// Sent from detection worker → LLM worker
struct LlmWorkItem {
    detection_id: i64,
    jpeg_bytes: Vec<u8>,
    local_label: String,
    camera_id: String,
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

pub struct Pipeline {
    cfg: AppConfig,
}

impl Pipeline {
    pub fn new(cfg: AppConfig) -> Self {
        Self { cfg }
    }

    /// Run the full pipeline. Blocks until error or Ctrl-C.
    pub async fn run(self) -> Result<()> {
        let cfg = Arc::new(self.cfg);

        // Shared database
        let db = Arc::new(std::sync::Mutex::new(
            Database::open(&cfg.database.path)?
        ));

        // Channel: capture → detection (bounded, drop old frames under load)
        let (detect_tx, detect_rx) = flume::bounded::<WorkItem>(16);

        // Channel: detection → LLM (small buffer — LLM calls are slow)
        let (llm_tx, llm_rx) = flume::bounded::<LlmWorkItem>(8);

        // ── Spawn LLM worker ─────────────────────────────────────────────
        let llm_db = Arc::clone(&db);
        let llm_cfg = cfg.clone();
        let llm_handle = tokio::spawn(async move {
            match LlmClient::new(&llm_cfg.llm) {
                Ok(client) => {
                    while let Ok(item) = llm_rx.recv_async().await {
                        match client.classify_object(
                            &item.jpeg_bytes,
                            &item.local_label,
                            &item.camera_id,
                        ).await {
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
                                        item.detection_id, item.local_label,
                                        result.label, result.description
                                    );
                                }
                            }
                            Err(e) => warn!("LLM error for det#{}: {}", item.detection_id, e),
                        }
                    }
                }
                Err(e) => warn!("LLM client init failed (running without LLM): {}", e),
            }
        });

        // ── Spawn detection worker(s) ─────────────────────────────────────
        let det_db = Arc::clone(&db);
        let det_cfg = cfg.clone();
        let det_handle = tokio::task::spawn_blocking(move || {
            let use_openvino = cfg!(feature = "openvino");
            let detector = Detector::new(
                &det_cfg.detector.model_path,
                det_cfg.detector.max_input_size,
                det_cfg.detector.confidence_threshold,
                det_cfg.detector.nms_threshold,
                use_openvino,
            )?;

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
                                    label, confidence * 100.0, item.camera_id, item.area
                                );

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
            Ok::<_, anyhow::Error>(())
        });

        // ── Capture loop (blocking, main thread) ─────────────────────────
        let cam = &cfg.camera;
        let mut stream = CaptureStream::open(
            &cam.url,
            &cam.camera_id,
            cfg.pipeline.process_every_n_frames,
        )?;

        let mut motion = MotionDetector::new(
            cfg.pipeline.bg_history,
            cfg.pipeline.bg_var_threshold,
            cfg.pipeline.min_contour_area,
            cfg.pipeline.max_contour_area,
            cfg.detector.max_input_size,
        )?;

        // Per-label cooldown tracker
        let mut cooldowns: HashMap<String, Instant> = HashMap::new();
        let cooldown_dur = std::time::Duration::from_secs(cfg.pipeline.cooldown_seconds);

        info!("Pipeline running. Camera: {}", cam.camera_id);

        loop {
            let frame = match stream.next_frame() {
                Ok(Some(f)) => f,
                Ok(None)    => continue, // skipped frame
                Err(e) => {
                    warn!("Capture error: {} — reconnecting", e);
                    stream.reconnect()?;
                    continue;
                }
            };

            let objects = match motion.process_frame(&frame) {
                Ok(o)  => o,
                Err(e) => { warn!("Motion error: {}", e); continue; }
            };

            for obj in objects {
                // Encode crop to JPEG
                let mut buf: Vector<u8> = Vector::new();
                let params: Vector<i32> = vec![
                    IMWRITE_JPEG_QUALITY, 75,
                ].into_iter().collect::<Vector<i32>>();

                if let Err(e) = imgcodecs::imencode(".jpg", &obj.crop, &mut buf, &params) {
                    warn!("JPEG encode error: {}", e);
                    continue;
                }
                let jpeg = buf.to_vec();

                // Quick local pre-filter before even going to ONNX:
                // skip tiny crops that are clearly noise
                if jpeg.len() < 512 {
                    continue;
                }

                // Cooldown check per-label happens post-detection in the
                // detect worker. Here we do a simple area-based rate limit
                // to avoid flooding the channel.
                let area_key = format!("area_{}", (obj.area / 5000) * 5000); // bucket
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
    }
}

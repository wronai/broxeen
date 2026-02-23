//! Main pipeline — two-track architecture (v0.3):
//!
//! Track A (immediate): YOLO detection → tracker → movement analysis → DB (detections)
//! Track B (1/min):     MinuteBuffer → LLM (OpenRouter / local) → DB (llm_events)
//!
//! Emits `broxeen:vision_detection` and `broxeen:vision_llm_result` events to frontend.

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::watch;
use tracing::{info, warn};

use crate::vision_capture::CaptureStream;
use crate::vision_config::VisionConfig;
use crate::vision_db::VisionDatabase;
use crate::vision_detector::Detector;
use crate::vision_llm::LlmClient;
use crate::vision_movement;
use crate::vision_scene_buffer::{MinuteBuffer, ObjectEvent};
use crate::vision_tracker::Tracker;

/// Message from blocking capture thread → async LLM worker.
struct TrackMsg {
    track:     crate::vision_tracker::CompletedTrack,
    camera_id: String,
}

// ─── Pipeline handle returned to Tauri commands ─────────────────────────────

pub struct PipelineHandle {
    pub camera_id: String,
    pub rtsp_url: String,
    pub started_at: u64,
    stop_tx: watch::Sender<bool>,
}

impl PipelineHandle {
    pub fn stop(&self) {
        let _ = self.stop_tx.send(true);
    }
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

pub struct Pipeline {
    cfg: VisionConfig,
}

impl Pipeline {
    pub fn new(cfg: VisionConfig) -> Self { Self { cfg } }

    pub fn start(
        self,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<PipelineHandle> {
        let cfg = Arc::new(self.cfg);
        let (stop_tx, stop_rx) = watch::channel(false);

        let db = Arc::new(std::sync::Mutex::new(
            VisionDatabase::open(&cfg.database.path)?,
        ));
        let llm = Arc::new(LlmClient::from_config(&cfg.llm));

        // Async channel: completed tracks → LLM/scene worker
        let (track_tx, mut track_rx) = tokio::sync::mpsc::channel::<TrackMsg>(64);

        let camera_id = cfg.camera.camera_id.clone();
        let rtsp_url = cfg.camera.url.clone();

        // ── Async worker: per-minute LLM batching (Track B) ─────────────
        let worker_db = Arc::clone(&db);
        let worker_llm = Arc::clone(&llm);
        let worker_cfg = cfg.clone();
        let worker_app = app_handle.clone();

        tokio::spawn(async move {
            let mut buf = MinuteBuffer::new(
                worker_cfg.scene.flush_interval_secs,
                worker_cfg.scene.ring_capacity,
                worker_cfg.scene.min_crops_for_llm,
            );

            loop {
                // Drain all pending completed tracks
                loop {
                    match track_rx.try_recv() {
                        Ok(msg) => {
                            let summary = vision_movement::analyse_movement(&msg.track);
                            let mv_tag = vision_movement::movement_tag(&summary, &msg.track.class);

                            // ── Track A: save to DB immediately ──────────
                            let thumbnail = msg.track.crops.first()
                                .map(|c| c.jpeg_bytes.clone())
                                .unwrap_or_default();

                            {
                                let db = worker_db.lock().unwrap();
                                if let Err(e) = db.insert_detection(
                                    &msg.camera_id,
                                    &msg.track.id.to_string(),
                                    &msg.track.class,
                                    msg.track.confidence,
                                    Some(&mv_tag),
                                    Some(&summary.direction),
                                    Some(summary.speed_label),
                                    Some(&summary.entry_zone),
                                    Some(&summary.exit_zone),
                                    summary.duration_secs,
                                    &thumbnail,
                                ) {
                                    warn!("DB insert_detection: {}", e);
                                } else {
                                    info!(
                                        "✓ Local: {} [{:.0}%] {} cam={}",
                                        msg.track.class,
                                        msg.track.confidence * 100.0,
                                        summary.description,
                                        msg.camera_id,
                                    );

                                    // Emit detection event to frontend
                                    if let Some(ref app) = worker_app {
                                        use tauri::Emitter;
                                        let _ = app.emit(
                                            "broxeen:vision_detection",
                                            serde_json::json!({
                                                "camera_id": msg.camera_id,
                                                "track_id": msg.track.id.to_string(),
                                                "label": msg.track.class,
                                                "confidence": msg.track.confidence,
                                                "movement": mv_tag,
                                                "direction": summary.direction,
                                                "duration_s": summary.duration_secs,
                                            }),
                                        );
                                    }
                                }
                            }

                            // ── Buffer for LLM batch ─────────────────────
                            buf.push(ObjectEvent {
                                track_id:    msg.track.id,
                                class:       msg.track.class.clone(),
                                confidence:  msg.track.confidence,
                                movement:    summary,
                                crops:       msg.track.crops.clone(),
                                finished_at: chrono::Utc::now(),
                            });
                        }
                        Err(tokio::sync::mpsc::error::TryRecvError::Empty)        => break,
                        Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => return,
                    }
                }

                // ── Track B: flush to LLM once per minute ─────────────────
                if buf.should_flush() {
                    if let Some(batch) = buf.drain() {
                        let timeline = batch.build_timeline(&worker_cfg.camera.camera_id);
                        let crops = batch.select_crops(
                            worker_cfg.scene.min_crops_for_llm,
                            worker_cfg.scene.max_crops_per_batch,
                        );

                        if !crops.is_empty() {
                            match worker_llm.describe_scene(
                                &crops, &timeline, &worker_cfg.camera.camera_id,
                            ).await {
                                Ok(result) => {
                                    info!("📖 LLM [{}]: {}", result.provider, result.narrative);
                                    let db = worker_db.lock().unwrap();
                                    if let Err(e) = db.insert_llm_event(
                                        &worker_cfg.camera.camera_id,
                                        batch.period_start,
                                        batch.period_end,
                                        &result.narrative,
                                        &result.provider,
                                        crops.len() as u32,
                                        &timeline,
                                    ) {
                                        warn!("DB insert_llm_event: {}", e);
                                    }

                                    if let Some(ref app) = worker_app {
                                        use tauri::Emitter;
                                        let _ = app.emit(
                                            "broxeen:vision_llm_result",
                                            serde_json::json!({
                                                "camera_id": worker_cfg.camera.camera_id,
                                                "narrative": result.narrative,
                                                "provider": result.provider,
                                                "crops_sent": crops.len(),
                                            }),
                                        );
                                    }
                                }
                                Err(e) => warn!("LLM scene error: {} — detections still saved locally", e),
                            }
                        }
                    }
                }

                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
        });

        // ── Blocking capture + detection loop ─────────────────────────────
        let cap_cfg = cfg.clone();
        let mut stop_rx_cap = stop_rx.clone();

        tokio::task::spawn_blocking(move || {
            let cam = &cap_cfg.camera;
            let det_cfg = &cap_cfg.detector;

            let mut stream = match CaptureStream::open(
                &cam.url, &cam.camera_id, cap_cfg.pipeline.process_every_n_frames,
            ) {
                Ok(s) => s,
                Err(e) => { warn!("Failed to open camera stream: {}", e); return; }
            };

            let detector = match Detector::new(
                &det_cfg.model_path,
                det_cfg.input_size,
                det_cfg.confidence_threshold,
                det_cfg.nms_threshold,
                det_cfg.use_openvino,
            ) {
                Ok(d) => d,
                Err(e) => { warn!("Detector init failed: {}", e); return; }
            };

            let mut tracker = Tracker::new(
                cap_cfg.tracker.iou_match_threshold,
                cap_cfg.tracker.max_age_frames,
                cap_cfg.tracker.min_hits,
                cap_cfg.tracker.crop_max_px,
                cap_cfg.tracker.crops_per_track,
            );

            // Simple activity gate: use MOG2 at low res to decide if YOLO should run
            let mut activity_detector = crate::vision_motion::MotionDetector::new(
                cap_cfg.pipeline.bg_history,
                cap_cfg.pipeline.bg_var_threshold,
                cap_cfg.pipeline.min_activity_area,
                200000.0,
                400,
            ).ok();

            info!(
                "▶ Pipeline v0.3: cam={} openvino={} flush={}s",
                cam.camera_id, det_cfg.use_openvino, cap_cfg.scene.flush_interval_secs,
            );

            loop {
                if *stop_rx_cap.borrow() {
                    info!("Pipeline stop signal received for {}", cam.camera_id);
                    break;
                }

                let frame = match stream.next_frame() {
                    Ok(Some(f)) => f,
                    Ok(None) => continue,
                    Err(e) => {
                        warn!("Capture: {} — reconnecting", e);
                        match stream.reconnect() {
                            Ok(_) => continue,
                            Err(re) => { warn!("Reconnect failed: {}", re); break; }
                        }
                    }
                };

                // Activity gate: skip YOLO if no motion detected
                let active = activity_detector.as_mut()
                    .map(|m| m.process_frame(&frame).map(|objs| !objs.is_empty()).unwrap_or(true))
                    .unwrap_or(true);

                let detections = if active {
                    match detector.detect_frame(&frame) {
                        Ok(d) => d,
                        Err(e) => { warn!("Detector: {}", e); vec![] }
                    }
                } else {
                    vec![]
                };

                let completed = tracker.update(&detections, &frame);

                for t in completed {
                    let _ = track_tx.try_send(TrackMsg {
                        track: t,
                        camera_id: cam.camera_id.clone(),
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

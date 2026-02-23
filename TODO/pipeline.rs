//! Main pipeline — two-track architecture:
//!
//! Track A (immediate): YOLO detection → tracker → movement analysis → DB (local_detections)
//! Track B (1/min):     MinuteBuffer → LLM (OpenRouter / local) → DB (llm_events)

use anyhow::Result;
use std::sync::Arc;
use tracing::{info, warn};

use crate::{
    capture::CaptureStream,
    config::AppConfig,
    database::Database,
    detector::Detector,
    llm::LlmClient,
    motion::MotionDetector,
    movement,
    scene_buffer::{MinuteBuffer, ObjectEvent},
    tracker::Tracker,
};

pub struct Pipeline {
    cfg: AppConfig,
}

// Internal message from blocking capture thread → async LLM worker
struct TrackMsg {
    track:    crate::tracker::CompletedTrack,
    camera_id: String,
    frame_w:  u32,
    frame_h:  u32,
}

impl Pipeline {
    pub fn new(cfg: AppConfig) -> Self { Self { cfg } }

    pub async fn run(self) -> Result<()> {
        let cfg = Arc::new(self.cfg);

        let db  = Arc::new(std::sync::Mutex::new(Database::open(&cfg.database.path)?));
        let llm = Arc::new(LlmClient::from_config(&cfg.llm));

        // Async channel: completed tracks → LLM/scene worker
        let (track_tx, mut track_rx) = tokio::sync::mpsc::channel::<TrackMsg>(64);

        // ── Async worker: per-minute LLM batching ────────────────────────
        let worker_db   = Arc::clone(&db);
        let worker_llm  = Arc::clone(&llm);
        let worker_cfg  = cfg.clone();

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
                            let summary = movement::analyse_movement(
                                &msg.track, msg.frame_w, msg.frame_h,
                            );
                            let mv_tag = movement::movement_tag(&summary, msg.track.class.as_str());

                            // ── Track A: save to DB immediately ──────────
                            let thumbnail = msg.track.crops.first()
                                .map(|c| c.jpeg_bytes.clone())
                                .unwrap_or_default();

                            {
                                let db = worker_db.lock().unwrap();
                                if let Err(e) = db.insert_detection(
                                    &msg.camera_id,
                                    &msg.track.id.to_string(),
                                    msg.track.class.as_str(),
                                    msg.track.confidence,
                                    Some(&mv_tag),
                                    Some(summary.direction.as_str()),
                                    Some(summary.speed_label),
                                    Some(summary.entry_zone.as_str()),
                                    Some(summary.exit_zone.as_str()),
                                    summary.duration_secs,
                                    &thumbnail,
                                ) {
                                    warn!("DB insert_detection: {}", e);
                                } else {
                                    info!(
                                        "✓ Local: {} [{:.0}%] {} cam={}",
                                        msg.track.class.as_str(),
                                        msg.track.confidence * 100.0,
                                        summary.description,
                                        msg.camera_id,
                                    );
                                }
                            }

                            // ── Buffer for LLM batch ─────────────────────
                            buf.push(ObjectEvent {
                                track_id:    msg.track.id,
                                class:       msg.track.class.as_str().to_string(),
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
                        let crops    = batch.select_crops(
                            worker_cfg.scene.min_crops_for_llm,
                            worker_cfg.scene.max_crops_per_batch,
                        );

                        if !crops.is_empty() {
                            match worker_llm.describe_scene(
                                &crops,
                                &timeline,
                                &worker_cfg.camera.camera_id,
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
                                }
                                Err(e) => warn!("LLM scene error: {} — detection still saved locally", e),
                            }
                        }
                    }
                }

                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            }
        });

        // ── Blocking capture + detection loop ─────────────────────────────
        let cam_url  = cfg.camera.url.clone();
        let cam_id   = cfg.camera.camera_id.clone();
        let det_cfg  = cfg.detector.clone();
        let pipe_cfg = cfg.pipeline.clone();
        let trk_cfg  = cfg.tracker.clone();

        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut stream = CaptureStream::open(&cam_url, &cam_id, pipe_cfg.process_every_n_frames)?;

            let detector = Detector::new(
                &det_cfg.model_path,
                det_cfg.input_size,
                det_cfg.confidence_threshold,
                det_cfg.nms_threshold,
                det_cfg.intra_threads,
                det_cfg.use_openvino,
            )?;

            let mut motion = MotionDetector::new(
                pipe_cfg.bg_history,
                pipe_cfg.bg_var_threshold,
                pipe_cfg.min_activity_area,
            )?;

            let mut tracker = Tracker::new(
                trk_cfg.iou_match_threshold,
                trk_cfg.max_age_frames,
                trk_cfg.min_hits,
                trk_cfg.crop_max_px,
                trk_cfg.crops_per_track,
            );

            let fw = stream.native_width.unwrap_or(1280);
            let fh = stream.native_height.unwrap_or(720);

            info!("▶ Pipeline: cam={} {}×{} openvino={}", cam_id, fw, fh, det_cfg.use_openvino);

            loop {
                let frame = match stream.next_frame() {
                    Ok(Some(f)) => f,
                    Ok(None)    => continue,
                    Err(e) => { warn!("Capture: {} — reconnecting", e); stream.reconnect()?; continue; }
                };

                // Activity gate
                let active = motion.has_activity(&frame).unwrap_or(true);

                let detections = if active {
                    match detector.detect_frame(&frame) {
                        Ok(d)  => d,
                        Err(e) => { warn!("Detector: {}", e); vec![] }
                    }
                } else {
                    vec![]
                };

                let completed = tracker.update(&detections, &frame);

                for t in completed {
                    let _ = track_tx.try_send(TrackMsg {
                        track: t,
                        camera_id: cam_id.clone(),
                        frame_w: fw,
                        frame_h: fh,
                    });
                }
            }
        }).await??;

        Ok(())
    }
}

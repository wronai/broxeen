//! IoU-based Object Tracker — assigns UUID per tracked object
//!
//! Matches detected bounding boxes across frames using IoU (Intersection over Union).
//! Each unique object gets a UUID. When a track goes stale (not matched for N frames),
//! it is returned as a CompletedTrack with collected crop snapshots.

use chrono::{DateTime, Utc};
use opencv::{core::Mat, imgcodecs, imgproc, prelude::*};
use tracing::debug;
use uuid::Uuid;

use crate::vision_detector::Detection;

// ─── Types ───────────────────────────────────────────────────────────────────

/// A JPEG crop snapshot with timestamp.
#[derive(Debug, Clone)]
pub struct CropSnapshot {
    pub jpeg_bytes: Vec<u8>,
    pub timestamp:  DateTime<Utc>,
}

/// A track that has been completed (object left the scene or went stale).
#[derive(Debug, Clone)]
pub struct CompletedTrack {
    pub id:         Uuid,
    pub class:      String,
    pub confidence: f32,
    pub crops:      Vec<CropSnapshot>,
    pub positions:  Vec<(f32, f32, f32, f32)>,   // (x1,y1,x2,y2) history
    pub first_seen: DateTime<Utc>,
    pub last_seen:  DateTime<Utc>,
    pub hit_count:  u32,
}

/// Internal active track state.
struct ActiveTrack {
    id:         Uuid,
    class:      String,
    confidence: f32,
    bbox:       (f32, f32, f32, f32),
    age:        u32,       // frames since last match
    hits:       u32,       // total matched frames
    crops:      Vec<CropSnapshot>,
    positions:  Vec<(f32, f32, f32, f32)>,
    first_seen: DateTime<Utc>,
    last_seen:  DateTime<Utc>,
    max_crops:  usize,
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

pub struct Tracker {
    tracks:        Vec<ActiveTrack>,
    iou_threshold: f32,
    max_age:       u32,
    min_hits:      u32,
    crop_max_px:   u32,
    crops_per_track: usize,
}

impl Tracker {
    pub fn new(
        iou_threshold: f32,
        max_age: u32,
        min_hits: u32,
        crop_max_px: u32,
        crops_per_track: usize,
    ) -> Self {
        Self {
            tracks: Vec::new(),
            iou_threshold,
            max_age,
            min_hits,
            crop_max_px,
            crops_per_track,
        }
    }

    /// Update tracker with new detections from the current frame.
    /// Returns any completed tracks (stale or gone objects).
    pub fn update(
        &mut self,
        detections: &[Detection],
        frame: &Mat,
    ) -> Vec<CompletedTrack> {
        let now = Utc::now();
        let mut completed = Vec::new();

        // ── 1. Match detections to existing tracks (greedy IoU) ──────────
        let mut used_det = vec![false; detections.len()];
        let mut matched_track = vec![false; self.tracks.len()];

        // Build IoU matrix and greedily match
        let mut pairs: Vec<(usize, usize, f32)> = Vec::new();
        for (ti, track) in self.tracks.iter().enumerate() {
            for (di, det) in detections.iter().enumerate() {
                let iou = compute_iou(track.bbox, det.bbox_norm);
                if iou >= self.iou_threshold {
                    pairs.push((ti, di, iou));
                }
            }
        }
        pairs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

        for (ti, di, _iou) in &pairs {
            if matched_track[*ti] || used_det[*di] { continue; }
            matched_track[*ti] = true;
            used_det[*di] = true;

            let track = &mut self.tracks[*ti];
            let det = &detections[*di];
            track.bbox = det.bbox_norm;
            track.age = 0;
            track.hits += 1;
            track.last_seen = now;
            track.positions.push(det.bbox_norm);

            // Update class/confidence if this detection is more confident
            if det.confidence > track.confidence {
                track.class = det.class.as_str().to_string();
                track.confidence = det.confidence;
            }

            // Collect crop (spaced out)
            if track.crops.len() < track.max_crops {
                if let Some(crop_bytes) = extract_crop(frame, det.bbox_norm, self.crop_max_px) {
                    track.crops.push(CropSnapshot {
                        jpeg_bytes: crop_bytes,
                        timestamp: now,
                    });
                }
            }
        }

        // ── 2. Create new tracks for unmatched detections ────────────────
        for (di, det) in detections.iter().enumerate() {
            if used_det[di] { continue; }
            let mut crops = Vec::new();
            if let Some(crop_bytes) = extract_crop(frame, det.bbox_norm, self.crop_max_px) {
                crops.push(CropSnapshot {
                    jpeg_bytes: crop_bytes,
                    timestamp: now,
                });
            }
            self.tracks.push(ActiveTrack {
                id: Uuid::new_v4(),
                class: det.class.as_str().to_string(),
                confidence: det.confidence,
                bbox: det.bbox_norm,
                age: 0,
                hits: 1,
                crops,
                positions: vec![det.bbox_norm],
                first_seen: now,
                last_seen: now,
                max_crops: self.crops_per_track,
            });
        }

        // ── 3. Age unmatched tracks and retire stale ones ────────────────
        let mut retained = Vec::new();
        for (ti, mut track) in self.tracks.drain(..).enumerate() {
            if !matched_track.get(ti).copied().unwrap_or(false) {
                track.age += 1;
            }
            if track.age > self.max_age {
                // Track is stale — complete it
                if track.hits >= self.min_hits {
                    completed.push(CompletedTrack {
                        id: track.id,
                        class: track.class,
                        confidence: track.confidence,
                        crops: track.crops,
                        positions: track.positions,
                        first_seen: track.first_seen,
                        last_seen: track.last_seen,
                        hit_count: track.hits,
                    });
                }
                debug!("Track {} retired (hits={})", track.id, track.hits);
            } else {
                retained.push(track);
            }
        }
        self.tracks = retained;

        completed
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn compute_iou(a: (f32, f32, f32, f32), b: (f32, f32, f32, f32)) -> f32 {
    let x1 = a.0.max(b.0);
    let y1 = a.1.max(b.1);
    let x2 = a.2.min(b.2);
    let y2 = a.3.min(b.3);

    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let area_a = (a.2 - a.0) * (a.3 - a.1);
    let area_b = (b.2 - b.0) * (b.3 - b.1);
    let union = area_a + area_b - inter;

    if union <= 0.0 { 0.0 } else { inter / union }
}

/// Extract a JPEG-encoded crop from a frame given normalised bbox [0..1].
fn extract_crop(frame: &Mat, bbox_norm: (f32, f32, f32, f32), max_px: u32) -> Option<Vec<u8>> {
    let fw = frame.cols() as f32;
    let fh = frame.rows() as f32;

    let x1 = (bbox_norm.0 * fw) as i32;
    let y1 = (bbox_norm.1 * fh) as i32;
    let x2 = (bbox_norm.2 * fw) as i32;
    let y2 = (bbox_norm.3 * fh) as i32;

    let x1 = x1.max(0);
    let y1 = y1.max(0);
    let x2 = x2.min(frame.cols());
    let y2 = y2.min(frame.rows());

    if x2 <= x1 || y2 <= y1 { return None; }

    let roi = opencv::core::Rect::new(x1, y1, x2 - x1, y2 - y1);
    let crop = Mat::roi(frame, roi).ok()?;

    // Resize if too large
    let longest = crop.cols().max(crop.rows());
    let final_crop = if longest > max_px as i32 {
        let scale = max_px as f64 / longest as f64;
        let new_w = (crop.cols() as f64 * scale) as i32;
        let new_h = (crop.rows() as f64 * scale) as i32;
        let mut resized = Mat::default();
        imgproc::resize(
            &crop, &mut resized,
            opencv::core::Size::new(new_w, new_h),
            0.0, 0.0, imgproc::INTER_AREA,
        ).ok()?;
        resized
    } else {
        let mut out = Mat::default();
        crop.copy_to(&mut out).ok()?;
        out
    };

    // Encode to JPEG
    let mut buf = opencv::core::Vector::<u8>::new();
    let params = opencv::core::Vector::from_iter([
        imgcodecs::IMWRITE_JPEG_QUALITY, 75,
    ]);
    imgcodecs::imencode(".jpg", &final_crop, &mut buf, &params).ok()?;

    let bytes = buf.to_vec();
    if bytes.len() < 256 { return None; } // skip tiny/blank crops

    Some(bytes)
}

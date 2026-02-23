//! MinuteBuffer: collects detected objects every second,
//! flushes to LLM every ~60 seconds (if there were any detections).
//!
//! Sends minimum 3 crops (or all crops if fewer were detected).
//! If no objects detected → skip LLM call entirely.

use chrono::{DateTime, Utc};
use std::collections::VecDeque;
use std::time::Instant;
use tracing::{debug, info};

use crate::tracker::CropSnapshot;
use crate::movement::MovementSummary;

// ─── One completed object event ───────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ObjectEvent {
    pub track_id:    uuid::Uuid,
    pub class:       String,
    pub confidence:  f32,
    pub movement:    MovementSummary,
    pub crops:       Vec<CropSnapshot>,   // ≤3 crops from tracker
    pub finished_at: DateTime<Utc>,
}

// ─── LLM batch payload ────────────────────────────────────────────────────────

pub struct MinuteBatch {
    pub events:       Vec<ObjectEvent>,
    pub period_start: DateTime<Utc>,
    pub period_end:   DateTime<Utc>,
}

impl MinuteBatch {
    /// Build a timeline text block to send alongside images.
    pub fn build_timeline(&self, camera_id: &str) -> String {
        let mut lines = Vec::new();
        lines.push(format!(
            "Camera: {} | {} → {} UTC | {} objects",
            camera_id,
            self.period_start.format("%H:%M:%S"),
            self.period_end.format("%H:%M:%S"),
            self.events.len(),
        ));

        // Class summary
        let mut counts: std::collections::HashMap<&str, usize> = Default::default();
        for e in &self.events { *counts.entry(e.class.as_str()).or_default() += 1; }
        let mut summary: Vec<_> = counts.into_iter().collect();
        summary.sort_by(|a, b| b.1.cmp(&a.1));
        lines.push(format!("Seen: {}", summary.iter().map(|(c,n)| format!("{n}×{c}")).collect::<Vec<_>>().join(", ")));

        lines.push(String::new());
        lines.push("Timeline:".to_string());
        for (i, ev) in self.events.iter().enumerate() {
            lines.push(format!(
                "  [{:02}] {} {} — {}",
                i + 1,
                ev.finished_at.format("%H:%M:%S"),
                ev.class,
                ev.movement.description,
            ));
        }
        lines.join("\n")
    }

    /// Collect crops for LLM: at least 3, at most 10 total, spread across events.
    /// Returns (jpeg_bytes, timestamp_string) pairs.
    pub fn select_crops(&self, min: usize, max: usize) -> Vec<(Vec<u8>, String)> {
        let mut out: Vec<(Vec<u8>, String)> = Vec::new();

        // Round-robin across events to get even coverage
        let max_per_event = ((max / self.events.len().max(1)) + 1).min(3);

        for ev in &self.events {
            for crop in ev.crops.iter().take(max_per_event) {
                out.push((
                    crop.jpeg_bytes.clone(),
                    crop.timestamp.format("%H:%M:%S").to_string(),
                ));
                if out.len() >= max { break; }
            }
            if out.len() >= max { break; }
        }

        // If we have fewer than min, just take all available
        if out.len() < min {
            out.clear();
            'outer: for ev in &self.events {
                for crop in &ev.crops {
                    out.push((
                        crop.jpeg_bytes.clone(),
                        crop.timestamp.format("%H:%M:%S").to_string(),
                    ));
                    if out.len() >= max { break 'outer; }
                }
            }
        }

        out
    }
}

// ─── MinuteBuffer ─────────────────────────────────────────────────────────────

pub struct MinuteBuffer {
    events:          VecDeque<ObjectEvent>,
    flush_interval:  std::time::Duration,
    last_flush:      Instant,
    period_start:    DateTime<Utc>,
    ring_capacity:   usize,
    /// Minimum crops to bother sending to LLM
    min_crops:       usize,
}

impl MinuteBuffer {
    pub fn new(flush_secs: u64, ring_capacity: usize, min_crops: usize) -> Self {
        Self {
            events:         VecDeque::new(),
            flush_interval: std::time::Duration::from_secs(flush_secs),
            last_flush:     Instant::now(),
            period_start:   Utc::now(),
            ring_capacity,
            min_crops,
        }
    }

    /// Add a completed track event.
    pub fn push(&mut self, event: ObjectEvent) {
        if self.events.len() >= self.ring_capacity {
            self.events.pop_front();
        }
        self.events.push_back(event);
        debug!("MinuteBuffer: {} events", self.events.len());
    }

    /// Whether it's time to flush to LLM.
    pub fn should_flush(&self) -> bool {
        if self.events.is_empty() { return false; }
        // Has enough crops to be worth sending?
        let total_crops: usize = self.events.iter().map(|e| e.crops.len()).sum();
        if total_crops < self.min_crops { return false; }
        self.last_flush.elapsed() >= self.flush_interval
    }

    /// Drain events and build batch. Resets timer.
    pub fn drain(&mut self) -> Option<MinuteBatch> {
        if self.events.is_empty() { return None; }
        let events: Vec<_> = self.events.drain(..).collect();
        let period_start = self.period_start;
        let period_end   = Utc::now();
        self.period_start = period_end;
        self.last_flush   = Instant::now();

        info!("Flushing {} events to LLM batch", events.len());
        Some(MinuteBatch { events, period_start, period_end })
    }

    /// Force flush regardless of timer (used on shutdown).
    pub fn force_drain(&mut self) -> Option<MinuteBatch> {
        self.last_flush = Instant::now() - self.flush_interval; // make it appear elapsed
        self.drain()
    }
}

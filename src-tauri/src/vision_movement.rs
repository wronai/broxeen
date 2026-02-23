//! Movement Analysis — direction, speed, zones for tracked objects.
//!
//! Takes a completed track's position history and derives:
//! - direction (left/right/up/down/stationary)
//! - speed label (slow/moderate/fast/stationary)
//! - entry/exit zones (upper-left, centre, bottom-right, etc.)
//! - human-readable description

use crate::vision_tracker::CompletedTrack;

// ─── Movement summary ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct MovementSummary {
    pub description: String,
    pub direction:   String,
    pub speed_label: &'static str,
    pub entry_zone:  String,
    pub exit_zone:   String,
    pub duration_secs: f32,
}

// ─── Zone classification ─────────────────────────────────────────────────────

fn classify_zone(x: f32, y: f32) -> String {
    let h = if y < 0.33 { "upper" } else if y < 0.66 { "centre" } else { "lower" };
    let v = if x < 0.33 { "left" } else if x < 0.66 { "centre" } else { "right" };
    if h == "centre" && v == "centre" {
        "centre".to_string()
    } else {
        format!("{}-{}", h, v)
    }
}

fn bbox_center(bbox: &(f32, f32, f32, f32)) -> (f32, f32) {
    ((bbox.0 + bbox.2) / 2.0, (bbox.1 + bbox.3) / 2.0)
}

// ─── Analysis ────────────────────────────────────────────────────────────────

/// Analyse movement of a completed track.
pub fn analyse_movement(track: &CompletedTrack) -> MovementSummary {
    if track.positions.len() < 2 {
        return MovementSummary {
            description: format!("stationary {}", track.class),
            direction: "stationary".to_string(),
            speed_label: "stationary",
            entry_zone: track.positions.first()
                .map(|p| classify_zone(bbox_center(p).0, bbox_center(p).1))
                .unwrap_or_else(|| "centre".to_string()),
            exit_zone: track.positions.last()
                .map(|p| classify_zone(bbox_center(p).0, bbox_center(p).1))
                .unwrap_or_else(|| "centre".to_string()),
            duration_secs: 0.0,
        };
    }

    let first = &track.positions[0];
    let last = track.positions.last().unwrap();

    let (fx, fy) = bbox_center(first);
    let (lx, ly) = bbox_center(last);

    let dx = lx - fx;
    let dy = ly - fy;
    let distance = (dx * dx + dy * dy).sqrt();

    // Duration
    let duration_secs = (track.last_seen - track.first_seen)
        .num_milliseconds() as f32 / 1000.0;
    let duration_secs = duration_secs.max(0.1);

    // Direction
    let direction = if distance < 0.02 {
        "stationary".to_string()
    } else {
        let angle = dy.atan2(dx);
        let deg = angle.to_degrees();
        match deg {
            d if (-22.5..22.5).contains(&d) => "right",
            d if (22.5..67.5).contains(&d)  => "lower-right",
            d if (67.5..112.5).contains(&d) => "down",
            d if (112.5..157.5).contains(&d) => "lower-left",
            d if d >= 157.5 || d <= -157.5  => "left",
            d if (-157.5..-112.5).contains(&d) => "upper-left",
            d if (-112.5..-67.5).contains(&d)  => "up",
            d if (-67.5..-22.5).contains(&d)   => "upper-right",
            _ => "unknown",
        }.to_string()
    };

    // Speed (normalised pixels/sec — relative to frame size)
    let speed = distance / duration_secs;
    let speed_label = if speed < 0.02 {
        "stationary"
    } else if speed < 0.10 {
        "slow"
    } else if speed < 0.30 {
        "moderate"
    } else {
        "fast"
    };

    let entry_zone = classify_zone(fx, fy);
    let exit_zone = classify_zone(lx, ly);

    let description = format!(
        "moving {}, {}→{}, {:.1}s",
        direction, entry_zone, exit_zone, duration_secs
    );

    MovementSummary {
        description,
        direction,
        speed_label,
        entry_zone,
        exit_zone,
        duration_secs,
    }
}

/// Short movement tag for DB column.
pub fn movement_tag(summary: &MovementSummary, class: &str) -> String {
    format!(
        "{} {} {}→{} {:.1}s",
        class, summary.direction, summary.entry_zone, summary.exit_zone, summary.duration_secs
    )
}

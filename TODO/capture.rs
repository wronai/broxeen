use anyhow::Result;
use opencv::{
    core::Mat,
    videoio::{VideoCapture, CAP_FFMPEG, CAP_PROP_BUFFERSIZE, CAP_PROP_FPS},
    prelude::*,
};
use tracing::{error, info, warn};
use std::time::{Duration, Instant};

/// Opened RTSP stream.
pub struct CaptureStream {
    cap: VideoCapture,
    pub camera_id: String,
    pub url: String,
    pub native_fps: f64,
    process_every: u32,
    frame_idx: u64,
}

impl CaptureStream {
    /// Open RTSP stream via FFmpeg backend.
    pub fn open(url: &str, camera_id: &str, process_every: u32) -> Result<Self> {
        info!("Opening camera {} at {}", camera_id, url);

        let mut cap = VideoCapture::from_file(url, CAP_FFMPEG)?;

        if !cap.is_opened()? {
            anyhow::bail!("Failed to open RTSP stream: {}", url);
        }

        // Small buffer — we want fresh frames, not queued ones
        cap.set(CAP_PROP_BUFFERSIZE as i32, 1.0)?;

        let native_fps = cap.get(CAP_PROP_FPS as i32).unwrap_or(25.0);
        info!("Camera {} opened. Native FPS: {:.1}", camera_id, native_fps);

        Ok(Self {
            cap,
            camera_id: camera_id.to_string(),
            url: url.to_string(),
            native_fps,
            process_every,
            frame_idx: 0,
        })
    }

    /// Read next frame. Returns `None` if this frame should be skipped.
    /// Returns `Err` on read failure (caller should reconnect).
    pub fn next_frame(&mut self) -> Result<Option<Mat>> {
        let mut frame = Mat::default();

        if !self.cap.read(&mut frame)? || frame.empty() {
            anyhow::bail!("Empty frame or read error — stream may have dropped");
        }

        self.frame_idx += 1;

        if self.frame_idx % self.process_every as u64 != 0 {
            return Ok(None); // skip this frame
        }

        Ok(Some(frame))
    }

    /// Attempt to reconnect with exponential back-off.
    pub fn reconnect(&mut self) -> Result<()> {
        warn!("Reconnecting camera {}...", self.camera_id);
        let _ = self.cap.release();

        let mut delay = Duration::from_secs(1);
        for attempt in 1..=10 {
            std::thread::sleep(delay);
            match VideoCapture::from_file(&self.url, CAP_FFMPEG) {
                Ok(cap) if cap.is_opened().unwrap_or(false) => {
                    self.cap = cap;
                    self.cap.set(CAP_PROP_BUFFERSIZE as i32, 1.0).ok();
                    info!("Camera {} reconnected (attempt {})", self.camera_id, attempt);
                    return Ok(());
                }
                _ => {
                    error!("Reconnect attempt {} failed for camera {}", attempt, self.camera_id);
                    delay = (delay * 2).min(Duration::from_secs(30));
                }
            }
        }
        anyhow::bail!("Failed to reconnect camera {} after 10 attempts", self.camera_id);
    }
}

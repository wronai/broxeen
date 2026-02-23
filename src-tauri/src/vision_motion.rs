/// Motion Detection — OpenCV MOG2 Background Subtractor
///
/// Processes frames, extracts foreground contours, crops moving objects
/// and resizes them to ≤ max_output_px (longest edge).

use anyhow::Result;
use opencv::{
    core::{Mat, Point, Scalar, Size, Vector, BORDER_DEFAULT},
    imgproc::{
        self, CHAIN_APPROX_SIMPLE, MORPH_CLOSE, MORPH_ELLIPSE, MORPH_OPEN, RETR_EXTERNAL,
    },
    prelude::*,
    video::create_background_subtractor_mog2,
};

/// A detected moving object — bounding box + cropped region.
#[derive(Debug, Clone)]
pub struct MovingObject {
    /// Cropped image of the object (resized ≤ max_output_px longest edge)
    pub crop: Mat,
    /// Bounding box in the *scaled* frame (x1, y1, x2, y2)
    pub bbox: (i32, i32, i32, i32),
    /// Contour area in pixels²
    pub area: f64,
}

/// Wraps OpenCV MOG2 background subtractor.
/// One instance per camera stream.
pub struct MotionDetector {
    subtractor: opencv::core::Ptr<dyn opencv::video::BackgroundSubtractorMOG2>,
    min_area: f64,
    max_area: f64,
    max_output_px: i32,
    kernel: Mat,
}

impl MotionDetector {
    pub fn new(
        history: i32,
        var_threshold: f64,
        min_area: f64,
        max_area: f64,
        max_output_px: u32,
    ) -> Result<Self> {
        let subtractor = create_background_subtractor_mog2(
            history,
            var_threshold,
            false, // detectShadows=false → faster
        )?;

        // Elliptical kernel for morphological ops
        let kernel = imgproc::get_structuring_element(
            MORPH_ELLIPSE,
            Size::new(5, 5),
            Point::new(-1, -1),
        )?;

        Ok(Self {
            subtractor,
            min_area,
            max_area,
            max_output_px: max_output_px as i32,
            kernel,
        })
    }

    /// Process a single frame. Returns list of detected moving objects.
    /// `frame` should be BGR, full resolution from capture.
    pub fn process_frame(&mut self, frame: &Mat) -> Result<Vec<MovingObject>> {
        // ── 1. Scale frame down to 640px wide ───────────────────────────────
        let orig_w = frame.cols();
        let scale = 640.0 / orig_w as f64;
        let scaled_h = (frame.rows() as f64 * scale) as i32;
        let mut small = Mat::default();
        imgproc::resize(
            frame,
            &mut small,
            Size::new(640, scaled_h),
            0.0,
            0.0,
            imgproc::INTER_LINEAR,
        )?;

        // ── 2. Apply MOG2 → foreground mask ─────────────────────────────────
        let mut fg_mask = Mat::default();
        opencv::video::BackgroundSubtractor::apply(
            self.subtractor.as_mut(),
            &small,
            &mut fg_mask,
            -1.0,
        )?;

        // ── 3. Threshold: only keep confident foreground (255) ──────────────
        let mut binary = Mat::default();
        imgproc::threshold(&fg_mask, &mut binary, 200.0, 255.0, imgproc::THRESH_BINARY)?;

        // ── 4. Morphological close then open to remove noise ────────────────
        let mut closed = Mat::default();
        imgproc::morphology_ex(
            &binary,
            &mut closed,
            MORPH_CLOSE,
            &self.kernel,
            Point::new(-1, -1),
            2,
            BORDER_DEFAULT,
            Scalar::default(),
        )?;
        let mut opened = Mat::default();
        imgproc::morphology_ex(
            &closed,
            &mut opened,
            MORPH_OPEN,
            &self.kernel,
            Point::new(-1, -1),
            1,
            BORDER_DEFAULT,
            Scalar::default(),
        )?;

        // ── 5. Find contours ────────────────────────────────────────────────
        let mut contours: Vector<Vector<Point>> = Vector::new();
        imgproc::find_contours(
            &mut opened,
            &mut contours,
            RETR_EXTERNAL,
            CHAIN_APPROX_SIMPLE,
            Point::new(0, 0),
        )?;

        // ── 6. Filter by area + extract crops ───────────────────────────────
        let mut objects = Vec::new();
        let frame_w = small.cols();
        let frame_h = small.rows();

        for cnt in contours.iter() {
            let area = imgproc::contour_area(&cnt, false)?;
            if area < self.min_area || area > self.max_area {
                continue;
            }

            let rect = imgproc::bounding_rect(&cnt)?;

            // Add 10% padding
            let pad_w = (rect.width as f64 * 0.10) as i32;
            let pad_h = (rect.height as f64 * 0.10) as i32;
            let x1 = (rect.x - pad_w).max(0);
            let y1 = (rect.y - pad_h).max(0);
            let x2 = (rect.x + rect.width + pad_w).min(frame_w);
            let y2 = (rect.y + rect.height + pad_h).min(frame_h);

            let roi = opencv::core::Rect::new(x1, y1, x2 - x1, y2 - y1);
            let crop_full = Mat::roi(&small, roi)?;

            // ── 7. Resize crop to ≤ max_output_px (longest edge) ────────────
            let crop_w = crop_full.cols();
            let crop_h = crop_full.rows();
            let longest = crop_w.max(crop_h);
            let mut crop = Mat::default();

            if longest > self.max_output_px {
                let s = self.max_output_px as f64 / longest as f64;
                let new_w = (crop_w as f64 * s) as i32;
                let new_h = (crop_h as f64 * s) as i32;
                imgproc::resize(
                    &crop_full,
                    &mut crop,
                    Size::new(new_w, new_h),
                    0.0,
                    0.0,
                    imgproc::INTER_AREA,
                )?;
            } else {
                crop_full.copy_to(&mut crop)?;
            }

            objects.push(MovingObject {
                crop,
                bbox: (x1, y1, x2, y2),
                area,
            });
        }

        Ok(objects)
    }
}

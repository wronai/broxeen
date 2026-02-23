/// Object Detector — YOLOv8s via ONNX Runtime
///
/// Classifies detected objects into 20 classes.
/// Platform selection at runtime:
///   - Intel N5105: OpenVINO Execution Provider
///   - RPi5: CPU (ARM NEON auto-detected by ort)

use anyhow::{anyhow, Result};
use ndarray::Array4;
use opencv::{core::Mat, imgproc, prelude::*};
use ort::session::Session;
use tracing::debug;

/// The 20 classes we care about.
/// Everything else from COCO maps to `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ObjectClass {
    Person,
    Car,
    Truck,
    Bus,
    Motorcycle,
    Bicycle,
    Dog,
    Cat,
    Bird,
    Horse,
    Backpack,
    Handbag,
    Suitcase,
    Umbrella,
    Bottle,
    Chair,
    Laptop,
    CellPhone,
    Clock,
    Unknown,
}

impl ObjectClass {
    pub fn as_str(&self) -> &'static str {
        match self {
            ObjectClass::Person     => "person",
            ObjectClass::Car        => "car",
            ObjectClass::Truck      => "truck",
            ObjectClass::Bus        => "bus",
            ObjectClass::Motorcycle => "motorcycle",
            ObjectClass::Bicycle    => "bicycle",
            ObjectClass::Dog        => "dog",
            ObjectClass::Cat        => "cat",
            ObjectClass::Bird       => "bird",
            ObjectClass::Horse      => "horse",
            ObjectClass::Backpack   => "backpack",
            ObjectClass::Handbag    => "handbag",
            ObjectClass::Suitcase   => "suitcase",
            ObjectClass::Umbrella   => "umbrella",
            ObjectClass::Bottle     => "bottle",
            ObjectClass::Chair      => "chair",
            ObjectClass::Laptop     => "laptop",
            ObjectClass::CellPhone  => "cell phone",
            ObjectClass::Clock      => "clock",
            ObjectClass::Unknown    => "unknown",
        }
    }

    /// Map COCO class id (YOLOv8) → our 20 classes
    fn from_coco_id(id: usize) -> Self {
        match id {
            0  => ObjectClass::Person,
            1  => ObjectClass::Bicycle,
            2  => ObjectClass::Car,
            3  => ObjectClass::Motorcycle,
            5  => ObjectClass::Bus,
            7  => ObjectClass::Truck,
            14 => ObjectClass::Bird,
            15 => ObjectClass::Cat,
            16 => ObjectClass::Dog,
            17 => ObjectClass::Horse,
            24 => ObjectClass::Backpack,
            26 => ObjectClass::Handbag,
            28 => ObjectClass::Suitcase,
            25 => ObjectClass::Umbrella,
            39 => ObjectClass::Bottle,
            56 => ObjectClass::Chair,
            63 => ObjectClass::Laptop,
            67 => ObjectClass::CellPhone,
            74 => ObjectClass::Clock,
            _  => ObjectClass::Unknown,
        }
    }
}

/// Result of local inference
#[derive(Debug, Clone)]
pub struct Detection {
    pub class: ObjectClass,
    pub confidence: f32,
    /// Bounding box within the crop (x1, y1, x2, y2) normalised [0..1]
    pub bbox_norm: (f32, f32, f32, f32),
}

/// YOLOv8n wrapper using ONNX Runtime (ort 2.0).
pub struct Detector {
    session: Session,
    input_size: u32,
    conf_threshold: f32,
    #[allow(dead_code)]
    nms_threshold: f32,
}

impl Detector {
    pub fn new(
        model_path: &str,
        input_size: u32,
        conf_threshold: f32,
        nms_threshold: f32,
        _use_openvino: bool,
    ) -> Result<Self> {
        // ort 2.0: global init is automatic, session builder directly
        let session = Session::builder()?
            .with_optimization_level(ort::session::builder::GraphOptimizationLevel::Level3)?
            .with_intra_threads(2)?
            .commit_from_file(model_path)?;

        Ok(Self {
            session,
            input_size,
            conf_threshold,
            nms_threshold,
        })
    }

    /// Run inference on JPEG bytes (decode → detect).
    pub fn detect_from_jpeg(&self, jpeg_bytes: &[u8]) -> Result<Option<Detection>> {
        let img = image::load_from_memory_with_format(jpeg_bytes, image::ImageFormat::Jpeg)?;
        let rgb = img.to_rgb8();
        let (w, h) = (rgb.width() as i32, rgb.height() as i32);

        // Build a Mat from the decoded image
        let mut mat = unsafe {
            Mat::new_rows_cols_with_data_unsafe(
                h,
                w,
                opencv::core::CV_8UC3,
                rgb.as_raw().as_ptr() as *mut _,
                opencv::core::Mat_AUTO_STEP,
            )?
        };

        // RGB → BGR for OpenCV
        let mut bgr = Mat::default();
        imgproc::cvt_color(&mat, &mut bgr, imgproc::COLOR_RGB2BGR, 0)?;

        self.detect(&bgr)
    }

    /// Run inference on a full frame. Returns ALL detections above threshold.
    pub fn detect_frame(&self, frame: &Mat) -> Result<Vec<Detection>> {
        let sz = self.input_size as i32;
        let (letterboxed, scale, pad_x, pad_y) = letterbox(frame, sz)?;
        let mut rgb = Mat::default();
        imgproc::cvt_color(&letterboxed, &mut rgb, imgproc::COLOR_BGR2RGB, 0)?;
        let data = mat_to_chw_f32(&rgb, sz as usize)?;
        let array = Array4::from_shape_vec((1, 3, sz as usize, sz as usize), data)?;
        let outputs = self.session.run(ort::inputs!["images" => array.view()]?)?;
        let output_tensor = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow!("Failed to extract output tensor: {}", e))?;
        let shape = output_tensor.shape();
        let num_boxes = shape[2];
        let num_classes = shape[1] - 4;
        let orig_w = frame.cols() as f32;
        let orig_h = frame.rows() as f32;

        let mut detections = Vec::new();
        for i in 0..num_boxes {
            let cx = output_tensor[[0, 0, i]];
            let cy = output_tensor[[0, 1, i]];
            let bw = output_tensor[[0, 2, i]];
            let bh = output_tensor[[0, 3, i]];
            let mut max_score = 0f32;
            let mut max_class = 0usize;
            for c in 0..num_classes {
                let score = output_tensor[[0, 4 + c, i]];
                if score > max_score { max_score = score; max_class = c; }
            }
            if max_score <= self.conf_threshold { continue; }
            let class = ObjectClass::from_coco_id(max_class);
            if class == ObjectClass::Unknown { continue; }
            // Convert letterbox coords → normalised frame coords [0..1]
            let x1 = ((cx - bw / 2.0 - pad_x as f32) / (scale as f32 * orig_w)).max(0.0);
            let y1 = ((cy - bh / 2.0 - pad_y as f32) / (scale as f32 * orig_h)).max(0.0);
            let x2 = ((cx + bw / 2.0 - pad_x as f32) / (scale as f32 * orig_w)).min(1.0);
            let y2 = ((cy + bh / 2.0 - pad_y as f32) / (scale as f32 * orig_h)).min(1.0);
            detections.push(Detection { class, confidence: max_score, bbox_norm: (x1, y1, x2, y2) });
        }
        Ok(detections)
    }

    /// Run inference on a single BGR Mat crop.
    /// Returns top detection (highest confidence) or None.
    pub fn detect(&self, crop: &Mat) -> Result<Option<Detection>> {
        let sz = self.input_size as i32;

        // ── Letterbox resize to input_size × input_size ─────────────────────
        let (letterboxed, scale, pad_x, pad_y) = letterbox(crop, sz)?;

        // ── BGR → RGB, HWC → CHW, normalise [0,255] → [0.0, 1.0] ──────────
        let mut rgb = Mat::default();
        imgproc::cvt_color(&letterboxed, &mut rgb, imgproc::COLOR_BGR2RGB, 0)?;

        let data = mat_to_chw_f32(&rgb, sz as usize)?;

        // Shape: [1, 3, H, W]
        let array = Array4::from_shape_vec(
            (1, 3, sz as usize, sz as usize),
            data,
        )?;

        // ── Run model (ort 2.0 API) ────────────────────────────────────────
        let outputs = self.session.run(ort::inputs!["images" => array.view()]?)?;

        // YOLOv8 output: [1, 84, 8400] (84 = 4 bbox + 80 class scores)
        let output_tensor = outputs[0]
            .try_extract_tensor::<f32>()
            .map_err(|e| anyhow!("Failed to extract output tensor: {}", e))?;
        let shape = output_tensor.shape();
        // shape = [1, 84, num_boxes]

        let num_boxes = shape[2];
        let num_classes = shape[1] - 4;

        let mut best: Option<Detection> = None;
        let mut best_conf = self.conf_threshold;

        for i in 0..num_boxes {
            // Box coords: cx, cy, w, h (normalised to input_size)
            let cx = output_tensor[[0, 0, i]];
            let cy = output_tensor[[0, 1, i]];
            let bw = output_tensor[[0, 2, i]];
            let bh = output_tensor[[0, 3, i]];

            // Find best class
            let mut max_score = 0f32;
            let mut max_class = 0usize;
            for c in 0..num_classes {
                let score = output_tensor[[0, 4 + c, i]];
                if score > max_score {
                    max_score = score;
                    max_class = c;
                }
            }

            if max_score <= best_conf {
                continue;
            }

            let class = ObjectClass::from_coco_id(max_class);
            if class == ObjectClass::Unknown {
                continue; // filter noise classes
            }

            // Convert back to normalised crop coords, correcting for letterbox
            let s = sz as f32;
            let x1 = ((cx - bw / 2.0 - pad_x as f32) / scale as f32).max(0.0) / s;
            let y1 = ((cy - bh / 2.0 - pad_y as f32) / scale as f32).max(0.0) / s;
            let x2 = ((cx + bw / 2.0 - pad_x as f32) / scale as f32).min(s) / s;
            let y2 = ((cy + bh / 2.0 - pad_y as f32) / scale as f32).min(s) / s;

            best_conf = max_score;
            best = Some(Detection {
                class,
                confidence: max_score,
                bbox_norm: (x1, y1, x2, y2),
            });
        }

        debug!(
            "Detector: best={:?} conf={:.2}",
            best.as_ref().map(|d| d.class),
            best.as_ref().map(|d| d.confidence).unwrap_or(0.0)
        );

        Ok(best)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Letterbox resize: fit image into `target×target` with grey padding.
fn letterbox(src: &Mat, target: i32) -> Result<(Mat, f64, i32, i32)> {
    use opencv::core::{Scalar, Size};

    let w = src.cols();
    let h = src.rows();
    let scale = (target as f64 / w.max(h) as f64).min(1.0);
    let new_w = (w as f64 * scale) as i32;
    let new_h = (h as f64 * scale) as i32;

    let mut resized = Mat::default();
    imgproc::resize(
        src,
        &mut resized,
        Size::new(new_w, new_h),
        0.0,
        0.0,
        imgproc::INTER_LINEAR,
    )?;

    let pad_x = (target - new_w) / 2;
    let pad_y = (target - new_h) / 2;

    let mut padded = Mat::default();
    opencv::core::copy_make_border(
        &resized,
        &mut padded,
        pad_y,
        target - new_h - pad_y,
        pad_x,
        target - new_w - pad_x,
        opencv::core::BORDER_CONSTANT,
        Scalar::new(114.0, 114.0, 114.0, 0.0), // grey — standard YOLOv8 padding
    )?;

    Ok((padded, scale, pad_x, pad_y))
}

/// Convert OpenCV HWC Mat → CHW Vec<f32> normalised to [0,1].
fn mat_to_chw_f32(mat: &Mat, size: usize) -> Result<Vec<f32>> {
    let total = 3 * size * size;
    let mut out = vec![0f32; total];
    let data = mat.data_bytes()?;

    for h in 0..size {
        for w in 0..size {
            let pixel_idx = (h * size + w) * 3;
            for c in 0..3usize {
                let chw_idx = c * size * size + h * size + w;
                out[chw_idx] = data[pixel_idx + c] as f32 / 255.0;
            }
        }
    }
    Ok(out)
}

use anyhow::{anyhow, Result};
use ort::{Environment, Session, SessionBuilder, Value};
use opencv::{core::Mat, imgproc, prelude::*};
use ndarray::{Array, CowArray, IxDyn};
use std::sync::Arc;

/// The 10 classes we care about.
/// Everything else from COCO will be mapped to `Unknown`.
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
            ObjectClass::Unknown    => "unknown",
        }
    }

    /// Map COCO class id (YOLOv8) → our 10 classes
    fn from_coco_id(id: usize) -> Self {
        match id {
            0  => ObjectClass::Person,
            2  => ObjectClass::Car,
            7  => ObjectClass::Truck,
            5  => ObjectClass::Bus,
            3  => ObjectClass::Motorcycle,
            1  => ObjectClass::Bicycle,
            16 => ObjectClass::Dog,
            15 => ObjectClass::Cat,
            14 => ObjectClass::Bird,
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

/// YOLOv8n wrapper using ONNX Runtime.
/// 
/// Platform selection at runtime:
///   - Intel N5105: OpenVINO Execution Provider (via `ort` feature `openvino`)
///   - RPi5: XNNPACK / CPU (ARM NEON auto-detected by ort)
pub struct Detector {
    session: Session,
    input_size: u32,
    conf_threshold: f32,
    nms_threshold: f32,
}

impl Detector {
    pub fn new(
        model_path: &str,
        input_size: u32,
        conf_threshold: f32,
        nms_threshold: f32,
        use_openvino: bool,
    ) -> Result<Self> {
        let env = Arc::new(
            Environment::builder()
                .with_name("broxeen_detector")
                .build()?,
        );

        let mut builder = SessionBuilder::new(&env)?
            .with_optimization_level(ort::GraphOptimizationLevel::Level3)?
            .with_intra_threads(2)?; // 2 threads per session — leave cores for capture

        if use_openvino {
            // Intel N5105: offload to integrated GPU / Neural Engine
            builder = builder.with_execution_providers([
                ort::ExecutionProvider::OpenVINO(
                    ort::OpenVINOExecutionProviderOptions::default()
                ),
                ort::ExecutionProvider::CPU(Default::default()),
            ])?;
        } else {
            // RPi5: CPU with XNNPACK (ARM NEON SIMD)
            builder = builder.with_execution_providers([
                ort::ExecutionProvider::XNNPACK(Default::default()),
                ort::ExecutionProvider::CPU(Default::default()),
            ])?;
        }

        let session = builder.with_model_from_file(model_path)?;

        Ok(Self {
            session,
            input_size,
            conf_threshold,
            nms_threshold,
        })
    }

    /// Run inference on a single BGR Mat crop.
    /// Returns top detection (highest confidence) or None.
    pub fn detect(&self, crop: &Mat) -> Result<Option<Detection>> {
        let sz = self.input_size as i32;

        // ── Letterbox resize to input_size × input_size ──────────────────
        let (letterboxed, scale, pad_x, pad_y) = letterbox(crop, sz)?;

        // ── BGR → RGB, HWC → CHW, normalise [0,255] → [0.0, 1.0] ────────
        let mut rgb = Mat::default();
        imgproc::cvt_color(&letterboxed, &mut rgb, imgproc::COLOR_BGR2RGB, 0)?;

        let data = mat_to_chw_f32(&rgb, sz as usize)?;

        // Shape: [1, 3, H, W]
        let array = CowArray::from(
            Array::from_shape_vec((1, 3, sz as usize, sz as usize), data)?
                .into_dyn()
        );

        // ── Run model ─────────────────────────────────────────────────────
        let inputs = vec![Value::from_array(self.session.allocator(), &array)?];
        let outputs = self.session.run(inputs)?;

        // YOLOv8 output: [1, 84, 8400] (84 = 4 bbox + 80 class scores)
        let output = outputs[0].try_extract::<f32>()?;
        let output_view = output.view();
        let shape = output_view.shape();
        // shape = [1, 84, num_boxes]

        let num_boxes = shape[2];
        let num_classes = shape[1] - 4;

        let mut best: Option<Detection> = None;
        let mut best_conf = self.conf_threshold;

        for i in 0..num_boxes {
            // Box coords: cx, cy, w, h (normalised to input_size)
            let cx = output_view[[0, 0, i]];
            let cy = output_view[[0, 1, i]];
            let bw = output_view[[0, 2, i]];
            let bh = output_view[[0, 3, i]];

            // Find best class
            let mut max_score = 0f32;
            let mut max_class = 0usize;
            for c in 0..num_classes {
                let score = output_view[[0, 4 + c, i]];
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
                continue; // filter noise classes entirely
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

        Ok(best)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Letterbox resize: fit image into `target×target` with grey padding.
/// Returns (letterboxed_mat, scale_factor, pad_x, pad_y)
fn letterbox(src: &Mat, target: i32) -> Result<(Mat, f64, i32, i32)> {
    use opencv::core::{Scalar, Size};
    let w = src.cols();
    let h = src.rows();
    let scale = (target as f64 / w.max(h) as f64).min(1.0);
    let new_w = (w as f64 * scale) as i32;
    let new_h = (h as f64 * scale) as i32;

    let mut resized = Mat::default();
    imgproc::resize(src, &mut resized, Size::new(new_w, new_h), 0.0, 0.0, imgproc::INTER_LINEAR)?;

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

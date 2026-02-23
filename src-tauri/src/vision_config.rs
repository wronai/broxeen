/// Vision Pipeline Configuration — v0.3
///
/// Loaded from broxeen.toml (project root) with env-var overrides.
/// Env format: BROXEEN__SECTION__KEY (double underscore separators).
///
/// v0.3 changes:
///   - LLM: OpenRouter primary + local Ollama fallback (was Anthropic-only)
///   - New: TrackerConfig (IoU matching, UUID per object)
///   - New: SceneConfig (MinuteBuffer flush interval, min crops for LLM)
///   - DetectorConfig: model_path now default yolov8s, input_size 640, 20 classes

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct VisionConfig {
    pub camera: CameraConfig,
    #[serde(default)]
    pub detector: DetectorConfig,
    #[serde(default)]
    pub pipeline: PipelineConfig,
    #[serde(default)]
    pub tracker: TrackerConfig,
    #[serde(default)]
    pub scene: SceneConfig,
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub llm: LlmConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CameraConfig {
    pub url: String,
    #[serde(default = "default_camera_id")]
    pub camera_id: String,
    pub fps: Option<f64>,
}

fn default_camera_id() -> String {
    "cam0".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectorConfig {
    #[serde(default = "default_model_path")]
    pub model_path: String,
    #[serde(default = "default_confidence_threshold")]
    pub confidence_threshold: f32,
    #[serde(default = "default_nms_threshold")]
    pub nms_threshold: f32,
    #[serde(default = "default_input_size")]
    pub input_size: u32,
    #[serde(default = "default_use_openvino")]
    pub use_openvino: bool,
    #[serde(default = "default_intra_threads")]
    pub intra_threads: u16,
}

fn default_model_path() -> String {
    "models/yolov8s.onnx".to_string()
}
fn default_confidence_threshold() -> f32 {
    0.50
}
fn default_nms_threshold() -> f32 {
    0.45
}
fn default_input_size() -> u32 {
    640
}
fn default_use_openvino() -> bool {
    true
}
fn default_intra_threads() -> u16 {
    2
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            model_path: default_model_path(),
            confidence_threshold: default_confidence_threshold(),
            nms_threshold: default_nms_threshold(),
            input_size: default_input_size(),
            use_openvino: default_use_openvino(),
            intra_threads: default_intra_threads(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PipelineConfig {
    #[serde(default = "default_process_every")]
    pub process_every_n_frames: u32,
    #[serde(default = "default_bg_history")]
    pub bg_history: i32,
    #[serde(default = "default_bg_var_threshold")]
    pub bg_var_threshold: f64,
    #[serde(default = "default_min_activity_area")]
    pub min_activity_area: f64,
}

fn default_process_every() -> u32 {
    4
}
fn default_bg_history() -> i32 {
    500
}
fn default_bg_var_threshold() -> f64 {
    40.0
}
fn default_min_activity_area() -> f64 {
    1500.0
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            process_every_n_frames: default_process_every(),
            bg_history: default_bg_history(),
            bg_var_threshold: default_bg_var_threshold(),
            min_activity_area: default_min_activity_area(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrackerConfig {
    #[serde(default = "default_iou_match_threshold")]
    pub iou_match_threshold: f32,
    #[serde(default = "default_max_age_frames")]
    pub max_age_frames: u32,
    #[serde(default = "default_min_hits")]
    pub min_hits: u32,
    #[serde(default = "default_crop_max_px")]
    pub crop_max_px: u32,
    #[serde(default = "default_crops_per_track")]
    pub crops_per_track: usize,
}

fn default_iou_match_threshold() -> f32 {
    0.30
}
fn default_max_age_frames() -> u32 {
    15
}
fn default_min_hits() -> u32 {
    3
}
fn default_crop_max_px() -> u32 {
    400
}
fn default_crops_per_track() -> usize {
    3
}

impl Default for TrackerConfig {
    fn default() -> Self {
        Self {
            iou_match_threshold: default_iou_match_threshold(),
            max_age_frames: default_max_age_frames(),
            min_hits: default_min_hits(),
            crop_max_px: default_crop_max_px(),
            crops_per_track: default_crops_per_track(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SceneConfig {
    /// Flush buffer to LLM every N seconds (default: 60 = once per minute)
    #[serde(default = "default_flush_interval_secs")]
    pub flush_interval_secs: u64,
    /// Minimum crops needed to justify an LLM call
    #[serde(default = "default_min_crops_for_llm")]
    pub min_crops_for_llm: usize,
    /// Ring buffer capacity (events)
    #[serde(default = "default_ring_capacity")]
    pub ring_capacity: usize,
    /// Max crops to send per LLM call
    #[serde(default = "default_max_crops_per_batch")]
    pub max_crops_per_batch: usize,
}

fn default_flush_interval_secs() -> u64 {
    60
}
fn default_min_crops_for_llm() -> usize {
    3
}
fn default_ring_capacity() -> usize {
    100
}
fn default_max_crops_per_batch() -> usize {
    10
}

impl Default for SceneConfig {
    fn default() -> Self {
        Self {
            flush_interval_secs: default_flush_interval_secs(),
            min_crops_for_llm: default_min_crops_for_llm(),
            ring_capacity: default_ring_capacity(),
            max_crops_per_batch: default_max_crops_per_batch(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
}

fn default_db_path() -> String {
    "monitoring.db".to_string()
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            path: default_db_path(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct LlmConfig {
    // ── OpenRouter (primary) ─────────────────────────────────────────────
    /// OpenRouter API key — prefer env OPENROUTER_API_KEY
    pub openrouter_api_key: Option<String>,
    /// OpenRouter model (e.g. "google/gemini-2.0-flash-exp:free")
    #[serde(default = "default_openrouter_model")]
    pub openrouter_model: String,

    // ── Local fallback (Ollama / llama.cpp / LM Studio) ──────────────────
    /// Local server base URL (e.g. "http://localhost:11434/v1")
    pub local_base_url: Option<String>,
    /// Local model name (e.g. "llava:7b" for Ollama with vision)
    #[serde(default = "default_local_model")]
    pub local_model: String,

    /// Max tokens for object description
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// Max tokens for scene narrative
    #[serde(default = "default_max_narrative_tokens")]
    pub max_narrative_tokens: u32,
}

fn default_openrouter_model() -> String {
    env::var("VITE_VISION_OPENROUTER_MODEL").unwrap_or_else(|_| "google/gemini-2.0-flash-exp:free".to_string())
}
fn default_local_model() -> String {
    env::var("VITE_VISION_LOCAL_MODEL").unwrap_or_else(|_| "llava:7b".to_string())
}
fn default_max_tokens() -> u32 {
    80
}
fn default_max_narrative_tokens() -> u32 {
    400
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            openrouter_api_key: None,
            openrouter_model: default_openrouter_model(),
            local_base_url: Some("http://localhost:11434/v1".to_string()),
            local_model: default_local_model(),
            max_tokens: default_max_tokens(),
            max_narrative_tokens: default_max_narrative_tokens(),
        }
    }
}

/// Load configuration from broxeen.toml + environment variable overrides.
///
/// Search order:
///   1. ./broxeen.toml (working directory)
///   2. Environment variables: BROXEEN__CAMERA__URL, etc.
///   3. OPENROUTER_API_KEY env var (convenience shortcut)
pub fn load_config() -> Result<VisionConfig, config::ConfigError> {
    let builder = config::Config::builder()
        .add_source(config::File::with_name("broxeen").required(false))
        .add_source(
            config::Environment::with_prefix("BROXEEN")
                .separator("__")
                .try_parsing(true),
        );

    let settings = builder.build()?;
    let mut cfg = settings.try_deserialize::<VisionConfig>()?;

    // Convenience: OPENROUTER_API_KEY env var (without BROXEEN__ prefix)
    if cfg.llm.openrouter_api_key.is_none() {
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            if !key.is_empty() {
                cfg.llm.openrouter_api_key = Some(key);
            }
        }
    }

    Ok(cfg)
}

pub fn default_config() -> VisionConfig {
    VisionConfig {
        camera: CameraConfig {
            url: String::new(),
            camera_id: "cam0".into(),
            fps: None,
        },
        detector: DetectorConfig::default(),
        pipeline: PipelineConfig::default(),
        tracker: TrackerConfig::default(),
        scene: SceneConfig::default(),
        database: DatabaseConfig::default(),
        llm: LlmConfig::default(),
    }
}

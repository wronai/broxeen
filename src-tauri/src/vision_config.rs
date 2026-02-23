/// Vision Pipeline Configuration
///
/// Loaded from broxeen.toml (project root) with env-var overrides.
/// Env format: BROXEEN__SECTION__KEY (double underscore separators).

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct VisionConfig {
    pub camera: CameraConfig,
    #[serde(default)]
    pub detector: DetectorConfig,
    #[serde(default)]
    pub pipeline: PipelineConfig,
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
    #[serde(default = "default_max_input_size")]
    pub max_input_size: u32,
}

fn default_model_path() -> String {
    "models/yolov8n.onnx".to_string()
}
fn default_confidence_threshold() -> f32 {
    0.60
}
fn default_nms_threshold() -> f32 {
    0.45
}
fn default_max_input_size() -> u32 {
    500
}

impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            model_path: default_model_path(),
            confidence_threshold: default_confidence_threshold(),
            nms_threshold: default_nms_threshold(),
            max_input_size: default_max_input_size(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct PipelineConfig {
    #[serde(default = "default_process_every")]
    pub process_every_n_frames: u32,
    #[serde(default = "default_min_contour_area")]
    pub min_contour_area: f64,
    #[serde(default = "default_max_contour_area")]
    pub max_contour_area: f64,
    #[serde(default = "default_cooldown_seconds")]
    pub cooldown_seconds: u64,
    #[serde(default = "default_bg_history")]
    pub bg_history: i32,
    #[serde(default = "default_bg_var_threshold")]
    pub bg_var_threshold: f64,
    #[serde(default = "default_worker_threads")]
    pub worker_threads: usize,
}

fn default_process_every() -> u32 {
    5
}
fn default_min_contour_area() -> f64 {
    2000.0
}
fn default_max_contour_area() -> f64 {
    200000.0
}
fn default_cooldown_seconds() -> u64 {
    10
}
fn default_bg_history() -> i32 {
    500
}
fn default_bg_var_threshold() -> f64 {
    50.0
}
fn default_worker_threads() -> usize {
    2
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            process_every_n_frames: default_process_every(),
            min_contour_area: default_min_contour_area(),
            max_contour_area: default_max_contour_area(),
            cooldown_seconds: default_cooldown_seconds(),
            bg_history: default_bg_history(),
            bg_var_threshold: default_bg_var_threshold(),
            worker_threads: default_worker_threads(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_db_path")]
    pub path: String,
}

fn default_db_path() -> String {
    "detections.db".to_string()
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
    pub api_key: Option<String>,
    #[serde(default = "default_llm_model")]
    pub model: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

fn default_llm_model() -> String {
    "claude-haiku-4-5-20251001".to_string()
}
fn default_max_tokens() -> u32 {
    80
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            model: default_llm_model(),
            max_tokens: default_max_tokens(),
        }
    }
}

/// Load configuration from broxeen.toml + environment variable overrides.
///
/// Search order:
///   1. ./broxeen.toml (working directory)
///   2. <exe_dir>/broxeen.toml
///   3. Environment variables: BROXEEN__CAMERA__URL, etc.
pub fn load_config() -> Result<VisionConfig, config::ConfigError> {
    let builder = config::Config::builder()
        .add_source(config::File::with_name("broxeen").required(false))
        .add_source(
            config::Environment::with_prefix("BROXEEN")
                .separator("__")
                .try_parsing(true),
        );

    let settings = builder.build()?;
    settings.try_deserialize::<VisionConfig>()
}

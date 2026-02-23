use serde::Deserialize;
use anyhow::Result;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub camera:   CameraConfig,
    pub detector: DetectorConfig,
    pub pipeline: PipelineConfig,
    pub tracker:  TrackerConfig,
    pub scene:    SceneConfig,
    pub database: DatabaseConfig,
    pub llm:      LlmConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct CameraConfig {
    pub url:       String,
    pub camera_id: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DetectorConfig {
    pub model_path:           String,
    pub confidence_threshold: f32,
    pub nms_threshold:        f32,
    pub input_size:           u32,
    pub use_openvino:         bool,
    pub intra_threads:        u16,
}
impl Default for DetectorConfig {
    fn default() -> Self {
        Self {
            model_path: "models/yolov8s.onnx".into(),
            confidence_threshold: 0.50,
            nms_threshold: 0.45,
            input_size: 640,
            use_openvino: true,
            intra_threads: 2,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct PipelineConfig {
    pub process_every_n_frames: u32,
    pub bg_history:             i32,
    pub bg_var_threshold:       f64,
    pub min_activity_area:      f64,
}
impl Default for PipelineConfig {
    fn default() -> Self {
        Self { process_every_n_frames: 4, bg_history: 500, bg_var_threshold: 40.0, min_activity_area: 1500.0 }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct TrackerConfig {
    pub iou_match_threshold: f32,
    pub max_age_frames:      u32,
    pub min_hits:            u32,
    pub crop_max_px:         u32,
    pub crops_per_track:     usize,
}
impl Default for TrackerConfig {
    fn default() -> Self {
        Self { iou_match_threshold: 0.30, max_age_frames: 15, min_hits: 3, crop_max_px: 400, crops_per_track: 3 }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct SceneConfig {
    /// Flush buffer to LLM every N seconds (default: 60 = once per minute)
    pub flush_interval_secs:  u64,
    /// Minimum crops needed to justify an LLM call
    pub min_crops_for_llm:    usize,
    /// Ring buffer capacity (events)
    pub ring_capacity:        usize,
    /// Max crops to send per LLM call
    pub max_crops_per_batch:  usize,
}
impl Default for SceneConfig {
    fn default() -> Self {
        Self { flush_interval_secs: 60, min_crops_for_llm: 3, ring_capacity: 100, max_crops_per_batch: 10 }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub path: String,
}
impl Default for DatabaseConfig {
    fn default() -> Self { Self { path: "monitoring.db".into() } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct LlmConfig {
    // ── OpenRouter (primary) ─────────────────────────────────────────────
    /// OpenRouter API key — prefer env OPENROUTER_API_KEY
    pub openrouter_api_key: Option<String>,
    /// OpenRouter model (e.g. "google/gemini-2.0-flash-exp:free")
    pub openrouter_model:   String,

    // ── Local fallback (Ollama / llama.cpp / LM Studio) ──────────────────
    /// Local server base URL (e.g. "http://localhost:11434/v1")
    pub local_base_url: Option<String>,
    /// Local model name (e.g. "llava:7b" for Ollama with vision)
    pub local_model:    String,

    /// Max tokens for object description
    pub max_tokens:     u32,
    /// Max tokens for scene narrative
    pub max_narrative_tokens: u32,
}
impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            openrouter_api_key:   None,
            openrouter_model:     "google/gemini-2.0-flash-exp:free".into(),
            local_base_url:       Some("http://localhost:11434/v1".into()),
            local_model:          "llava:7b".into(),
            max_tokens:           80,
            max_narrative_tokens: 400,
        }
    }
}

pub fn load_config() -> Result<AppConfig> {
    // Also check OPENROUTER_API_KEY as well as BROXEEN__LLM__OPENROUTER_API_KEY
    let cfg = config::Config::builder()
        .add_source(config::File::with_name("broxeen").required(false))
        .add_source(config::Environment::with_prefix("BROXEEN").separator("__"))
        .build()?;
    let mut app: AppConfig = cfg.try_deserialize()?;

    // Convenience: OPENROUTER_API_KEY env var (without BROXEEN__ prefix)
    if app.llm.openrouter_api_key.is_none() {
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            app.llm.openrouter_api_key = Some(key);
        }
    }

    Ok(app)
}

pub fn default_config() -> AppConfig {
    AppConfig {
        camera:   CameraConfig { url: String::new(), camera_id: "cam0".into() },
        detector: DetectorConfig::default(),
        pipeline: PipelineConfig::default(),
        tracker:  TrackerConfig::default(),
        scene:    SceneConfig::default(),
        database: DatabaseConfig::default(),
        llm:      LlmConfig::default(),
    }
}

//! local_llm.rs — Local LLM integration using llama-cpp-rs.
//!
//! Provides local LLM inference for text-to-SQL queries using GGUF models.
//! Replaces remote OpenRouter API calls with local Bielik model inference.
//!
//! Features:
//! - Local GGUF model loading (Bielik-1.5B)
//! - Text-to-SQL generation with schema constraints
//! - Fallback to remote API when local model unavailable
//! - Polish language support

use std::env;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

#[cfg(feature = "local-llm")]
use llama_cpp_rs::{
    LLamaModel, 
    LLamaParams, 
    Tokenization,
    SamplingParams,
    CompletionParams
};

use crate::query_schema::{self, DataSource};

/// Default model path for Bielik
const DEFAULT_MODEL_PATH: &str = "models/Bielik-1.5B-v3.0-Instruct.Q8_0.gguf";

/// System prompt for text-to-SQL generation
const SQL_SYSTEM_PROMPT: &str = r#"Jesteś ekspertem SQL, który konwertuje pytania w języku polskim na zapytania SQLite SELECT.

ZASADY:
1. Generuj TYLKO zapytania SELECT (bez INSERT, UPDATE, DELETE)
2. Używaj dokładnych nazw kolumn i tabel z podanego schematu
3. Zwracaj SUROWE zapytanie SQL (bez ```sql, bez wyjaśnień)
4. Dla dat używaj formatu YYYY-MM-DD
5. Używaj LIMIT dla ograniczenia wyników

PRZYKŁAD:
Pytanie: "Pokaż ostatnie 10 detekcji"
SQL: SELECT timestamp, object_type, confidence FROM detections ORDER BY timestamp DESC LIMIT 10;

Teraz konwertuj to pytanie: "#;

/// Local LLM configuration
#[derive(Debug, Clone)]
pub struct LocalLlmConfig {
    pub model_path: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub context_size: u32,
    pub gpu_layers: i32,
}

impl Default for LocalLlmConfig {
    fn default() -> Self {
        Self {
            model_path: DEFAULT_MODEL_PATH.to_string(),
            max_tokens: 300,
            temperature: 0.0,
            context_size: 2048,
            gpu_layers: 0, // CPU-only by default
        }
    }
}

/// Local LLM wrapper
pub struct LocalLlm {
    #[cfg(feature = "local-llm")]
    model: Option<Arc<LLamaModel>>,
    config: LocalLlmConfig,
}

impl LocalLlm {
    /// Create new LocalLlm instance
    pub fn new() -> Self {
        let config = LocalLlmConfig::from_env();
        Self::with_config(config)
    }

    /// Create LocalLlm with custom config
    pub fn with_config(config: LocalLlmConfig) -> Self {
        #[cfg(feature = "local-llm")]
        let model = if Path::new(&config.model_path).exists() {
            match LLamaModel::from_file(&config.model_path, &LLamaParams::default()) {
                Ok(model) => {
                    log::info!("✅ Loaded local LLM: {}", config.model_path);
                    Some(Arc::new(model))
                }
                Err(e) => {
                    log::warn!("⚠️ Failed to load local LLM {}: {}", config.model_path, e);
                    None
                }
            }
        } else {
            log::warn!("⚠️ Local LLM model not found: {}", config.model_path);
            None
        };

        #[cfg(not(feature = "local-llm"))]
        log::info!("📝 Local LLM feature not enabled, using remote API");

        Self { 
            #[cfg(feature = "local-llm")]
            model,
            config 
        }
    }

    /// Check if local LLM is available
    pub fn is_available(&self) -> bool {
        #[cfg(feature = "local-llm")]
        return self.model.is_some();
        #[cfg(not(feature = "local-llm"))]
        return false;
    }

    /// Generate SQL from natural language using local LLM
    pub async fn text_to_sql(&self, question: &str, data_source: DataSource) -> Result<String, String> {
        #[cfg(feature = "local-llm")]
        if let Some(model) = &self.model {
            return self.generate_sql_local(model, question, data_source).await;
        }

        // Fallback to remote API
        crate::llm_query::text_to_sql(question, data_source).await
    }

    #[cfg(feature = "local-llm")]
    async fn generate_sql_local(
        &self,
        model: &Arc<LLamaModel>,
        question: &str,
        data_source: DataSource,
    ) -> Result<String, String> {
        let schema_prompt = query_schema::build_text_to_sql_prompt(data_source.schema());
        let full_prompt = format!("{}\n\n{}", SQL_SYSTEM_PROMPT, schema_prompt);
        
        // Build completion prompt
        let prompt = format!("{}\n\nPytanie: {}\n\nSQL:", full_prompt, question);

        // Sampling parameters for consistent SQL generation
        let sampling_params = SamplingParams {
            temperature: self.config.temperature,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            ..Default::default()
        };

        // Completion parameters
        let completion_params = CompletionParams {
            prompt: &prompt,
            max_tokens: Some(self.config.max_tokens),
            sampling_params,
            ..Default::default()
        };

        // Generate completion
        let result = model
            .complete(&completion_params)
            .await
            .map_err(|e| format!("Local LLM generation failed: {}", e))?;

        let sql = result
            .completion
            .trim()
            .trim_start_matches("```sql")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();

        if sql.is_empty() {
            return Err("Local LLM returned empty SQL".into());
        }

        // Validate SQL
        crate::llm_query::validate_sql(&sql)?;

        log::debug!("🔧 Generated SQL: {}", sql);
        Ok(sql)
    }
}

impl LocalLlmConfig {
    /// Create config from environment variables
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(path) = env::var("LOCAL_LLM_MODEL_PATH") {
            config.model_path = path;
        }

        if let Ok(tokens) = env::var("LOCAL_LLM_MAX_TOKENS") {
            if let Ok(tokens) = tokens.parse() {
                config.max_tokens = tokens;
            }
        }

        if let Ok(temp) = env::var("LOCAL_LLM_TEMPERATURE") {
            if let Ok(temp) = temp.parse() {
                config.temperature = temp;
            }
        }

        if let Ok(ctx) = env::var("LOCAL_LLM_CONTEXT_SIZE") {
            if let Ok(ctx) = ctx.parse() {
                config.context_size = ctx;
            }
        }

        if let Ok(gpu) = env::var("LOCAL_LLM_GPU_LAYERS") {
            if let Ok(gpu) = gpu.parse() {
                config.gpu_layers = gpu;
            }
        }

        config
    }
}

/// Global local LLM instance
static mut LOCAL_LLM: Option<LocalLlm> = None;
static INIT: std::sync::Once = std::sync::Once::new();

/// Get or initialize global local LLM instance
pub fn get_local_llm() -> &'static LocalLlm {
    unsafe {
        INIT.call_once(|| {
            LOCAL_LLM = Some(LocalLlm::new());
        });
        LOCAL_LLM.as_ref().unwrap()
    }
}

/// Execute text-to-SQL query with local LLM fallback
pub async fn execute_nl_query_local(
    question: &str,
    db_path_override: Option<&str>,
) -> Result<crate::llm_query::NlQueryResult, String> {
    let local_llm = get_local_llm();
    
    if local_llm.is_available() {
        log::info!("🤖 Using local LLM for query: {}", question);
        
        let data_source = query_schema::detect_data_source(question);
        let sql = local_llm.text_to_sql(question, data_source).await?;
        
        // Execute the SQL (reuse existing logic)
        crate::llm_query::execute_sql_with_query(sql, question, data_source, db_path_override).await
    } else {
        log::info!("🌐 Using remote API for query: {}", question);
        crate::llm_query::execute_nl_query(question, db_path_override).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_llm_config_from_env() {
        // Test default config
        let config = LocalLlmConfig::default();
        assert_eq!(config.model_path, DEFAULT_MODEL_PATH);
        assert_eq!(config.max_tokens, 300);
        assert_eq!(config.temperature, 0.0);

        // Test environment variable parsing
        env::set_var("LOCAL_LLM_MAX_TOKENS", "500");
        env::set_var("LOCAL_LLM_TEMPERATURE", "0.5");
        
        let config = LocalLlmConfig::from_env();
        assert_eq!(config.max_tokens, 500);
        assert_eq!(config.temperature, 0.5);
        
        env::remove_var("LOCAL_LLM_MAX_TOKENS");
        env::remove_var("LOCAL_LLM_TEMPERATURE");
    }

    #[test]
    fn test_sql_system_prompt() {
        assert!(SQL_SYSTEM_PROMPT.contains("ekspertem SQL"));
        assert!(SQL_SYSTEM_PROMPT.contains("TYLKO zapytania SELECT"));
        assert!(SQL_SYSTEM_PROMPT.contains("języku polskim"));
    }
}

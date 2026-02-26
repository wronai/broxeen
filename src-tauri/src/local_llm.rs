//! local_llm.rs — Local LLM integration using Ollama HTTP API.
//!
//! Provides local LLM inference for text-to-SQL queries using Ollama.
//! Replaces remote OpenRouter API calls with local Bielik model inference.
//!
//! Features:
//! - Local Ollama integration (Bielik-1.5B)
//! - Text-to-SQL generation with schema constraints
//! - Fallback to remote API when local model unavailable
//! - Polish language support

use std::env;
use std::sync::OnceLock;

use crate::query_schema::{self, DataSource};

/// Default model for Bielik
const DEFAULT_MODEL: &str = "bielik:1.5b";

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
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
    pub ollama_url: String,
    pub port: u16,
}

impl Default for LocalLlmConfig {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            max_tokens: 300,
            temperature: 0.0,
            ollama_url: "http://localhost".to_string(),
            port: 11434,
        }
    }
}

/// Local LLM wrapper
pub struct LocalLlm {
    pub config: LocalLlmConfig,
}

impl LocalLlm {
    /// Create new LocalLlm instance
    pub fn new() -> Self {
        let config = LocalLlmConfig::from_env();
        Self::with_config(config)
    }

    /// Create LocalLlm with custom config
    pub fn with_config(config: LocalLlmConfig) -> Self {
        tracing::info!("📝 Local LLM initialized with model: {}", config.model);
        Self { config }
    }

    /// Check if local LLM is available
    pub async fn is_available(&self) -> bool {
        let url = format!("{}:{}/api/tags", self.config.ollama_url, self.config.port);
        
        match reqwest::get(&url).await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    /// Generate SQL from natural language using local LLM
    pub async fn text_to_sql(&self, question: &str, data_source: DataSource) -> Result<String, String> {
        if self.is_available().await {
            return self.generate_sql_local(question, data_source).await;
        }

        // Fallback to remote API
        crate::llm_query::text_to_sql_remote(question, data_source).await
    }

    async fn generate_sql_local(&self, question: &str, data_source: DataSource) -> Result<String, String> {
        let schema_prompt = query_schema::build_text_to_sql_prompt(data_source.schema());
        let full_prompt = format!("{}\n\n{}", SQL_SYSTEM_PROMPT, schema_prompt);
        
        // Build completion prompt
        let prompt = format!("{}\n\nPytanie: {}\n\nSQL:", full_prompt, question);

        // Call Ollama API directly
        let url = format!("{}:{}/api/generate", self.config.ollama_url, self.config.port);
        
        let payload = serde_json::json!({
            "model": self.config.model,
            "prompt": prompt,
            "stream": false,
            "options": {
                "temperature": self.config.temperature,
                "num_predict": self.config.max_tokens,
                "top_p": 0.9,
                "top_k": 40
            }
        });

        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Local LLM request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Local LLM HTTP error: {}", response.status()));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Local LLM JSON parse error: {}", e))?;

        let sql = data["response"]
            .as_str()
            .unwrap_or("")
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
        crate::llm_query::validate_sql_public(&sql)?;

        tracing::debug!("🔧 Generated SQL: {}", sql);
        Ok(sql)
    }

    /// Pull model if not available
    pub async fn pull_model(&self) -> Result<(), String> {
        let url = format!("{}:{}/api/pull", self.config.ollama_url, self.config.port);
        
        let payload = serde_json::json!({
            "name": self.config.model
        });

        let client = reqwest::Client::new();
        let _response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Failed to pull model: {}", e))?;
        
        tracing::info!("✅ Model pull initiated: {}", self.config.model);
        Ok(())
    }
}

impl LocalLlmConfig {
    /// Create config from environment variables
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(model) = env::var("LOCAL_LLM_MODEL") {
            config.model = model;
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

        if let Ok(url) = env::var("LOCAL_LLM_OLLAMA_URL") {
            config.ollama_url = url;
        }

        if let Ok(port) = env::var("LOCAL_LLM_OLLAMA_PORT") {
            if let Ok(port) = port.parse() {
                config.port = port;
            }
        }

        config
    }
}

/// Global local LLM instance (safe initialization via OnceLock)
static LOCAL_LLM: OnceLock<LocalLlm> = OnceLock::new();

/// Get or initialize global local LLM instance
pub fn get_local_llm() -> &'static LocalLlm {
    LOCAL_LLM.get_or_init(LocalLlm::new)
}

/// Setup Bielik model in Ollama
#[allow(dead_code)]
pub async fn setup_bielik_model() -> Result<(), String> {
    let local_llm = get_local_llm();
    
    if !local_llm.is_available().await {
        return Err("Ollama is not running".into());
    }

    // Check if Bielik model exists
    let url = format!("{}:{}/api/tags", local_llm.config.ollama_url, local_llm.config.port);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {}", e))?;

    if !response.status().is_success() {
        return Err("Failed to connect to Ollama".into());
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse models: {}", e))?;

    let bielik_exists = data["models"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .any(|m| m["name"].as_str().unwrap_or("").contains("bielik"));
    
    if !bielik_exists {
        tracing::info!("📥 Bielik model not found, pulling from Ollama...");
        local_llm.pull_model().await?;
        tracing::info!("✅ Bielik model pull initiated");
    } else {
        tracing::info!("✅ Bielik model already available");
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_llm_config_from_env() {
        // Test default config
        let config = LocalLlmConfig::default();
        assert_eq!(config.model, DEFAULT_MODEL);
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

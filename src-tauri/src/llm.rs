//! llm.rs — OpenRouter API client for Tauri backend.
//! Handles API calls server-side to avoid CORS and protect API key.

use serde::{Deserialize, Serialize};
use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

// ── Types ────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub model: String,
}

// ── Tauri command ────────────────────────────────────

/// Tauri command: send chat completion to OpenRouter.
/// `messages` is a JSON string of the messages array.
#[tauri::command]
pub async fn llm_chat(
    messages: String,
    api_key: String,
    model: String,
    max_tokens: u32,
    temperature: f32,
) -> Result<LlmResponse, String> {
    crate::backend_info(format!(
        "Command llm_chat invoked (model='{}', max_tokens={})",
        model, max_tokens
    ));

    let key = if api_key.is_empty() {
        crate::backend_info("API key not provided in payload, falling back to OPENROUTER_API_KEY env var");
        env::var("OPENROUTER_API_KEY").unwrap_or_default()
    } else {
        api_key
    };

    if key.is_empty() {
        crate::backend_error("OPENROUTER_API_KEY not set and no fallback available");
        return Err("OPENROUTER_API_KEY not set".into());
    }

    let mdl = if model.is_empty() {
        crate::backend_info("Model not provided in payload, falling back to LLM_MODEL env var or default");
        env::var("LLM_MODEL").unwrap_or_else(|_| "google/gemini-3-flash-preview".into())
    } else {
        model
    };

    // Parse messages from JSON string
    let msgs: serde_json::Value =
        serde_json::from_str(&messages).map_err(|e| {
            crate::backend_error(format!("Failed to parse messages JSON: {}", e));
            format!("Invalid messages JSON: {e}")
        })?;

    crate::backend_info(format!(
        "LLM payload prepared for {} (messages={})",
        mdl,
        msgs.as_array().map_or(0, |a| a.len())
    ));

    let payload = serde_json::json!({
        "model": mdl,
        "messages": msgs,
        "max_tokens": max_tokens,
        "temperature": temperature,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            crate::backend_error(format!("LLM HTTP request failed: {}", e));
            format!("Request failed: {e}")
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let truncated = &body[..body.len().min(300)];
        crate::backend_error(format!("LLM HTTP error {}: {}", status, truncated));
        return Err(format!("HTTP {status}: {truncated}"));
    }

    crate::backend_info("LLM HTTP response received successfully");

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            crate::backend_error(format!("Failed to parse LLM JSON response: {}", e));
            format!("JSON parse error: {e}")
        })?;

    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let response_model = data["model"]
        .as_str()
        .unwrap_or(&mdl)
        .to_string();

    crate::backend_info(format!(
        "LLM response extracted (model='{}', text_len={})",
        response_model,
        text.len()
    ));

    Ok(LlmResponse {
        text,
        model: response_model,
    })
}

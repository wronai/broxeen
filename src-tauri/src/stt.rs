//! stt.rs — Speech-to-text via OpenRouter audio inputs.

use serde::{Deserialize, Serialize};
use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SttResponse {
    pub text: String,
}

#[tauri::command]
pub async fn stt_transcribe(
    audio_base64: String,
    format: String,
    language: String,
    api_key: String,
    model: String,
) -> Result<SttResponse, String> {
    crate::backend_info(format!(
        "Command stt_transcribe invoked (format='{}', lang='{}')",
        format, language
    ));

    if audio_base64.trim().is_empty() {
        crate::backend_warn("Empty audio payload received for stt_transcribe");
        return Err("Empty audio payload".into());
    }

    let key = if api_key.is_empty() {
        crate::backend_info(
            "API key not provided in payload, falling back to OPENROUTER_API_KEY env var",
        );
        env::var("OPENROUTER_API_KEY").unwrap_or_default()
    } else {
        api_key
    };

    if key.is_empty() {
        crate::backend_error("OPENROUTER_API_KEY not set and no fallback available");
        return Err("OPENROUTER_API_KEY not set".into());
    }

    let mdl = if model.is_empty() {
        crate::backend_info(
            "STT model not provided in payload, falling back to STT_MODEL env var or default",
        );
        env::var("STT_MODEL").unwrap_or_else(|_| "google/gemini-2.0-flash".into())
    } else {
        model
    };

    let lang = if language.trim().is_empty() {
        "pl".to_string()
    } else {
        language
    };

    let prompt = format!(
        "Please transcribe this audio file to plain text. Return ONLY the transcription. Language: {}.",
        lang
    );

    let payload = serde_json::json!({
        "model": mdl,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "input_audio", "input_audio": {"data": audio_base64, "format": format}}
            ]
        }],
        "max_tokens": 512,
        "temperature": 0.0
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
            crate::backend_error(format!("STT HTTP request failed: {}", e));
            format!("Request failed: {e}")
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let truncated = &body[..body.len().min(300)];
        crate::backend_error(format!("STT HTTP error {}: {}", status, truncated));
        return Err(format!("HTTP {status}: {truncated}"));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| {
        crate::backend_error(format!("Failed to parse STT JSON response: {}", e));
        format!("JSON parse error: {e}")
    })?;

    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    crate::backend_info(format!(
        "STT response extracted (model='{}', text_len={})",
        data["model"].as_str().unwrap_or("unknown"),
        text.len()
    ));

    Ok(SttResponse { text })
}

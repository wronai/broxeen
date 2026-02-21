//! stt.rs — Speech-to-Text via OpenRouter Whisper API.
//! Now accepts WAV base64 from native audio capture (audio_capture.rs).

use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/audio/transcriptions";

/// Transcribe WAV audio (base64-encoded) using OpenRouter Whisper.
///
/// Called by audio_commands::stt_stop after native recording finishes.
pub async fn transcribe_wav_base64(wav_base64: &str, lang: &str) -> Result<String, String> {
    let api_key = env::var("OPENROUTER_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err("OPENROUTER_API_KEY not set — STT requires cloud transcription".into());
    }

    let model = env::var("STT_MODEL").unwrap_or_else(|_| "openai/whisper-large-v3".into());

    println!("[stt] Sending {}KB of audio to {model}", wav_base64.len() / 1024);

    // Decode base64 to bytes for multipart upload
    let wav_bytes = base64_decode(wav_base64)?;

    // Build multipart form
    let form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(wav_bytes)
                .file_name("recording.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("MIME error: {e}"))?,
        )
        .text("model", model.clone())
        .text("language", lang.to_string())
        .text("response_format", "json".to_string());

    let client = reqwest::Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen-stt")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("STT request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("STT HTTP {status}: {}", &body[..body.len().min(300)]));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("STT JSON parse error: {e}"))?;

    let text = data["text"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("STT: pusty wynik transkrypcji (za cicho?)".into());
    }

    println!("[stt] Result: \"{text}\"");
    Ok(text)
}

/// Old Tauri command interface (kept for backward compatibility with useStt.ts).
#[tauri::command]
pub async fn stt_transcribe(
    audio_base64: String,
    format: String,
    language: Option<String>,
) -> Result<String, String> {
    let lang = language.as_deref().unwrap_or("pl");

    // If format is already WAV, use directly
    if format == "wav" {
        return transcribe_wav_base64(&audio_base64, lang).await;
    }

    // For other formats (webm, ogg), try anyway — Whisper handles many formats
    transcribe_wav_base64(&audio_base64, lang).await
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {e}"))
}

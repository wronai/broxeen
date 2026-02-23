//! stt.rs — Speech-to-Text via OpenRouter Whisper API.
//! Now accepts WAV base64 from native audio capture (audio_capture.rs).

use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Transcribe WAV audio (base64-encoded) using OpenRouter Whisper.
///
/// Called by audio_commands::stt_stop after native recording finishes.
pub async fn transcribe_wav_base64(
    wav_base64: &str,
    lang: &str,
    api_key_override: Option<&str>,
    model_override: Option<&str>,
) -> Result<String, String> {
    let api_key_from_env = env::var("OPENROUTER_API_KEY").unwrap_or_default();
    let api_key = api_key_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(api_key_from_env.trim());
    if api_key.is_empty() {
        return Err("OPENROUTER_API_KEY not set — STT requires cloud transcription".into());
    }

    let default_model = env::var("STT_MODEL").unwrap_or_else(|_| env::var("VITE_STT_MODEL").unwrap_or_else(|_| "openai/whisper-1".to_string()));
    let model = model_override
        .map(|s| s.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_model.trim().to_string());

    println!("[stt] Sending {}KB of audio to {model}", wav_base64.len() / 1024);

    // Build JSON body for chat completions API with audio input
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": format!("ZADANIE: Wykonaj DOKŁADNĄ transkrypcję audio na język {}.\n\nZASADY:\n1. ZWRÓĆ TYLKO SŁOWA USŁYSZANE NA NAGRANIU - słowo po słowie\n2. NIE DODAWAJ NICZEGO - żadnych wstępów, komentarzy, wyjaśnień, opisów\n3. NIE TWÓRZ TEKSTÓW KTÓRYCH NIE BYŁO NA NAGRANIU - to jest BŁĄD HALUCYNACJI\n4. Jeśli nagranie jest puste lub niezrozumiałe - zwróć pusty string\"\"\n5. NIE ODPOWIADAJ NA TREŚĆ - tylko przepisz co usłyszałeś\n\nPRZYKŁAD BŁĘDU (TEGO NIE RÓB):\nUżytkownik mówi: \"kamera\"\nTwój błędny wynik: \"W dzisiejszym materiale przedstawię Wam trzy rzeczy...\"\nPOPRAWNY wynik: \"kamera\"\n\nTwoja transkrypcja:", lang)
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": wav_base64,
                            "format": "wav"
                        }
                    }
                ]
            }
        ],
        "response_format": {"type": "text"}
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen-stt")
        .json(&body)
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

    // Extract transcription from chat completions response
    let text = data["choices"]
        .get(0)
        .and_then(|choice| choice["message"].as_object())
        .and_then(|msg| msg["content"].as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("STT: pusty wynik transkrypcji (za cicho?)".into());
    }

    // Hallucination detection - reject obvious LLM hallucinations
    let words: Vec<&str> = text.split_whitespace().collect();
    let total_words = words.len();
    
    // Check 1: If response is very long (>100 words) for typical voice command, likely hallucination
    if total_words > 100 {
        // Check for repetitive patterns (same word repeated many times)
        let mut word_counts = std::collections::HashMap::new();
        for word in &words {
            let normalized = word.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "");
            if !normalized.is_empty() {
                *word_counts.entry(normalized).or_insert(0) += 1;
            }
        }
        
        // Find most common word
        if let Some((most_common, count)) = word_counts.iter().max_by_key(|(_, count)| *count) {
            // If same word appears >30 times or >40% of text, it's likely hallucination
            if *count > 30 || (*count as f32 / total_words as f32) > 0.4 {
                return Err(format!(
                    "STT: wykryto halucynację (słowo '{}' powtórzone {} razy z {} słów)",
                    most_common, count, total_words
                ));
            }
        }
        
        // Check 2: Generic essay patterns that indicate model made up content
        let generic_starts = [
            "w dzisiejszych czasach",
            "w dzisiejszym świecie", 
            "w dzisiejszym materiale",
            "kamera może przyjąć",
            "technologia stale się rozwija",
        ];
        let lower_text = text.to_lowercase();
        for pattern in &generic_starts {
            if lower_text.starts_with(pattern) && total_words > 50 {
                return Err(format!(
                    "STT: wykryto halucynację (generyczny tekst nie związany z mową, {} słów)",
                    total_words
                ));
            }
        }
    }

    println!("[stt] Result: \"{}\"", text.chars().take(100).collect::<String>());
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
        return transcribe_wav_base64(&audio_base64, lang, None, None).await;
    }

    // For other formats (webm, ogg), try anyway — Whisper handles many formats
    transcribe_wav_base64(&audio_base64, lang, None, None).await
}


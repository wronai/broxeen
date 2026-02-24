//! stt.rs — Speech-to-Text via OpenRouter multimodal API.
//! Accepts WAV base64 from native audio capture (audio_capture.rs).

use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_STT_MODEL: &str = "google/gemini-2.0-flash-exp:free";

// ── Voice Activity Detection (VAD) ─────────────────────────────────────

pub struct VadResult {
    pub is_speech: bool,
    pub rms: f32,
    pub zcr: f32,
    pub confidence: f32,  // 0.0–1.0
}

/// RMS Energy - najszybsza metoda detekcji mowy
fn rms_energy(samples: &[i16]) -> f32 {
    if samples.is_empty() { return 0.0; }
    let sum: f64 = samples.iter()
        .map(|&s| { let f = s as f64 / 32768.0; f * f })
        .sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// Zero Crossing Rate - rozróżnia mowę od szumu
fn zero_crossing_rate(samples: &[i16]) -> f32 {
    if samples.len() < 2 { return 0.0; }
    let crossings = samples.windows(2)
        .filter(|w| (w[0] >= 0) != (w[1] >= 0))
        .count();
    crossings as f32 / (samples.len() - 1) as f32
}

/// Połączone VAD - najdokładniejsza metoda
pub fn detect_voice_activity(samples: &[i16], sample_rate: u32) -> VadResult {
    // Analizuj ramki po 20ms (standard w VAD)
    let frame_size = (sample_rate / 1000 * 20) as usize;
    
    if samples.len() < frame_size {
        return VadResult { is_speech: false, rms: 0.0, zcr: 0.0, confidence: 0.0 };
    }

    // Analizuj środkową część nagrania (odrzuć pierwsze/ostatnie 100ms)
    let skip = (sample_rate / 10) as usize;  // 100ms
    let analysis_start = skip.min(samples.len() / 4);
    let analysis_end = samples.len().saturating_sub(skip).max(analysis_start + frame_size);
    let window = &samples[analysis_start..analysis_end];

    // Podziel na ramki, zbierz statystyki
    let frames: Vec<(f32, f32)> = window.chunks(frame_size)
        .map(|frame| (rms_energy(frame), zero_crossing_rate(frame)))
        .collect();

    if frames.is_empty() {
        return VadResult { is_speech: false, rms: 0.0, zcr: 0.0, confidence: 0.0 };
    }

    let avg_rms: f32 = frames.iter().map(|(r, _)| r).sum::<f32>() / frames.len() as f32;
    let avg_zcr: f32 = frames.iter().map(|(_, z)| z).sum::<f32>() / frames.len() as f32;
    let max_rms: f32 = frames.iter().map(|(r, _)| *r).fold(0.0_f32, f32::max);

    // Ile ramek przekracza próg energii?
    let active_frames = frames.iter()
        .filter(|(r, _)| *r > 0.008)
        .count();
    let active_ratio = active_frames as f32 / frames.len() as f32;

    // Punktacja: każdy czynnik głosuje niezależnie - dostosowane do cichszych sygnałów
    let energy_score   = (avg_rms / 0.01).min(1.0);          // RMS > 0.01 = wystarczająca mowa
    let zcr_score      = if avg_zcr > 0.01 && avg_zcr < 0.50 { 1.0 } else { 0.0 };
    let activity_score = (active_ratio / 0.2).min(1.0);       // >20% ramek aktywnych
    let peak_score     = (max_rms / 0.02).min(1.0);           // peak > 0.02

    // Ważona suma głosów
    let confidence = energy_score   * 0.40
                   + zcr_score      * 0.20
                   + activity_score * 0.25
                   + peak_score     * 0.15;

    VadResult {
        is_speech: confidence > 0.25,  // niższy próg dla cichszych mikrofonów
        rms: avg_rms,
        zcr: avg_zcr,
        confidence,
    }
}

/// Parsuj próbki PCM16 z nagłówka WAV (44 bajty header)
fn parse_wav_samples(wav_bytes: &[u8]) -> Result<Vec<i16>, String> {
    if wav_bytes.len() < 44 {
        return Err("WAV za krótki".into());
    }
    // Standardowy WAV: 44 bajty nagłówka, potem PCM16 little-endian
    let data = &wav_bytes[44..];
    let samples: Vec<i16> = data.chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    Ok(samples)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {e}"))
}

/// Resolve the API key: prefer explicit override, then env var.
fn resolve_api_key<'a>(override_key: Option<&'a str>, env_key: &'a str) -> Option<&'a str> {
    override_key
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .or_else(|| {
            let trimmed = env_key.trim();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        })
}

/// Transcribe WAV audio (base64-encoded) using OpenRouter multimodal API.
///
/// Called by `stt_stop` (audio_commands.rs) after native recording finishes.
pub async fn transcribe_wav_base64(
    wav_base64: &str,
    lang: &str,
    api_key_override: Option<&str>,
    model_override: Option<&str>,
) -> Result<String, String> {
    let env_key = env::var("OPENROUTER_API_KEY").unwrap_or_default();
    let api_key = resolve_api_key(api_key_override, &env_key)
        .ok_or("OPENROUTER_API_KEY nie ustawiony — STT wymaga transkrypcji w chmurze")?;

    let env_model = env::var("STT_MODEL")
        .unwrap_or_else(|_| DEFAULT_STT_MODEL.to_string());
    let model = model_override
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| env_model.trim())
        .to_string();

    let audio_kb = wav_base64.len() / 1024;
    if audio_kb < 1 {
        return Err("STT: nagranie zbyt krótkie (<1KB) — prawdopodobnie cisza".into());
    }
    if audio_kb > 10_000 {
        return Err("STT: nagranie zbyt duże (>10MB) — ogranicz długość".into());
    }
    
    println!("[stt] Wysyłam {audio_kb}KB audio do modelu: {model}");

    // ── PRE-CHECK: VAD - czy w ogóle jest mowa? ─────────────────────────────
    let wav_bytes = base64_decode(wav_base64)?;
    let samples = parse_wav_samples(&wav_bytes)?;
    
    let vad = detect_voice_activity(&samples, 16000);
    
    // Debug logging - pomoże w kalibracji progów
    #[cfg(debug_assertions)]
    {
        println!(
            "[stt] VAD DEBUG: rms={:.5}, zcr={:.3}, confidence={:.3}, speech={}, frames={}",
            vad.rms, vad.zcr, vad.confidence, vad.is_speech, samples.len() / 320
        );
        
        if vad.rms < 0.001 {
            println!("[stt] VAD HINT: RMS bardzo niski - mów głośniej lub sprawdź mikrofon");
        } else if vad.confidence < 0.3 {
            println!("[stt] VAD HINT: Confidence niski - może być szum tła");
        }
    }
    
    println!(
        "[stt] VAD: is_speech={}, rms={:.4}, zcr={:.3}, confidence={:.2}",
        vad.is_speech, vad.rms, vad.zcr, vad.confidence
    );

    if !vad.is_speech {
        return Err(format!(
            "STT: brak mowy (rms={:.4}, zcr={:.3}, confidence={:.2})",
            vad.rms, vad.zcr, vad.confidence
        ));
    }

    println!("[stt] ✓ Mowa wykryta - wysyłam do transkrypcji");

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": format!(
                            "Transkrybuj dokładnie audio na język {}. \
                             Jeśli nagranie jest puste, zbyt ciche lub niezrozumiałe — zwróć pusty string.",
                            lang
                        )
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
        "temperature": 0.0
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
        .map_err(|e| format!("STT: błąd żądania HTTP: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let preview = &text[..text.len().min(300)];
        return Err(format!("STT: HTTP {status}: {preview}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("STT: błąd parsowania JSON: {e}"))?;

    let text = data["choices"]
        .get(0)
        .and_then(|c| c["message"]["content"].as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("STT: pusty wynik transkrypcji (za cicho lub cisza?)".into());
    }

    detect_artifacts(&text)?;

    println!("[stt] Wynik: \"{}\"", text.chars().take(120).collect::<String>());
    Ok(text)
}

/// Reject transcriptions that look like audio-processing glitches
/// (e.g. a single word repeated dozens of times).
fn detect_artifacts(text: &str) -> Result<(), String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let total = words.len();
    if total < 10 {
        return Ok(());
    }

    // Count occurrences of each normalised word.
    let mut counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::with_capacity(total);
    for w in &words {
        let key = w
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>();
        if !key.is_empty() {
            *counts.entry(key).or_insert(0) += 1;
        }
    }

    // Deterministic: sort by count desc, then alphabetically.
    let mut sorted: Vec<(String, usize)> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    if let Some((word, count)) = sorted.first() {
        let ratio = *count as f32 / total as f32;
        if ratio > 0.5 {
            return Err(format!(
                "STT: artefakt przetwarzania audio \
                 (słowo '{word}' powtórzone {count}/{total} razy — \
                 nagranie zbyt ciche lub uszkodzone)"
            ));
        }
    }

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Called by useStt.ts: `invoke("stt_transcribe", { audioBase64, format, language })`
///
/// Legacy path: frontend captured audio via MediaRecorder and sends it directly.
/// For the native Tauri flow (cpal → stop_and_encode_wav) use `stt_stop` in
/// audio_commands.rs instead.
#[tauri::command]
pub async fn stt_transcribe(
    audio_base64: String,
    format: String,
    language: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    let lang = language.as_deref().unwrap_or("pl");

    // Whisper / Gemini accept WAV; other container formats (webm, ogg) are
    // passed through — the model handles them on the server side.
    if format != "wav" {
        println!("[stt] Uwaga: format '{format}' przekazywany bez konwersji");
    }

    transcribe_wav_base64(
        &audio_base64,
        lang,
        api_key.as_deref(),
        model.as_deref(),
    )
    .await
}
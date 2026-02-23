//! audio_commands.rs — Tauri commands for native STT + TTS.
//! Add these to main.rs with: mod audio_commands;
//!
//! Register in .invoke_handler(tauri::generate_handler![
//!     ...,
//!     audio_commands::stt_start,
//!     audio_commands::stt_stop,
//!     audio_commands::stt_status,
//!     audio_commands::backend_tts_speak,
//!     audio_commands::backend_tts_speak_base64,
//!     audio_commands::backend_tts_info,
//!     audio_commands::backend_audio_devices,
//! ])

use crate::audio_capture::{self, SharedRecordingState};
use crate::stt;
use crate::tts_backend;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use serde_json;

/// Load current settings from disk
fn load_settings() -> crate::AudioSettings {
    crate::backend_info("load_settings() called - reading TTS engine preference");
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let settings_path = PathBuf::from(home).join(".config/broxeen/settings.json");
    
    if !settings_path.exists() {
        crate::backend_warn("Settings file not found, using defaults");
        return crate::AudioSettings::default();
    }
    
    let data = match std::fs::read_to_string(&settings_path) {
        Ok(data) => data,
        Err(err) => {
            crate::backend_error(format!("Failed to read settings: {}", err));
            return crate::AudioSettings::default();
        }
    };
    
    match serde_json::from_str::<crate::AudioSettings>(&data) {
        Ok(settings) => settings,
        Err(err) => {
            crate::backend_error(format!("Failed to parse settings: {}", err));
            crate::AudioSettings::default()
        }
    }
}

/// Active recording stream, stored in Tauri state.
pub struct ActiveStream(pub Arc<Mutex<Option<cpal::Stream>>>);

unsafe impl Send for ActiveStream {}
unsafe impl Sync for ActiveStream {}

pub struct ActiveTts(pub Arc<Mutex<Option<(rodio::OutputStream, rodio::Sink)>>>);

unsafe impl Send for ActiveTts {}
unsafe impl Sync for ActiveTts {}

/// Active wake word listening stream
pub struct ActiveWakeWordStream(pub Arc<Mutex<Option<cpal::Stream>>>);

unsafe impl Send for ActiveWakeWordStream {}
unsafe impl Sync for ActiveWakeWordStream {}

// ── STT Commands ─────────────────────────────────────

/// Start recording from microphone.
#[tauri::command]
pub fn stt_start(
    recording_state: tauri::State<SharedRecordingState>,
    active_stream: tauri::State<ActiveStream>,
) -> Result<String, String> {
    crate::backend_info("Command stt_start invoked");

    // Check if already recording
    {
        let s = recording_state.lock().unwrap();
        if s.is_recording {
            crate::backend_warn("stt_start rejected: already recording");
            return Err("Already recording".into());
        }
        crate::backend_info(format!("Current recording state: is_recording={}, samples={}", s.is_recording, s.samples.len()));
    }

    crate::backend_info("Starting native audio capture...");
    let stream = audio_capture::start_recording(&recording_state)?;

    // Store stream handle so it stays alive
    *active_stream.0.lock().unwrap() = Some(stream);
    crate::backend_info("✓ Native microphone recording started successfully");

    Ok("Recording started".into())
}

/// Stop recording, transcribe via cloud STT, return text.
#[tauri::command]
pub async fn stt_stop(
    recording_state: tauri::State<'_, SharedRecordingState>,
    active_stream: tauri::State<'_, ActiveStream>,
    language: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<String, String> {
    crate::backend_info("Command stt_stop invoked");
    crate::backend_info(format!("STT params: language={:?}, api_key_set={}, model={:?}", 
        language, 
        api_key.as_ref().map_or(false, |k| !k.is_empty()),
        model));

    // Drop the stream to stop recording
    {
        let mut stream = active_stream.0.lock().unwrap();
        crate::backend_info("Stopping audio capture stream...");
        *stream = None; // drops the cpal::Stream, stopping capture
    }

    // Small delay to let the last buffer flush
    crate::backend_info("Waiting 100ms for buffer flush...");
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Encode recorded audio to WAV base64
    crate::backend_info("Encoding recorded audio to WAV...");
    let (wav_base64, sample_rate) = audio_capture::stop_and_encode_wav(&recording_state)?;
    let lang = language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pl");

    crate::backend_info(format!(
        "✓ Audio encoded: sample_rate={}, payload_kb={}, sending to STT provider (lang={})",
        sample_rate,
        wav_base64.len() / 1024,
        lang
    ));

    // Send to OpenRouter Whisper for transcription
    let transcript = stt::transcribe_wav_base64(
        &wav_base64,
        lang,
        api_key.as_deref(),
        model.as_deref(),
    )
    .await?;

    crate::backend_info(format!(
        "✓ STT transcript ready: \"{}\" (len={})",
        transcript.chars().take(50).collect::<String>(),
        transcript.len()
    ));
    Ok(transcript)
}

/// Get recording status info.
#[tauri::command]
pub fn stt_status(
    recording_state: tauri::State<SharedRecordingState>,
) -> Result<SttStatus, String> {
    crate::backend_info("Command stt_status invoked");

    let s = recording_state.lock().unwrap();
    Ok(SttStatus {
        is_recording: s.is_recording,
        samples_count: s.samples.len(),
        duration_seconds: if s.sample_rate > 0 {
            s.samples.len() as f32 / s.sample_rate as f32
        } else {
            0.0
        },
    })
}

/// Get current microphone level (0.0-1.0).
#[tauri::command]
pub fn stt_get_mic_level(
    recording_state: tauri::State<SharedRecordingState>,
) -> f32 {
    audio_capture::get_mic_level(&recording_state)
}

/// Check if the last N seconds of recorded audio are silence.
/// Used by the frontend to auto-stop recording when the user stops speaking.
#[tauri::command]
pub fn stt_is_silence(
    recording_state: tauri::State<SharedRecordingState>,
    threshold_seconds: f32,
    rms_threshold: f32,
) -> bool {
    audio_capture::is_silence(&recording_state, threshold_seconds, rms_threshold)
}

#[derive(serde::Serialize)]
pub struct SttStatus {
    pub is_recording: bool,
    pub samples_count: usize,
    pub duration_seconds: f32,
}

// ── TTS Commands ─────────────────────────────────────

/// Speak text through the system audio output (Piper or espeak-ng).
/// Non-blocking — audio plays in background.
#[tauri::command]
pub async fn backend_tts_speak(
    active_tts: tauri::State<'_, ActiveTts>,
    text: String,
    rate: Option<f32>,
    volume: Option<f32>,
    lang: Option<String>,
) -> Result<(), String> {
    let rate = rate.unwrap_or(1.0);
    let volume = volume.unwrap_or(1.0);
    let lang = lang.unwrap_or_else(|| "pl-PL".into());

    crate::backend_info(format!(
        "Command backend_tts_speak invoked (text_len={}, lang={}, rate={}, volume={})",
        text.len(),
        lang,
        rate,
        volume
    ));

    // Load current settings to get preferred TTS engine
    let settings = load_settings();
    let engine = settings.tts_engine.clone();

    // Stop current playback immediately before synthesis begins
    {
        *active_tts.0.lock().unwrap() = None;
    }

    if text.trim().is_empty() {
        return Ok(());
    }

    let wav = tokio::task::spawn_blocking(move || {
        tts_backend::synthesize_to_wav_with_engine(&text, rate, &lang, &engine)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // Start playback
    let (stream, sink) = tts_backend::play_wav_stoppable(&wav, volume)?;

    // Store in state so we can stop/pause it later
    *active_tts.0.lock().unwrap() = Some((stream, sink));

    Ok(())
}

#[tauri::command]
pub fn backend_tts_stop(active_tts: tauri::State<ActiveTts>) {
    crate::backend_info("Command backend_tts_stop invoked");
    *active_tts.0.lock().unwrap() = None;
}

#[tauri::command]
pub fn backend_tts_pause(active_tts: tauri::State<ActiveTts>) {
    crate::backend_info("Command backend_tts_pause invoked");
    if let Some((_, sink)) = active_tts.0.lock().unwrap().as_ref() {
        sink.pause();
    }
}

#[tauri::command]
pub fn backend_tts_resume(active_tts: tauri::State<ActiveTts>) {
    crate::backend_info("Command backend_tts_resume invoked");
    if let Some((_, sink)) = active_tts.0.lock().unwrap().as_ref() {
        sink.play();
    }
}

/// Synthesize text to WAV and return as base64.
/// For frontend playback via <audio> element.
#[tauri::command]
pub fn backend_tts_speak_base64(
    text: String,
    rate: Option<f32>,
    lang: Option<String>,
) -> Result<String, String> {
    let rate = rate.unwrap_or(1.0);
    let lang = lang.unwrap_or_else(|| "pl-PL".into());

    crate::backend_info(format!(
        "Command backend_tts_speak_base64 invoked (text_len={}, lang={}, rate={})",
        text.len(),
        lang,
        rate
    ));

    // Load current settings to get preferred TTS engine
    let settings = load_settings();
    crate::backend_info(format!(
        "Using TTS engine from settings: '{}'", 
        settings.tts_engine
    ));

    tts_backend::speak_to_base64_with_engine(&text, rate, &lang, &settings.tts_engine)
}

/// Get info about available TTS engine.
#[tauri::command]
pub fn backend_tts_info() -> TtsInfo {
    crate::backend_info("Command backend_tts_info invoked");

    let engine = tts_backend::detect_tts_engine();
    let setup_hint = tts_backend::piper_setup_instructions();

    TtsInfo {
        engine: format!("{:?}", engine),
        engine_info: tts_backend::tts_engine_info(),
        piper_installed: engine == tts_backend::TtsEngine::Piper,
        setup_instructions: setup_hint,
    }
}

#[derive(serde::Serialize)]
pub struct TtsInfo {
    pub engine: String,
    pub engine_info: String,
    pub piper_installed: bool,
    pub setup_instructions: Option<String>,
}

// ── Audio Device Commands ────────────────────────────

/// List available audio input devices.
#[tauri::command]
pub fn backend_audio_devices() -> Result<AudioDevices, String> {
    crate::backend_info("Command backend_audio_devices invoked");

    let inputs = audio_capture::list_input_devices()?;
    Ok(AudioDevices { inputs })
}

#[derive(serde::Serialize)]
pub struct AudioDevices {
    pub inputs: Vec<String>,
}

// ── Piper Install Commands ───────────────────────────

/// Download and install Piper TTS binary + Polish voice model.
#[tauri::command]
pub async fn piper_install() -> Result<String, String> {
    crate::backend_info("Command piper_install invoked");
    tts_backend::download_and_install_piper().await
}

/// Check if Piper is installed.
#[tauri::command]
pub fn piper_is_installed() -> bool {
    tts_backend::piper_is_installed()
}

// ── Wake Word Commands ─────────────────────────────

use crate::wake_word::{self, SharedWakeWordState};

/// Start wake word listening for "heyken"
#[tauri::command]
pub fn wake_word_start(
    wake_word_state: tauri::State<SharedWakeWordState>,
    active_wake_word_stream: tauri::State<ActiveWakeWordStream>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    crate::backend_info("Command wake_word_start invoked");

    // Check if already listening
    {
        let s = wake_word_state.lock().unwrap();
        if s.is_listening {
            crate::backend_warn("wake_word_start rejected: already listening");
            return Err("Already listening for wake word".into());
        }
    }

    let stream = wake_word::start_wake_word_listening(&wake_word_state, app_handle)?;

    // Store stream to keep it alive
    {
        let mut active = active_wake_word_stream.0.lock().unwrap();
        *active = Some(stream);
    }

    Ok("Wake word listening started".into())
}

/// Stop wake word listening
#[tauri::command]
pub fn wake_word_stop(
    wake_word_state: tauri::State<SharedWakeWordState>,
    active_wake_word_stream: tauri::State<ActiveWakeWordStream>,
) -> Result<String, String> {
    crate::backend_info("Command wake_word_stop invoked");
    
    // Drop the stream to stop listening
    {
        let mut active = active_wake_word_stream.0.lock().unwrap();
        *active = None;
    }
    
    wake_word::stop_wake_word_listening(&wake_word_state);
    Ok("Wake word listening stopped".into())
}

/// Check if wake word was detected (polling approach)
#[tauri::command]
pub fn wake_word_check_triggered(
    wake_word_state: tauri::State<SharedWakeWordState>,
) -> Result<bool, String> {
    Ok(wake_word::check_wake_word_triggered(&wake_word_state))
}


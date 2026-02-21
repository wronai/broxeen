//! tts.rs — Desktop TTS fallback for runtimes without Web Speech API.

use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::path::PathBuf;
use serde_json;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TtsAvailability {
    pub supported: bool,
    pub backend: String,
    pub reason: Option<String>,
}

static ACTIVE_TTS_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

/// Load current settings from disk
fn load_settings() -> crate::AudioSettings {
    crate::backend_info("tts.rs: load_settings() called - reading TTS engine preference");
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let settings_path = PathBuf::from(home).join(".config/broxeen/settings.json");
    
    if !settings_path.exists() {
        crate::backend_warn("tts.rs: Settings file not found, using defaults");
        return crate::AudioSettings::default();
    }
    
    let data = match std::fs::read_to_string(&settings_path) {
        Ok(data) => data,
        Err(err) => {
            crate::backend_error(format!("tts.rs: Failed to read settings: {}", err));
            return crate::AudioSettings::default();
        }
    };
    
    match serde_json::from_str::<crate::AudioSettings>(&data) {
        Ok(settings) => {
            crate::backend_info(format!("tts.rs: Loaded TTS engine preference: '{}'", settings.tts_engine));
            settings
        },
        Err(err) => {
            crate::backend_error(format!("tts.rs: Failed to parse settings: {}", err));
            crate::AudioSettings::default()
        }
    }
}

fn active_tts_child() -> &'static Mutex<Option<Child>> {
    ACTIVE_TTS_CHILD.get_or_init(|| Mutex::new(None))
}

fn detect_backend() -> Option<&'static str> {
    let candidates = ["espeak-ng", "espeak"];

    for candidate in candidates {
        let status = Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if let Ok(exit_status) = status {
            if exit_status.success() {
                return Some(candidate);
            }
        }
    }

    None
}

fn normalize_lang(lang: &str) -> String {
    let trimmed = lang.trim();
    if trimmed.is_empty() {
        return "pl".to_string();
    }

    let normalized = trimmed.replace('_', "-").to_lowercase();
    normalized
        .split('-')
        .next()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "pl".to_string())
}

fn map_rate(rate: f32) -> i32 {
    let bounded = rate.clamp(0.5, 2.0);
    (175.0 * bounded).round().clamp(80.0, 450.0) as i32
}

fn map_pitch(pitch: f32) -> i32 {
    let normalized = 50.0 + ((pitch.clamp(0.5, 2.0) - 1.0) * 25.0);
    normalized.round().clamp(0.0, 99.0) as i32
}

fn map_volume(volume: f32) -> i32 {
    (volume.clamp(0.0, 2.0) * 100.0).round().clamp(0.0, 200.0) as i32
}

fn stop_active_tts_child() -> Result<(), String> {
    let mut guard = active_tts_child()
        .lock()
        .map_err(|_| "Failed to lock active TTS process state".to_string())?;

    if let Some(mut child) = guard.take() {
        let pid = child.id();
        match child.try_wait() {
            Ok(Some(status)) => {
                crate::backend_info(format!(
                    "No active TTS process to stop (already exited: pid={}, status={})",
                    pid, status
                ));
            }
            Ok(None) => {
                crate::backend_info(format!("Stopping active TTS process (pid={})", pid));
                if let Err(error) = child.kill() {
                    crate::backend_warn(format!("Failed to kill TTS process {}: {}", pid, error));
                }
                if let Err(error) = child.wait() {
                    crate::backend_warn(format!(
                        "Failed to wait for terminated TTS process {}: {}",
                        pid, error
                    ));
                }
            }
            Err(error) => {
                crate::backend_warn(format!(
                    "Failed to inspect active TTS process {}: {}",
                    pid, error
                ));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn tts_is_available() -> TtsAvailability {
    if let Some(backend) = detect_backend() {
        crate::backend_info(format!("TTS backend available: {}", backend));
        return TtsAvailability {
            supported: true,
            backend: backend.to_string(),
            reason: None,
        };
    }

    crate::backend_warn("No supported local TTS backend found (expected: espeak-ng or espeak)");

    TtsAvailability {
        supported: false,
        backend: "none".to_string(),
        reason: Some(
            "Brak lokalnego backendu TTS. Zainstaluj pakiet 'espeak-ng' lub 'espeak'."
                .to_string(),
        ),
    }
}

#[tauri::command]
pub fn tts_speak(
    text: String,
    lang: String,
    rate: f32,
    pitch: f32,
    volume: f32,
    voice: Option<String>,
) -> Result<(), String> {
    let prepared_text = text.trim().to_string();
    if prepared_text.is_empty() {
        return Err("Empty text payload for TTS".to_string());
    }

    // Load settings to get preferred TTS engine
    let settings = load_settings();
    crate::backend_info(format!(
        "tts_speak: Using TTS engine from settings: '{}'", 
        settings.tts_engine
    ));

    // Choose backend based on settings
    let backend = if settings.tts_engine == "piper" {
        // Try to use Piper if available, otherwise fallback to espeak
        crate::backend_warn("Piper requested in settings but not available in tts_speak, falling back to espeak-ng");
        detect_backend().ok_or_else(|| {
            "Brak lokalnego backendu TTS. Zainstaluj pakiet 'espeak-ng' lub 'espeak'.".to_string()
        })?
    } else {
        // Use auto-detection for espeak or auto
        detect_backend().ok_or_else(|| {
            "Brak lokalnego backendu TTS. Zainstaluj pakiet 'espeak-ng' lub 'espeak'.".to_string()
        })?
    };

    stop_active_tts_child()?;

    let voice_name = voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| normalize_lang(&lang));

    let speed = map_rate(rate).to_string();
    let pitch_value = map_pitch(pitch).to_string();
    let volume_value = map_volume(volume).to_string();

    crate::backend_info(format!(
        "Starting TTS playback via {} (text_len={}, voice='{}', rate={}, pitch={}, volume={})",
        backend,
        prepared_text.len(),
        voice_name,
        speed,
        pitch_value,
        volume_value
    ));

    let child = Command::new(backend)
        .arg("-v")
        .arg(voice_name)
        .arg("-s")
        .arg(speed)
        .arg("-p")
        .arg(pitch_value)
        .arg("-a")
        .arg(volume_value)
        .arg(prepared_text)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            crate::backend_error(format!("Failed to spawn backend TTS process: {}", error));
            format!("Failed to spawn backend TTS process: {}", error)
        })?;

    let pid = child.id();

    let mut guard = active_tts_child()
        .lock()
        .map_err(|_| "Failed to lock active TTS process state".to_string())?;
    *guard = Some(child);

    crate::backend_info(format!("TTS playback process started (pid={})", pid));

    Ok(())
}

#[tauri::command]
pub fn tts_stop() -> Result<(), String> {
    crate::backend_info("Command tts_stop invoked");
    stop_active_tts_child()
}

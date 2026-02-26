/// Settings management — load, save, and migrate audio settings.

use crate::logging::{backend_info, backend_warn, backend_error};
use std::env;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioSettings {
    #[serde(default = "default_tts_enabled")]
    pub tts_enabled: bool,
    #[serde(default = "default_tts_rate")]
    pub tts_rate: f32,
    #[serde(default = "default_tts_pitch")]
    pub tts_pitch: f32,
    #[serde(default = "default_tts_volume")]
    pub tts_volume: f32,
    #[serde(default)]
    pub tts_voice: String,
    #[serde(default = "default_tts_lang")]
    pub tts_lang: String,
    #[serde(default = "default_tts_engine")]
    pub tts_engine: String,
    #[serde(default = "default_stt_enabled")]
    pub stt_enabled: bool,
    #[serde(default = "default_stt_engine")]
    pub stt_engine: String,
    #[serde(default = "default_stt_model")]
    pub stt_model: String,
    #[serde(default = "default_mic_enabled")]
    pub mic_enabled: bool,
    #[serde(default = "default_device_id")]
    pub mic_device_id: String,
    #[serde(default = "default_device_id")]
    pub speaker_device_id: String,
    #[serde(default = "default_auto_listen")]
    pub auto_listen: bool,
}

fn default_tts_enabled() -> bool { true }
fn default_tts_rate() -> f32 { 1.0 }
fn default_tts_pitch() -> f32 { 1.0 }
fn default_tts_volume() -> f32 { 1.0 }
fn default_tts_lang() -> String { "pl-PL".to_string() }
fn default_tts_engine() -> String { "auto".to_string() }
fn default_stt_enabled() -> bool { true }
fn default_stt_engine() -> String { "openrouter".to_string() }
fn default_stt_model() -> String {
    env::var("STT_MODEL").unwrap_or_else(|_| {
        env::var("VITE_STT_MODEL")
            .unwrap_or_else(|_| "google/gemini-2.0-flash-exp:free".to_string())
    })
}
fn default_mic_enabled() -> bool { true }
fn default_device_id() -> String { "default".to_string() }
fn default_auto_listen() -> bool { false }

impl Default for AudioSettings {
    fn default() -> Self {
        AudioSettings {
            tts_enabled: default_tts_enabled(),
            tts_rate: default_tts_rate(),
            tts_pitch: default_tts_pitch(),
            tts_volume: default_tts_volume(),
            tts_voice: String::new(),
            tts_lang: default_tts_lang(),
            tts_engine: default_tts_engine(),
            stt_enabled: default_stt_enabled(),
            stt_engine: default_stt_engine(),
            stt_model: default_stt_model(),
            mic_enabled: default_mic_enabled(),
            mic_device_id: default_device_id(),
            speaker_device_id: default_device_id(),
            auto_listen: default_auto_listen(),
        }
    }
}

pub fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("broxeen");
    if let Err(err) = fs::create_dir_all(&config_dir) {
        backend_warn(format!(
            "Failed to create config directory {}: {}",
            config_dir.display(),
            err
        ));
    }
    let path = config_dir.join("settings.json");
    backend_info(format!("Resolved settings path: {}", path.display()));
    path
}

/// Load settings from disk (used by tts.rs, audio_commands.rs, etc.)
pub fn load_settings() -> AudioSettings {
    let path = settings_path();

    if !path.exists() {
        backend_warn(format!("Settings file not found at {}. Using defaults.", path.display()));
        return AudioSettings::default();
    }

    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) => {
            backend_error(format!("Failed to read settings file {}: {}", path.display(), err));
            return AudioSettings::default();
        }
    };

    match serde_json::from_str::<AudioSettings>(&data) {
        Ok(settings) => settings,
        Err(err) => {
            backend_error(format!("Failed to parse settings: {}", err));
            AudioSettings::default()
        }
    }
}

#[tauri::command]
pub fn get_settings() -> AudioSettings {
    backend_info("Command get_settings invoked");
    let path = settings_path();

    if !path.exists() {
        backend_warn(format!(
            "Settings file not found at {}. Using defaults.",
            path.display()
        ));
        return AudioSettings::default();
    }

    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) => {
            backend_error(format!(
                "Failed to read settings file {}: {}",
                path.display(),
                err
            ));
            return AudioSettings::default();
        }
    };

    // Try to parse as current AudioSettings, if fails try legacy and migrate
    match serde_json::from_str::<AudioSettings>(&data) {
        Ok(settings) => {
            backend_info("Settings loaded successfully from disk");
            settings
        }
        Err(_) => {
            // Try legacy format (without new fields)
            #[derive(Deserialize)]
            struct LegacyAudioSettings {
                pub tts_enabled: bool,
                pub tts_rate: f32,
                pub tts_pitch: f32,
                pub tts_volume: f32,
                pub tts_voice: String,
                pub tts_lang: String,
                pub mic_enabled: bool,
                pub mic_device_id: String,
                pub speaker_device_id: String,
                pub auto_listen: bool,
            }

            match serde_json::from_str::<LegacyAudioSettings>(&data) {
                Ok(legacy) => {
                    backend_info("Migrating legacy settings to new format");
                    let migrated = AudioSettings {
                        tts_enabled: legacy.tts_enabled,
                        tts_rate: legacy.tts_rate,
                        tts_pitch: legacy.tts_pitch,
                        tts_volume: legacy.tts_volume,
                        tts_voice: legacy.tts_voice,
                        tts_lang: legacy.tts_lang,
                        tts_engine: "auto".to_string(),
                        stt_enabled: true,
                        stt_engine: "openrouter".to_string(),
                        stt_model: "whisper-1".to_string(),
                        mic_enabled: legacy.mic_enabled,
                        mic_device_id: legacy.mic_device_id,
                        speaker_device_id: legacy.speaker_device_id,
                        auto_listen: legacy.auto_listen,
                    };
                    // Save migrated settings immediately
                    if let Err(e) = save_settings(migrated.clone()) {
                        backend_error(format!("Failed to save migrated settings: {}", e));
                    }
                    migrated
                }
                Err(err) => {
                    backend_error(format!(
                        "Failed to parse settings JSON from {}: {}",
                        path.display(),
                        err
                    ));
                    AudioSettings::default()
                }
            }
        }
    }
}

#[tauri::command]
pub fn save_settings(settings: AudioSettings) -> Result<(), String> {
    backend_info("Command save_settings invoked");
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| {
        backend_error(format!("Failed to serialize settings: {}", e));
        e.to_string()
    })?;
    fs::write(&path, json).map_err(|e| {
        backend_error(format!("Failed to write settings file {}: {}", path.display(), e));
        e.to_string()
    })?;
    backend_info(format!("Settings saved to {}", path.display()));
    Ok(())
}

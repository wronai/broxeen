//! ── Zmiany w main.rs ─────────────────────────────────
//!
//! 1. Dodaj moduły:
//!    mod audio_capture;
//!    mod tts_backend;
//!    mod audio_commands;
//!
//! 2. W fn main(), dodaj state i komendy:

// ─── IMPORT (dodaj na górze) ─────────────────────────
mod audio_capture;
mod tts_backend;
mod audio_commands;

use audio_capture::SharedRecordingState;
use audio_commands::ActiveStream;
use std::sync::{Arc, Mutex};

// ─── W fn main() (dodaj do buildera) ────────────────

fn main() {
    // ... istniejący kod ...

    // Detect TTS engine at startup
    let tts_engine = tts_backend::detect_tts_engine();
    backend_info(&format!("TTS engine: {:?}", tts_engine));

    if let Some(instructions) = tts_backend::piper_setup_instructions() {
        backend_warn("Piper TTS not found, using espeak-ng fallback");
        backend_info(&format!("To install Piper:\n{instructions}"));
    }

    tauri::Builder::default()
        // ── Audio state ──────────────────────
        .manage(Arc::new(Mutex::new(audio_capture::RecordingState::new())) as SharedRecordingState)
        .manage(ActiveStream(Mutex::new(None)))
        // ── Commands ─────────────────────────
        .invoke_handler(tauri::generate_handler![
            // Existing
            browse,
            get_settings,
            save_settings,
            llm_chat,
            stt::stt_transcribe,
            // NEW: Native audio
            audio_commands::stt_start,
            audio_commands::stt_stop,
            audio_commands::stt_status,
            audio_commands::tts_speak,
            audio_commands::tts_speak_base64,
            audio_commands::tts_info,
            audio_commands::audio_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

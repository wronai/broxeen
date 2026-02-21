//! tts_backend.rs — Text-to-Speech via Piper (neural) + espeak-ng (fallback).
//! Plays audio through ALSA using rodio, bypassing WebKitGTK entirely.

use rodio::{Decoder, OutputStream, Sink};
use std::io::{BufReader, Cursor};
use std::path::PathBuf;
use std::process::Command;

// ── Configuration ────────────────────────────────────

/// Where Piper binary + models live.
/// Default: ~/.local/share/broxeen/piper/
fn piper_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home)
        .join(".local/share/broxeen/piper")
}

fn piper_binary() -> PathBuf {
    // Check env override first
    if let Ok(path) = std::env::var("PIPER_BINARY") {
        return PathBuf::from(path);
    }
    piper_dir().join("piper")
}

fn piper_model() -> PathBuf {
    if let Ok(path) = std::env::var("PIPER_MODEL") {
        return PathBuf::from(path);
    }
    piper_dir().join("pl_PL-darkman-medium.onnx")
}

// ── TTS Engine Detection ─────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum TtsEngine {
    Piper,
    EspeakNg,
    None,
}

/// Detect which TTS engine is available.
pub fn detect_tts_engine() -> TtsEngine {
    // Check Piper first (better quality)
    let piper = piper_binary();
    if piper.exists() && piper_model().exists() {
        println!("[tts] Piper TTS found: {}", piper.display());
        return TtsEngine::Piper;
    }

    // Check espeak-ng
    if Command::new("espeak-ng").arg("--version").output().is_ok() {
        println!("[tts] espeak-ng found (fallback)");
        return TtsEngine::EspeakNg;
    }

    // Also check plain espeak
    if Command::new("espeak").arg("--version").output().is_ok() {
        println!("[tts] espeak found (fallback)");
        return TtsEngine::EspeakNg;
    }

    println!("[tts] WARNING: No TTS engine found!");
    TtsEngine::None
}

/// Return human-readable TTS engine info.
pub fn tts_engine_info() -> String {
    match detect_tts_engine() {
        TtsEngine::Piper => format!("Piper TTS (neural): {}", piper_model().display()),
        TtsEngine::EspeakNg => "espeak-ng (formant synthesis)".into(),
        TtsEngine::None => "Brak silnika TTS. Zainstaluj espeak-ng lub Piper.".into(),
    }
}

// ── TTS Synthesis ────────────────────────────────────

/// Synthesize text to WAV bytes using the best available engine.
pub fn synthesize_to_wav(text: &str, rate: f32, lang: &str) -> Result<Vec<u8>, String> {
    let engine = detect_tts_engine();

    match engine {
        TtsEngine::Piper => synthesize_piper(text, rate),
        TtsEngine::EspeakNg => synthesize_espeak(text, rate, lang),
        TtsEngine::None => Err(
            "Brak silnika TTS. Zainstaluj Piper lub espeak-ng:\n\
             sudo apt install espeak-ng".into()
        ),
    }
}

/// Synthesize using Piper — high quality, neural, Polish voices.
fn synthesize_piper(text: &str, rate: f32) -> Result<Vec<u8>, String> {
    let binary = piper_binary();
    let model = piper_model();

    // Piper rate: --length-scale (>1 = slower, <1 = faster)
    // Our rate: 0.5-2.0 where 1.0 = normal
    // Mapping: length_scale = 1.0 / rate
    let length_scale = (1.0 / rate).clamp(0.5, 2.0);

    let output = Command::new(&binary)
        .arg("--model").arg(&model)
        .arg("--output-raw")
        .arg("--length-scale").arg(format!("{length_scale:.2}"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(text.as_bytes()).ok();
            }
            child.wait_with_output()
        })
        .map_err(|e| format!("Piper execution error: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Piper error: {stderr}"));
    }

    let raw_audio = output.stdout;
    if raw_audio.is_empty() {
        return Err("Piper returned empty audio".into());
    }

    // Piper outputs raw 16-bit PCM at 22050Hz (for medium models)
    // Wrap in WAV header
    let wav = wrap_raw_pcm_as_wav(&raw_audio, 22050, 1, 16);
    Ok(wav)
}

/// Synthesize using espeak-ng — basic quality, but always available.
fn synthesize_espeak(text: &str, rate: f32, lang: &str) -> Result<Vec<u8>, String> {
    // espeak-ng rate: words per minute, default ~175
    let wpm = (175.0 * rate).clamp(80.0, 400.0) as u32;

    // Try espeak-ng first, then espeak
    let binary = if Command::new("espeak-ng").arg("--version").output().is_ok() {
        "espeak-ng"
    } else {
        "espeak"
    };

    let output = Command::new(binary)
        .arg("-v").arg(lang.split('-').next().unwrap_or("pl"))  // "pl-PL" → "pl"
        .arg("-s").arg(wpm.to_string())
        .arg("--stdout")  // output WAV to stdout
        .arg(text)
        .output()
        .map_err(|e| format!("{binary} execution error: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{binary} error: {stderr}"));
    }

    Ok(output.stdout)
}

// ── Audio Playback ───────────────────────────────────

/// Play WAV bytes through the default audio output.
/// Blocks until playback is complete.
pub fn play_wav_blocking(wav_data: &[u8], volume: f32) -> Result<(), String> {
    let (_stream, handle) = OutputStream::try_default()
        .map_err(|e| format!("Cannot open audio output: {e}"))?;

    let sink = Sink::try_new(&handle)
        .map_err(|e| format!("Cannot create audio sink: {e}"))?;

    sink.set_volume(volume.clamp(0.0, 1.0));

    let cursor = Cursor::new(wav_data.to_vec());
    let source = Decoder::new(BufReader::new(cursor))
        .map_err(|e| format!("Cannot decode WAV: {e}"))?;

    sink.append(source);
    sink.sleep_until_end();

    Ok(())
}

/// Play WAV bytes asynchronously (non-blocking).
/// Returns immediately, audio plays in background.
pub fn play_wav_async(wav_data: Vec<u8>, volume: f32) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Err(e) = play_wav_blocking(&wav_data, volume) {
            eprintln!("[tts] Playback error: {e}");
        }
    });
    Ok(())
}

// ── Speak text end-to-end ────────────────────────────

/// Full pipeline: text → synthesize → play.
/// This is the main function called from Tauri commands.
pub fn speak(text: &str, rate: f32, volume: f32, lang: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    println!("[tts] Speaking: \"{}\"", truncate(text, 60));

    let wav = synthesize_to_wav(text, rate, lang)?;
    play_wav_async(wav, volume)?;

    Ok(())
}

/// Speak text and return WAV as base64 (for frontend playback option).
pub fn speak_to_base64(text: &str, rate: f32, lang: &str) -> Result<String, String> {
    let wav = synthesize_to_wav(text, rate, lang)?;
    Ok(base64_encode(&wav))
}

// ── Helpers ──────────────────────────────────────────

/// Wrap raw PCM bytes in a WAV header.
fn wrap_raw_pcm_as_wav(raw: &[u8], sample_rate: u32, channels: u16, bits: u16) -> Vec<u8> {
    let data_size = raw.len() as u32;
    let byte_rate = sample_rate * channels as u32 * bits as u32 / 8;
    let block_align = channels * bits / 8;

    let mut wav = Vec::with_capacity(44 + raw.len());

    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // chunk size
    wav.extend_from_slice(&1u16.to_le_bytes());  // PCM format
    wav.extend_from_slice(&channels.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&bits.to_le_bytes());

    // data chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(raw);

    wav
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max]) }
}

// ── Piper installation helper ────────────────────────

/// Check if Piper is installed and return setup instructions if not.
pub fn piper_setup_instructions() -> Option<String> {
    if piper_binary().exists() && piper_model().exists() {
        return None; // Already installed
    }

    Some(format!(
        "Piper TTS nie jest zainstalowany. Aby zainstalować:\n\n\
         mkdir -p {dir}\n\
         cd {dir}\n\n\
         # Binary\n\
         wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz\n\
         tar xzf piper_linux_x86_64.tar.gz\n\n\
         # Polski głos (medium, ~45MB)\n\
         wget https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx\n\
         wget https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json\n\n\
         Lub ustaw zmienne środowiskowe:\n\
         PIPER_BINARY=/ścieżka/do/piper\n\
         PIPER_MODEL=/ścieżka/do/modelu.onnx",
        dir = piper_dir().display()
    ))
}

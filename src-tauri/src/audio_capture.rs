//! audio_capture.rs — Microphone recording via cpal (ALSA on Linux).
//! Bypasses WebKitGTK's broken getUserMedia by capturing audio natively.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, StreamConfig};
use hound::{WavSpec, WavWriter};
use std::io::Cursor;
use std::sync::{Arc, Mutex};

/// Recording state shared between Tauri commands and the audio thread.
pub struct RecordingState {
    pub(crate) samples: Vec<i16>,
    pub(crate) is_recording: bool,
    pub(crate) sample_rate: u32,
    pub(crate) channels: u16,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            samples: Vec::new(),
            is_recording: false,
            sample_rate: 16000,
            channels: 1,
        }
    }
}

/// Global recording state, managed via Tauri's state system.
pub type SharedRecordingState = Arc<Mutex<RecordingState>>;

/// List available input (microphone) devices.
pub fn list_input_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| format!("Cannot enumerate input devices: {e}"))?;

    let names: Vec<String> = devices
        .filter_map(|d| d.name().ok())
        .collect();

    Ok(names)
}

/// Start recording from the default microphone.
/// Audio is captured as 16kHz mono PCM (ideal for STT).
/// Returns immediately; samples accumulate in `state`.
pub fn start_recording(state: &SharedRecordingState) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device (microphone) found")?;

    let device_name = device.name().unwrap_or_else(|_| "unknown".into());
    println!("[audio] Using input device: {device_name}");

    // Prefer 16kHz mono for STT, fallback to device default
    let config = preferred_input_config(&device)?;
    let sample_rate = config.sample_rate.0;
    let channels = config.channels as u16;

    {
        let mut s = state.lock().unwrap();
        s.samples.clear();
        s.is_recording = true;
        s.sample_rate = sample_rate;
        s.channels = channels;
    }

    let state_clone = Arc::clone(state);
    let err_fn = |err| eprintln!("[audio] Recording error: {err}");

    let stream = device
        .build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut s = state_clone.lock().unwrap();
                if !s.is_recording {
                    return;
                }
                // Convert f32 → i16, downsample to mono if needed
                for chunk in data.chunks(channels as usize) {
                    // Average channels to mono
                    let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                    let sample = (mono * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                    s.samples.push(sample);
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Cannot build input stream: {e}"))?;

    stream.play().map_err(|e| format!("Cannot start recording: {e}"))?;
    println!("[audio] Recording started ({sample_rate}Hz, {channels}ch)");

    Ok(stream)
}

/// Stop recording and encode collected samples to WAV (16-bit PCM, mono).
/// Returns the WAV bytes as base64 string (ready for STT API).
pub fn stop_and_encode_wav(state: &SharedRecordingState) -> Result<(String, u32), String> {
    let (samples, sample_rate, _channels) = {
        let mut s = state.lock().unwrap();
        s.is_recording = false;
        let samples = std::mem::take(&mut s.samples);
        (samples, s.sample_rate, s.channels)
    };

    if samples.is_empty() {
        return Err("No audio recorded".into());
    }

    let duration_secs = samples.len() as f32 / sample_rate as f32;
    println!("[audio] Recorded {:.1}s ({} samples)", duration_secs, samples.len());

    // Downsample to 16kHz if needed (simple decimation for now)
    let target_rate = 16000u32;
    let final_samples = if sample_rate != target_rate {
        resample_linear(&samples, sample_rate, target_rate)
    } else {
        samples
    };

    // Encode to WAV in memory
    let spec = WavSpec {
        channels: 1, // always mono after our processing
        sample_rate: target_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("WAV writer error: {e}"))?;
        for sample in &final_samples {
            writer.write_sample(*sample).map_err(|e| format!("WAV write error: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("WAV finalize error: {e}"))?;
    }

    let wav_bytes = cursor.into_inner();
    let base64 = base64_encode(&wav_bytes);

    Ok((base64, target_rate))
}

/// Simple linear resampling (good enough for speech).
fn resample_linear(samples: &[i16], from_rate: u32, to_rate: u32) -> Vec<i16> {
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = src_pos - idx as f64;

        let s0 = samples[idx.min(samples.len() - 1)] as f64;
        let s1 = samples[(idx + 1).min(samples.len() - 1)] as f64;
        let interpolated = s0 + frac * (s1 - s0);
        out.push(interpolated as i16);
    }

    out
}

/// Prefer 16kHz mono config, fall back to device default.
fn preferred_input_config(device: &cpal::Device) -> Result<StreamConfig, String> {
    // Try supported configs for something close to 16kHz
    if let Ok(configs) = device.supported_input_configs() {
        for cfg in configs {
            if cfg.channels() <= 2 {
                let rate = SampleRate(16000);
                if cfg.min_sample_rate() <= rate && rate <= cfg.max_sample_rate() {
                    return Ok(cfg.with_sample_rate(rate).into());
                }
            }
        }
    }

    // Fallback: use default config
    device
        .default_input_config()
        .map(|c| c.into())
        .map_err(|e| format!("No input config available: {e}"))
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

// ── Silence detection (auto-stop) ────────────────────

/// Get current microphone level (0.0-1.0) from recent audio samples.
pub fn get_mic_level(state: &SharedRecordingState) -> f32 {
    let s = state.lock().unwrap();
    if !s.is_recording || s.samples.is_empty() {
        return 0.0;
    }

    // Use last ~50ms of samples for responsive level
    let window_samples = (s.sample_rate as f32 * 0.05) as usize;
    let start_idx = if s.samples.len() > window_samples {
        s.samples.len() - window_samples
    } else {
        0
    };
    
    let window = &s.samples[start_idx..];
    if window.is_empty() {
        return 0.0;
    }

    let rms: f32 = (window.iter().map(|&s| (s as f32).powi(2)).sum::<f32>() / window.len() as f32).sqrt();
    let normalized_rms = rms / i16::MAX as f32;
    
    // Scale for better visual response (multiply by 4, clamp to 1.0)
    (normalized_rms * 4.0).clamp(0.0, 1.0)
}

/// Check if the last N seconds of audio are silence.
#[allow(dead_code)]
pub fn is_silence(state: &SharedRecordingState, threshold_seconds: f32, rms_threshold: f32) -> bool {
    let s = state.lock().unwrap();
    if !s.is_recording || s.samples.is_empty() {
        return false;
    }

    let check_samples = (s.sample_rate as f32 * threshold_seconds) as usize;
    if s.samples.len() < check_samples {
        return false;
    }

    let tail = &s.samples[s.samples.len() - check_samples..];
    let rms: f32 = (tail.iter().map(|&s| (s as f32).powi(2)).sum::<f32>() / tail.len() as f32).sqrt();
    let normalized_rms = rms / i16::MAX as f32;

    normalized_rms < rms_threshold
}

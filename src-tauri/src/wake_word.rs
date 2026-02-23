//! wake_word.rs — Wake word detection for hands-free activation.
//! Lightweight local detection without LLM - uses VAD + phonetic matching.
//! Trigger phrase: "heyken"

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use tauri::Emitter;

/// State for wake word detection
pub struct WakeWordState {
    pub is_listening: bool,
    pub triggered: bool,
    pub trigger_time: Option<std::time::Instant>,
    pub audio_buffer: VecDeque<f32>,
    pub rms_threshold: f32,
    pub sample_rate: u32,
}

impl WakeWordState {
    pub fn new() -> Self {
        Self {
            is_listening: false,
            triggered: false,
            trigger_time: None,
            audio_buffer: VecDeque::with_capacity(16000 * 3), // 3 seconds at 16kHz
            rms_threshold: 0.015, // Same as silence detection
            sample_rate: 16000,
        }
    }
    
    pub fn reset(&mut self) {
        self.triggered = false;
        self.trigger_time = None;
        self.audio_buffer.clear();
    }
}

pub type SharedWakeWordState = Arc<Mutex<WakeWordState>>;

/// Simple phonetic pattern matching for "heyken"
/// Returns confidence score 0.0-1.0
fn match_wake_word(audio: &[f32], sample_rate: u32) -> f32 {
    let min_samples = (sample_rate as f32 * 0.5) as usize; // Need at least 0.5s
    if audio.len() < min_samples {
        return 0.0;
    }
    
    // Calculate RMS energy profile over time windows
    let window_size = (sample_rate as f32 * 0.1) as usize; // 100ms windows
    let num_windows = audio.len() / window_size;
    
    if num_windows < 2 {
        return 0.0;
    }
    
    // Extract energy profile
    let mut energy_profile = Vec::with_capacity(num_windows);
    for i in 0..num_windows {
        let start = i * window_size;
        let end = ((i + 1) * window_size).min(audio.len());
        let window = &audio[start..end];
        
        let rms = (window.iter().map(|s| s * s).sum::<f32>() / window.len() as f32).sqrt();
        energy_profile.push(rms);
    }
    
    // Pattern for "heyken": 2 syllables = 2 energy peaks
    // Expected pattern: low-high-low-high-low (2 syllables with gap)
    if energy_profile.len() < 4 {
        return 0.0;
    }
    
    // Find peaks in energy profile
    let threshold = energy_profile.iter().sum::<f32>() / energy_profile.len() as f32 * 0.6;
    let mut peaks = 0;
    let mut in_peak = false;
    
    for &energy in &energy_profile {
        if energy > threshold && !in_peak {
            peaks += 1;
            in_peak = true;
        } else if energy < threshold * 0.7 {
            in_peak = false;
        }
    }
    
    // "heyken" should have ~2 syllables = ~2 peaks
    if peaks >= 2 && peaks <= 3 {
        // Additional check: total duration should be 0.5-1.5s
        let duration_sec = audio.len() as f32 / sample_rate as f32;
        if duration_sec >= 0.5 && duration_sec <= 1.5 {
            return 0.7 + (0.3 * (1.0 - (peaks as f32 - 2.0).abs() / 2.0));
        }
    }
    
    0.0
}

/// Start continuous wake word listening
pub fn start_wake_word_listening(
    state: &SharedWakeWordState,
    app_handle: tauri::AppHandle,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No input device (microphone) found")?;

    let device_name = device.name().unwrap_or_else(|_| "unknown".into());
    println!("[wake-word] Using input device: {device_name}");

    // Get default input config
    let config = device
        .default_input_config()
        .map_err(|e| format!("Cannot get input config: {e}"))?;
    
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    
    // Update state
    {
        let mut s = state.lock().unwrap();
        s.is_listening = true;
        s.sample_rate = sample_rate;
        s.reset();
    }

    let state_clone = Arc::clone(state);
    let err_fn = |err| eprintln!("[wake-word] Recording error: {err}");

    let stream = device
        .build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mut s = state_clone.lock().unwrap();
                if !s.is_listening {
                    return;
                }
                
                // Already triggered, don't process more until reset
                if s.triggered {
                    return;
                }
                
                // Convert to mono and add to buffer
                for chunk in data.chunks(channels) {
                    let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                    s.audio_buffer.push_back(mono);
                }
                
                // Keep buffer at max 3 seconds
                let max_samples = s.sample_rate as usize * 3;
                while s.audio_buffer.len() > max_samples {
                    s.audio_buffer.pop_front();
                }
                
                // Check for voice activity first (RMS threshold)
                let rms = s.audio_buffer.iter().map(|s| s * s).sum::<f32>() / s.audio_buffer.len().max(1) as f32;
                let rms_value = rms.sqrt();
                
                if rms_value > s.rms_threshold {
                    // Have enough audio and voice detected, try wake word detection
                    let audio_vec: Vec<f32> = s.audio_buffer.iter().copied().collect();
                    let confidence = match_wake_word(&audio_vec, s.sample_rate);
                    
                    if confidence > 0.5 {
                        println!("[wake-word] Voice activity detected - confidence: {:.2}, rms: {:.4}, buffer_size: {}", 
                            confidence, rms_value, audio_vec.len());
                    }
                    
                    if confidence > 0.7 {
                        println!("[wake-word] ✓ HEYKEN DETECTED! Confidence: {:.2}, RMS: {:.4}", confidence, rms_value);
                        s.triggered = true;
                        s.trigger_time = Some(std::time::Instant::now());
                        
                        // Emit Tauri event
                        println!("[wake-word] Emitting wake-word-detected event to frontend");
                        let _ = app_handle.emit("wake-word-detected", serde_json::json!({
                            "confidence": confidence,
                            "timestamp": std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                        }));
                        
                        // Clear buffer to avoid re-triggering
                        s.audio_buffer.clear();
                        println!("[wake-word] Buffer cleared, waiting for reset");
                    }
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| format!("Cannot build wake word stream: {e}"))?;

    stream.play().map_err(|e| format!("Cannot start wake word listening: {e}"))?;
    println!("[wake-word] Wake word listening started ({sample_rate}Hz, {channels}ch)");

    Ok(stream)
}

/// Stop wake word listening
pub fn stop_wake_word_listening(state: &SharedWakeWordState) {
    let mut s = state.lock().unwrap();
    s.is_listening = false;
    println!("[wake-word] Wake word listening stopped");
}

/// Check if wake word was detected and reset the flag
pub fn check_wake_word_triggered(state: &SharedWakeWordState) -> bool {
    let mut s = state.lock().unwrap();
    if s.triggered {
        s.triggered = false; // Reset after checking
        s.audio_buffer.clear();
        true
    } else {
        false
    }
}

/// Get current RMS level for UI visualization
#[tauri::command]
pub fn wake_word_get_level(state: tauri::State<SharedWakeWordState>) -> f32 {
    let s = state.lock().unwrap();
    if s.audio_buffer.is_empty() {
        return 0.0;
    }
    let rms = s.audio_buffer.iter().map(|s| s * s).sum::<f32>() / s.audio_buffer.len() as f32;
    rms.sqrt()
}

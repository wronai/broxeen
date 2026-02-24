# 🎤 STT Architecture - Speech-to-Text System

## Overview

Broxeen implements a **dual-mode STT system** with wake word detection and manual recording capabilities. The system uses OpenRouter's multimodal API with local VAD (Voice Activity Detection) for optimal performance.

## 🏗️ Architecture

```
Frontend (React/TypeScript)     Backend (Rust/Tauri)           External API
┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
│  Chat.tsx       │◄── invoke │ audio_commands │◄── HTTP │  OpenRouter     │
│  useStt.ts      │            │ stt.rs          │            │  Gemini Flash   │
│  └───────────────┘            │ VAD             │            │  Whisper API    │
                                │ └───────────────┘            └─────────────────┘
```

## 🎯 Recording Modes

### 1. 🎤 Wake Word Trigger Mode

**Purpose:** Hands-free voice commands

**Flow:**
1. User says "heyken" (wake word)
2. System automatically records for **1 second**
3. VAD analyzes if speech is present
4. **If speech detected:** Continue recording until speech ends
5. **If silence:** Stop and return to wake word listening
6. Transcription sent as **command** to text field

**Use Cases:**
- "Heyken, pokaż kamery"
- "Heyken, skanuj sieć"
- "Heyken, włącz monitoring"

### 2. 🎯 Manual Recording Mode

**Purpose:** Direct voice input with button control

**Flow:**
1. User **presses and holds** microphone button
2. Recording continues as long as button is held
3. Release button → stop recording
4. Transcription sent as **command** to text field

**Use Cases:**
- Long commands
- Dictation
- When wake word is disabled

### 3. 🔍 Auto Mode (Future)

**Purpose:** Automatic voice activity detection

**Status:** Planned implementation

## 🔧 Technical Implementation

### Backend Components

#### `stt.rs` - Core STT Engine
```rust
pub async fn transcribe_wav_base64(
    wav_base64: &str,
    lang: &str,
    api_key_override: Option<&str>,
    model_override: Option<&str>,
) -> Result<String, String>
```

**Features:**
- **VAD Pre-check:** RMS + Zero Crossing Rate analysis
- **Anti-hallucination prompt:** Temperature=0 + strict instructions
- **Format support:** WAV, WebM, OGG (auto-conversion)
- **Artifact detection:** Rejects repeated words/glitches

#### `audio_commands.rs` - Tauri Commands
```rust
#[tauri::command]
pub fn stt_start(
    mode: Option<String>,
    recording_state: State<SharedRecordingState>,
    active_stream: State<ActiveStream>,
    active_wake_word: State<ActiveWakeWordStream>,
) -> Result<String, String>

#[tauri::command]
pub async fn stt_stop(
    mode: Option<String>,
    // ... params
) -> Result<String, String>
```

**Modes:**
- `"manual"` - Button-controlled recording
- `"wake_word"` - Wake word detection
- `"wake_word_trigger"` - Post-wake-word recording
- `"auto"` - Future VAD-only mode

### Frontend Components

#### `useStt.ts` - React Hook
```typescript
const startRecording = useCallback((
  mode: "manual" | "wake_word" | "auto" | "wake_word_trigger" = "manual"
) => {
  setCurrentMode(mode);
  // ... recording logic
});
```

**States:**
- `isRecording` - Recording active
- `isTranscribing` - Processing audio
- `transcript` - Final transcription
- `currentMode` - Active recording mode

#### `Chat.tsx` - UI Integration
```typescript
// Dynamic placeholder based on state
placeholder={
  wakeWordEnabled 
    ? "🔊 Nasłuchuję 'heyken'..." 
    : stt.isRecording 
      ? "🎙️ Nagrywam..." 
      : stt.isTranscribing 
        ? "🔧 Przetwarzam audio..." 
        : "Wpisz adres, zapytanie lub powiedz głosem..."
}
```

## 🎛️ Configuration

### Environment Variables
```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-...
STT_MODEL=google/gemini-2.0-flash-exp:free
VITE_STT_MODEL=google/gemini-2.0-flash-exp:free
VITE_STT_LANG=pl
```

### VAD Thresholds
```rust
// Voice Activity Detection thresholds
const ENERGY_THRESHOLD: f32 = 0.01;      // RMS energy
const ZCR_MIN: f32 = 0.01;                // Zero crossing rate min
const ZCR_MAX: f32 = 0.50;                // Zero crossing rate max
const CONFIDENCE_THRESHOLD: f32 = 0.25;  // Overall confidence
```

## 🔄 State Management

### Recording State Flow
```
Idle → Recording → Transcribing → Complete
  ↑         ↓           ↓           ↓
  └── Wake Word ─── VAD Check ─── API Call ─── Result
```

### Mode Switching Logic
```rust
match mode.as_str() {
    "manual" => {
        if wake_word_active {
            pause_wake_word()?;
        }
        // Start manual recording
    },
    "wake_word_trigger" => {
        // Start 1s auto recording after wake word
    },
    "auto" => {
        // Future: VAD-only recording
    }
}
```

## 🎤 Audio Pipeline

### 1. Audio Capture
- **Sample Rate:** 16kHz (optimal for speech)
- **Channels:** 1 (mono)
- **Format:** 16-bit PCM
- **Buffer:** Real-time streaming

### 2. VAD Analysis
```rust
pub struct VadResult {
    pub is_speech: bool,
    pub rms: f32,           // Signal energy
    pub zcr: f32,           // Zero crossing rate
    pub confidence: f32,     // Overall confidence (0.0-1.0)
}
```

### 3. API Integration
- **Provider:** OpenRouter
- **Model:** Google Gemini 2.0 Flash (free tier)
- **Endpoint:** `/api/v1/chat/completions`
- **Input:** Base64 WAV + multimodal content
- **Temperature:** 0.0 (no creativity)

## 🛡️ Error Handling

### Common Errors
```rust
// VAD rejection
"STT: brak mowy (rms=0.0001, zcr=0.432, confidence=0.12)"

// API errors
"STT: HTTP 400: Invalid audio format"

// Processing errors
"STT: artefakt przetwarzania audio (słowo 'test' powtórzone 15/30 razy)"
```

### Fallback Strategy
1. **VAD fails** → Try API anyway (for debugging)
2. **API fails** → Return error message to UI
3. **Transcription empty** → Suggest speaking louder

## 🧪 Testing

### Unit Tests
- `stt.rs` - VAD algorithm, prompt validation
- `audio_commands.rs` - Mode switching logic
- `useStt.ts` - Hook state management

### Integration Tests
- Wake word → trigger → recording flow
- Manual recording → transcription flow
- Mode conflict resolution

### E2E Tests
```typescript
// Playwright configuration
args: [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--use-file-for-fake-audio-capture=e2e/fixtures/test_speech.wav",
]
```

## 📊 Performance

### Metrics
- **VAD Processing:** <1ms per frame
- **API Response:** ~2s (depending on audio length)
- **Memory Usage:** ~50MB for 10s audio
- **CPU Usage:** <5% during recording

### Optimization
- **Frame-based VAD:** 20ms frames for real-time
- **Streaming upload:** No full file storage needed
- **Caching:** Model selection cached per session

## 🔮 Future Enhancements

### Planned Features
1. **Auto Mode:** Pure VAD-based recording
2. **Local Models:** Offline Whisper integration
3. **Multi-language:** Automatic language detection
4. **Voice Profiles:** User-specific calibration
5. **Real-time Feedback:** Live transcription display

### Architecture Improvements
1. **WebAssembly VAD:** Client-side preprocessing
2. **Streaming API:** Real-time transcription
3. **Noise Reduction:** Audio cleanup before VAD
4. **Confidence Scoring:** User feedback integration

## 🐛 Troubleshooting

### Common Issues

#### "STT: brak mowy" (No speech detected)
**Cause:** VAD thresholds too high
**Solution:** Lower `CONFIDENCE_THRESHOLD` to 0.15

#### "HTTP 405 Method Not Allowed"
**Cause:** Wrong API endpoint
**Solution:** Use `/chat/completions` not `/audio/transcriptions`

#### "Halucynacje" (Random text)
**Cause:** Temperature > 0 or wrong model
**Solution:** Set `temperature: 0` and use Gemini Flash

#### "Wake word conflicts with manual"
**Cause:** Both modes active simultaneously
**Solution:** Manual mode automatically pauses wake word

### Debug Mode
```rust
#[cfg(debug_assertions)]
println!("[VAD DEBUG] rms={:.5}, zcr={:.3}, confidence={:.3}");
```

---

## 📚 Related Documentation

- [TTS Architecture](TTS_ARCHITECTURE.md)
- [Audio Settings](../src/domain/audioSettings.ts)
- [Wake Word Implementation](../src-tauri/src/wake_word.rs)
- [OpenRouter API Docs](https://openrouter.ai/docs)

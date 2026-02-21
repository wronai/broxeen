# 🔊 Broxeen — Naprawa interfejsu audio (STT + TTS)

## Diagnoza problemu

### Root cause: WebKitGTK na Linux NIE obsługuje Web Audio API

```
Frontend (WebKitGTK)
    ├── getUserMedia()     → ❌ "not allowed by user agent"
    ├── SpeechRecognition  → ❌ undefined
    └── speechSynthesis    → ❌ undefined
```

To nie jest bug Broxeen — to ograniczenie platformy. WebKitGTK:
- **Nie implementuje** `SpeechRecognition` / `SpeechSynthesis`
- **Blokuje** `getUserMedia` (wymaga custom build webkitgtk z WebRTC, co jest niepraktyczne)
- Issue: tauri-apps/wry#85, tauri-apps/tauri#8851, tauri-apps/tauri#12547

### Dlaczego obecny cloud STT nie działa

Twój `useStt.ts` poprawnie wykrywa brak native STT i próbuje cloud fallback, ALE:
1. `blobToWavBase64()` wymaga `MediaRecorder` + `getUserMedia` → **blokowane przez WebKitGTK**
2. Nawet z kluczem OpenRouter, nagranie audio nie może się rozpocząć

### Dlaczego TTS nie działa

`useTts.ts` sprawdza `window.speechSynthesis` → **undefined w WebKitGTK** → hook ustawia `unsupported`

---

## Rozwiązanie: Audio przez Rust (omijamy WebKitGTK)

```
PRZED (nie działa):
  Mikrofon → [WebKitGTK getUserMedia] ❌ → JS → Cloud STT
  Cloud TTS → [WebKitGTK speechSynthesis] ❌ → Głośnik

PO (działa):
  Mikrofon → [cpal / ALSA] ✅ → Rust → Cloud STT → Frontend
  Tekst → Rust → [Piper TTS local] ✅ → [rodio] → Głośnik
```

### Stos technologiczny (darmowy, średnia jakość)

| Komponent | Narzędzie | Jakość | Koszt | Offline? |
|-----------|-----------|--------|-------|----------|
| **STT** (speech→text) | cpal + OpenRouter Whisper | ★★★★ | ~$0.006/min | ❌ cloud |
| **TTS** (text→speech) | Piper TTS (neural ONNX) | ★★★☆ | $0 | ✅ local |
| **TTS fallback** | espeak-ng | ★★☆☆ | $0 | ✅ local |
| **Audio capture** | cpal (Rust, ALSA) | — | $0 | ✅ |
| **Audio playback** | rodio (Rust, ALSA) | — | $0 | ✅ |

### Dlaczego Piper a nie espeak-ng

- **espeak-ng**: formulant synthesis, brzmi robotycznie, ale działa wszędzie
- **Piper**: neural VITS models, brzmi naturalnie, <50MB model, ~5x realtime na CPU
- Polski głos Piper: `pl_PL-darkman-medium` (~45MB) — przyzwoity męski głos
- Oba darmowe, oba offline, Piper znacząco lepszy

---

## Nowe/zmienione pliki

```
src-tauri/
├── Cargo.toml                    # ZMIANA: +cpal, +rodio, +hound, +base64
├── src/
│   ├── main.rs                   # ZMIANA: +nowe komendy Tauri
│   ├── audio_capture.rs          # NOWY: nagrywanie mikrofonu (cpal)
│   ├── audio_playback.rs         # NOWY: odtwarzanie WAV (rodio)
│   ├── tts_backend.rs            # NOWY: Piper TTS + espeak-ng fallback
│   ├── stt.rs                    # ZMIANA: akceptuje WAV z audio_capture
│   └── llm.rs                    # bez zmian
src/
├── hooks/
│   ├── useBackendStt.ts          # NOWY: STT przez Tauri commands
│   ├── useBackendTts.ts          # NOWY: TTS przez Tauri commands
│   ├── useStt.ts                 # ZMIANA: fallback → useBackendStt
│   └── useTts.ts                 # ZMIANA: fallback → useBackendTts
├── components/
│   └── Chat.tsx                  # ZMIANA: unified mic toggle
└── lib/
    └── audioDevices.ts           # NOWY: lista urządzeń audio z backendu
```

---

## Kolejność implementacji

| # | Zadanie | Zależności | Priorytet |
|---|---------|-----------|-----------|
| 1 | `Cargo.toml` — dodaj cpal, rodio, hound | — | 🔴 |
| 2 | `audio_capture.rs` — nagrywanie WAV | cpal, hound | 🔴 |
| 3 | `tts_backend.rs` — Piper + espeak | — | 🔴 |
| 4 | `audio_playback.rs` — odtwarzanie WAV | rodio | 🔴 |
| 5 | Komendy Tauri w `main.rs` | #2-4 | 🔴 |
| 6 | `useBackendStt.ts` — frontend hook | #5 | 🔴 |
| 7 | `useBackendTts.ts` — frontend hook | #5 | 🔴 |
| 8 | `useStt.ts` / `useTts.ts` — fallback | #6-7 | 🟡 |
| 9 | Instalacja Piper + model PL | — | 🔴 |
| 10 | Testy e2e | #6-8 | 🟢 |

---

## Wymagane zależności systemowe

```bash
# Linux (Ubuntu/Debian)
sudo apt install -y \
  libasound2-dev \          # ALSA — wymagane przez cpal
  espeak-ng \               # TTS fallback
  libespeak-ng-dev           # opcjonalne, jeśli linkujesz

# Piper TTS (download binary + model)
mkdir -p ~/.local/share/broxeen/piper
cd ~/.local/share/broxeen/piper

# Binary
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
tar xzf piper_linux_x86_64.tar.gz

# Polski głos (medium quality, ~45MB)
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx
wget https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json
```

---

## Flow pełnego cyklu

### STT: Mikrofon → Tekst

```
1. Użytkownik klika 🎤 w Chat
2. Frontend: invoke("stt_start_recording")
3. Rust (cpal): otwiera mikrofon ALSA, nagrywa do bufora
4. Użytkownik klika 🎤 ponownie (lub cisza 2s = auto-stop)
5. Frontend: invoke("stt_stop_and_transcribe")
6. Rust:
   a. Zamyka stream cpal
   b. Konwertuje bufor → WAV (16kHz, mono, PCM16)
   c. Koduje WAV → base64
   d. Wysyła do OpenRouter Whisper: POST /api/v1/audio/transcriptions
   e. Zwraca tekst transkrypcji
7. Frontend: wstawia tekst do input → handleSubmit
```

### TTS: Tekst → Głośnik

```
1. handleSubmit zwraca odpowiedź (browse/LLM/resolver)
2. Frontend: invoke("tts_speak", { text: "odpowiedź..." })
3. Rust (tts_backend):
   a. Sprawdza czy Piper dostępny → jeśli tak, użyj Piper
   b. Fallback: espeak-ng
   c. Piper: echo "tekst" | piper --model pl_PL-darkman-medium --output_raw
   d. Odtwarza WAV przez rodio → ALSA → głośnik
4. Frontend dostaje event "tts_done" / "tts_error"
```

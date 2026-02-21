/**
 * useAudio — Unified audio interface for Broxeen.
 *
 * Auto-detects the best available audio backend:
 *
 * ┌─────────────┬──────────────────────┬─────────────────────┐
 * │ Runtime     │ STT                  │ TTS                 │
 * ├─────────────┼──────────────────────┼─────────────────────┤
 * │ Browser     │ Web Speech API       │ speechSynthesis     │
 * │ Tauri Linux │ cpal + Whisper cloud │ Piper / espeak-ng   │
 * │ Tauri Mac   │ Web Speech API *     │ speechSynthesis *   │
 * └─────────────┴──────────────────────┴─────────────────────┘
 * * macOS WebKit supports these APIs natively
 *
 * Usage in Chat.tsx:
 *   const audio = useAudio({ lang: "pl-PL", onTranscript: handleSubmit });
 *   <button onClick={audio.stt.toggle}>🎤</button>
 *   audio.tts.speak("Hello");
 */

import { useEffect, useState, useMemo } from "react";
import { isTauriRuntime } from "../lib/runtime";
import { useBackendStt } from "./useBackendStt";
import { useBackendTts } from "./useBackendTts";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("useAudio");

// ── Types ────────────────────────────────────────────

type AudioBackend = "native" | "backend" | "none";

interface UseAudioOptions {
  lang?: string;
  ttsRate?: number;
  ttsVolume?: number;
  onTranscript?: (text: string) => void;
}

interface SttInterface {
  toggle: () => void;
  isRecording: boolean;
  isTranscribing: boolean;
  supported: boolean;
  backend: AudioBackend;
  error: string | null;
  status: string;
}

interface TtsInterface {
  speak: (text: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
  supported: boolean;
  backend: AudioBackend;
  engineInfo: string;
  error: string | null;
}

interface UseAudioReturn {
  stt: SttInterface;
  tts: TtsInterface;
  /** Overall readiness — at least one of STT/TTS works */
  ready: boolean;
  /** Human-readable summary */
  summary: string;
}

// ── Hook ─────────────────────────────────────────────

export function useAudio(options: UseAudioOptions = {}): UseAudioReturn {
  const { lang = "pl-PL", ttsRate = 1.0, ttsVolume = 1.0, onTranscript } = options;

  const isRunningInTauri = isTauriRuntime();

  // Native browser APIs availability
  const [nativeSttAvailable, setNativeSttAvailable] = useState(false);
  const [nativeTtsAvailable, setNativeTtsAvailable] = useState(false);

  useEffect(() => {
    // Check native STT (Web Speech API)
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setNativeSttAvailable(!!SpeechRecognition);

    // Check native TTS
    setNativeTtsAvailable(typeof window.speechSynthesis !== "undefined");
  }, []);

  // Backend hooks (always initialized, only used when native unavailable)
  const backendStt = useBackendStt({
    lang: lang.split("-")[0], // "pl-PL" → "pl"
    onTranscript,
  });

  const backendTts = useBackendTts({
    rate: ttsRate,
    volume: ttsVolume,
    lang,
  });

  // ── STT routing ─────────────────────────────────────

  const sttBackend: AudioBackend = nativeSttAvailable
    ? "native"
    : backendStt.supported
      ? "backend"
      : "none";

  const stt: SttInterface = useMemo(() => {
    if (sttBackend === "native") {
      // Will be wired to existing useSpeech/useStt in Chat.tsx
      return {
        toggle: () => { /* defer to Chat.tsx native hook */ },
        isRecording: false,
        isTranscribing: false,
        supported: true,
        backend: "native" as AudioBackend,
        error: null,
        status: "Native Web Speech API",
      };
    }

    if (sttBackend === "backend") {
      return {
        toggle: backendStt.toggleRecording,
        isRecording: backendStt.isRecording,
        isTranscribing: backendStt.isTranscribing,
        supported: true,
        backend: "backend" as AudioBackend,
        error: backendStt.error,
        status: backendStt.status,
      };
    }

    return {
      toggle: () => {},
      isRecording: false,
      isTranscribing: false,
      supported: false,
      backend: "none" as AudioBackend,
      error: "Brak mikrofonu: Web Speech API niedostępne, Tauri backend niedostępny",
      status: "STT niedostępne",
    };
  }, [sttBackend, backendStt]);

  // ── TTS routing ─────────────────────────────────────

  const ttsBackend: AudioBackend = nativeTtsAvailable
    ? "native"
    : backendTts.supported
      ? "backend"
      : "none";

  const tts: TtsInterface = useMemo(() => {
    if (ttsBackend === "native") {
      return {
        speak: async (text: string) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = lang;
          utterance.rate = ttsRate;
          utterance.volume = ttsVolume;
          window.speechSynthesis.speak(utterance);
        },
        stop: () => window.speechSynthesis.cancel(),
        isSpeaking: false,
        supported: true,
        backend: "native" as AudioBackend,
        engineInfo: "Web Speech API (native browser)",
        error: null,
      };
    }

    if (ttsBackend === "backend") {
      return {
        speak: backendTts.speak,
        stop: backendTts.stop,
        isSpeaking: backendTts.isSpeaking,
        supported: true,
        backend: "backend" as AudioBackend,
        engineInfo: backendTts.engineInfo?.engine_info ?? "Backend TTS",
        error: backendTts.error,
      };
    }

    return {
      speak: async () => {},
      stop: () => {},
      isSpeaking: false,
      supported: false,
      backend: "none" as AudioBackend,
      engineInfo: "TTS niedostępne",
      error: "Brak TTS: Web Speech API i backend niedostępne. Zainstaluj espeak-ng.",
    };
  }, [ttsBackend, backendTts, lang, ttsRate, ttsVolume]);

  // ── Summary ─────────────────────────────────────────

  const ready = stt.supported || tts.supported;

  const summary = [
    `STT: ${stt.backend} (${stt.supported ? "✓" : "✗"})`,
    `TTS: ${tts.backend} (${tts.supported ? "✓" : "✗"})`,
    isRunningInTauri ? "Tauri" : "Browser",
  ].join(" | ");

  useEffect(() => {
    log.info(summary);
  }, [summary]);

  return { stt, tts, ready, summary };
}

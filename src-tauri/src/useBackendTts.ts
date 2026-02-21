/**
 * useBackendTts — Text-to-Speech via Rust backend (Piper / espeak-ng).
 *
 * Bypasses WebKitGTK's missing SpeechSynthesis API.
 * Audio is synthesized and played on the Rust side via ALSA.
 *
 * Two modes:
 * 1. Backend playback: Rust plays audio directly through speakers (default)
 * 2. Frontend playback: Rust sends WAV base64, frontend plays via <audio>
 *
 * Usage:
 *   const tts = useBackendTts();
 *   tts.speak("Cześć, witam na stronie");
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("backendTts");

interface TtsInfo {
  engine: string;
  engine_info: string;
  piper_installed: boolean;
  setup_instructions: string | null;
}

interface UseBackendTtsOptions {
  /** Speech rate 0.5-2.0 (default: 1.0) */
  rate?: number;
  /** Volume 0-1 (default: 1.0) */
  volume?: number;
  /** Language code (default: "pl-PL") */
  lang?: string;
  /** Use frontend playback via <audio> instead of backend (default: false) */
  frontendPlayback?: boolean;
}

interface UseBackendTtsReturn {
  /** Speak text */
  speak: (text: string) => Promise<void>;
  /** Stop speaking (only works with frontend playback) */
  stop: () => void;
  /** Is currently speaking */
  isSpeaking: boolean;
  /** Backend TTS is supported */
  supported: boolean;
  /** TTS engine info */
  engineInfo: TtsInfo | null;
  /** Last error */
  error: string | null;
}

export function useBackendTts(options: UseBackendTtsOptions = {}): UseBackendTtsReturn {
  const {
    rate = 1.0,
    volume = 1.0,
    lang = "pl-PL",
    frontendPlayback = false,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [engineInfo, setEngineInfo] = useState<TtsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const invokeRef = useRef<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null>(null);

  // Check availability and get engine info
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        invokeRef.current = invoke;

        const info = (await invoke("tts_info")) as TtsInfo;
        setEngineInfo(info);
        setSupported(info.engine !== "None");

        if (info.setup_instructions) {
          log.info("Piper not installed — using espeak-ng fallback");
        } else {
          log.info(`TTS engine: ${info.engine_info}`);
        }
      } catch {
        setSupported(false);
        log.info("Backend TTS not available (browser runtime)");
      }
    })();
  }, []);

  const invoke = useCallback(
    async (cmd: string, args?: Record<string, unknown>) => {
      if (!invokeRef.current) throw new Error("Tauri not available");
      return invokeRef.current(cmd, args);
    },
    []
  );

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setError(null);
      setIsSpeaking(true);

      try {
        if (frontendPlayback) {
          // Get WAV as base64 and play in frontend
          const base64 = (await invoke("tts_speak_base64", {
            text,
            rate,
            lang,
          })) as string;

          await playBase64Audio(base64, volume, audioRef);
        } else {
          // Let Rust play audio directly through ALSA
          await invoke("tts_speak", { text, rate, volume, lang });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`TTS error: ${msg}`);
        setError(msg);
      } finally {
        setIsSpeaking(false);
      }
    },
    [invoke, rate, volume, lang, frontendPlayback]
  );

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    supported,
    engineInfo,
    error,
  };
}

// ── Helpers ──────────────────────────────────────────

/** Play base64 WAV audio in the browser. */
async function playBase64Audio(
  base64: string,
  volume: number,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    audio.volume = Math.max(0, Math.min(1, volume));
    audioRef.current = audio;

    audio.onended = () => {
      audioRef.current = null;
      resolve();
    };

    audio.onerror = (e) => {
      audioRef.current = null;
      reject(new Error(`Audio playback error: ${e}`));
    };

    audio.play().catch(reject);
  });
}

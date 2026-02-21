/**
 * useBackendStt — Speech-to-Text via Rust backend (cpal + OpenRouter Whisper).
 *
 * Bypasses WebKitGTK's broken getUserMedia by recording audio natively
 * through ALSA (cpal crate) and transcribing via cloud Whisper API.
 *
 * Usage:
 *   const stt = useBackendStt({ lang: "pl", onTranscript: (text) => handleSubmit(text) });
 *   <button onClick={stt.toggleRecording}>🎤</button>
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("backendStt");

interface UseBackendSttOptions {
  /** Language code for transcription (default: "pl") */
  lang?: string;
  /** Called when transcription is ready */
  onTranscript?: (text: string) => void;
  /** Auto-stop after N seconds of silence (default: 3) */
  silenceTimeout?: number;
  /** Max recording duration in seconds (default: 30) */
  maxDuration?: number;
}

interface UseBackendSttReturn {
  /** Start/stop recording toggle */
  toggleRecording: () => void;
  /** Start recording */
  startRecording: () => Promise<void>;
  /** Stop recording and transcribe */
  stopRecording: () => Promise<string>;
  /** Is currently recording */
  isRecording: boolean;
  /** Is currently transcribing */
  isTranscribing: boolean;
  /** Backend STT is supported (Tauri runtime detected) */
  supported: boolean;
  /** Last error */
  error: string | null;
  /** Human-readable status */
  status: string;
}

export function useBackendStt(options: UseBackendSttOptions = {}): UseBackendSttReturn {
  const {
    lang = "pl",
    onTranscript,
    silenceTimeout = 3,
    maxDuration = 30,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const maxDurationTimer = useRef<ReturnType<typeof setTimeout>>();
  const invokeRef = useRef<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null>(null);

  // Check if Tauri is available
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        invokeRef.current = invoke;
        setSupported(true);
        log.info("Backend STT available (Tauri runtime)");
      } catch {
        setSupported(false);
        log.info("Backend STT not available (browser runtime)");
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

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setError(null);

    try {
      await invoke("stt_start");
      setIsRecording(true);
      log.info("Recording started");

      // Auto-stop after max duration
      maxDurationTimer.current = setTimeout(async () => {
        log.info(`Max duration (${maxDuration}s) reached, stopping`);
        try {
          // We need to call stopRecording logic directly
          setIsRecording(false);
          setIsTranscribing(true);
          const transcript = (await invoke("stt_stop")) as string;
          setIsTranscribing(false);
          if (transcript && onTranscript) {
            onTranscript(transcript);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setIsTranscribing(false);
        }
      }, maxDuration * 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Start error: ${msg}`);
      setError(msg);
    }
  }, [isRecording, invoke, maxDuration, onTranscript]);

  const stopRecording = useCallback(async (): Promise<string> => {
    if (!isRecording) return "";

    clearTimeout(maxDurationTimer.current);
    setIsRecording(false);
    setIsTranscribing(true);
    setError(null);

    try {
      const transcript = (await invoke("stt_stop")) as string;
      log.info(`Transcript: "${transcript}"`);
      setIsTranscribing(false);

      if (transcript && onTranscript) {
        onTranscript(transcript);
      }

      return transcript;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Stop/transcribe error: ${msg}`);
      setError(msg);
      setIsTranscribing(false);
      return "";
    }
  }, [isRecording, invoke, onTranscript]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(maxDurationTimer.current);
      if (isRecording && invokeRef.current) {
        invokeRef.current("stt_stop").catch(() => {});
      }
    };
  }, [isRecording]);

  const status = isTranscribing
    ? "Transkrypcja..."
    : isRecording
      ? "Nagrywam... (kliknij by zakończyć)"
      : error
        ? `Błąd: ${error}`
        : "Gotowy";

  return {
    toggleRecording,
    startRecording,
    stopRecording,
    isRecording,
    isTranscribing,
    supported,
    error,
    status,
  };
}

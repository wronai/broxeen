import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";
import { logger, logAsyncDecorator, logSyncDecorator } from "../lib/logger";
import { transcribeAudio, type SttAudioFormat } from "../lib/sttClient";

const sttLogger = logger.scope("speech:stt:ui");
const STT_TAURI_BACKEND_REASON =
  "Web Speech/MediaRecorder niedostępne — używam natywnego backendu STT Tauri (cpal + Whisper).";
const STT_TAURI_BACKEND_UNAVAILABLE_REASON =
  "Analiza mowy (STT) niedostępna: brak MediaRecorder i błąd natywnego backendu STT w Tauri.";

interface UseSttOptions {
  lang?: string;
}

interface UseSttReturn {
  isSupported: boolean;
  unsupportedReason: string | null;
  isRecording: boolean;
  isTranscribing: boolean;
  transcript: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function writeWavPcm16(audioBuffer: AudioBuffer): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = audioBuffer.getChannelData(ch)[i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, Math.round(clamped * 0x7fff), true);
      offset += 2;
    }
  }

  return buffer;
}

async function blobToWavBase64(
  blob: Blob,
): Promise<{ base64: string; format: SttAudioFormat }> {
  if (typeof AudioContext === "undefined") {
    const buf = await blob.arrayBuffer();
    return { base64: arrayBufferToBase64(buf), format: "ogg" };
  }

  const ctx = new AudioContext();
  try {
    const arr = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arr.slice(0));
    const wav = writeWavPcm16(audioBuffer);
    return { base64: arrayBufferToBase64(wav), format: "wav" };
  } finally {
    ctx.close().catch(() => undefined);
  }
}

function getUnsupportedReason(): string | null {
  if (typeof window === "undefined") {
    return "Brak środowiska przeglądarkowego.";
  }
  if (!window.isSecureContext) {
    return "Brak secure context (getUserMedia może być zablokowane w tym środowisku).";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Brak dostępu do navigator.mediaDevices.getUserMedia.";
  }
  if (typeof window.MediaRecorder === "undefined") {
    return "Brak wsparcia MediaRecorder w tym środowisku.";
  }
  return null;
}

function toErrorDetails(e: unknown) {
  const err = e as any;
  return {
    name: typeof err?.name === "string" ? err.name : undefined,
    message: typeof err?.message === "string" ? err.message : String(e),
    stack: typeof err?.stack === "string" ? err.stack : undefined,
    constraint:
      typeof err?.constraint === "string" ? err.constraint : undefined,
  };
}

export function useStt(options: UseSttOptions = {}): UseSttReturn {
  const { lang = "pl-PL" } = options;
  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(
    null,
  );
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<"media" | "tauri" | "none">("none");
  const isRecordingRef = useRef(false);

  useEffect(() => {
    const reason = getUnsupportedReason();
    const runtime = isTauriRuntime() ? "tauri" : "browser";
    const browserMediaSupported = !reason;

    if (browserMediaSupported) {
      modeRef.current = "media";
      setIsSupported(true);
      setUnsupportedReason(null);
    } else if (runtime === "tauri") {
      modeRef.current = "tauri";
      setIsSupported(true);
      setUnsupportedReason(STT_TAURI_BACKEND_REASON);
    } else {
      modeRef.current = "none";
      setIsSupported(false);
      setUnsupportedReason(reason);
    }

    sttLogger.info("STT(MediaRecorder) capability check", {
      supported: modeRef.current !== "none",
      runtime,
      mode: modeRef.current,
      hasMediaRecorder: typeof window !== "undefined" && !!window.MediaRecorder,
      isSecureContext:
        typeof window !== "undefined" ? window.isSecureContext : undefined,
      origin:
        typeof window !== "undefined" ? window.location?.origin : undefined,
      lang,
    });
    if (reason) {
      sttLogger.warn("STT(MediaRecorder) not supported", {
        reason,
        fallbackMode: modeRef.current,
      });
    }
  }, [lang]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startTauriRecording = useCallback(() => {
    const runBackendStart = logAsyncDecorator(
      "speech:stt:ui",
      "startRecordingTauriBackend",
      async () => {
        await invoke("stt_start");
        setIsRecording(true);
        sttLogger.info("Native Tauri STT recording started");
      },
    );

    void runBackendStart().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      sttLogger.error("Failed to start Tauri STT recording", { error: msg });
      setIsSupported(false);
      setUnsupportedReason(
        `${STT_TAURI_BACKEND_UNAVAILABLE_REASON} ${msg}`.trim(),
      );
      setError(msg);
      setIsRecording(false);
    });
  }, [lang]);

  const startRecording = useCallback(() => {
    const run = logSyncDecorator("speech:stt:ui", "startRecording", () => {
      setError(null);
      setTranscript("");

      if (modeRef.current === "tauri") {
        startTauriRecording();
        return;
      }

      if (modeRef.current !== "media" || !isSupported) {
        const reason = getUnsupportedReason();
        setUnsupportedReason(reason);
        throw new Error(reason || "STT not supported");
      }

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          streamRef.current = stream;
          chunksRef.current = [];

          const recorder = new MediaRecorder(stream);
          recorderRef.current = recorder;

          recorder.ondataavailable = (ev: BlobEvent) => {
            if (ev.data && ev.data.size > 0) {
              chunksRef.current.push(ev.data);
            }
          };

          recorder.onstop = async () => {
            const runOnStop = logAsyncDecorator(
              "speech:stt:ui",
              "onStop->transcribe",
              async () => {
                setIsRecording(false);
                stopTracks();

                const blob = new Blob(chunksRef.current, {
                  type: recorder.mimeType || "audio/webm",
                });

                setIsTranscribing(true);
                try {
                  const { base64, format } = await blobToWavBase64(blob);
                  const text = await transcribeAudio(base64, format, lang);
                  setTranscript(text);
                  sttLogger.info("Transcription received", {
                    length: text.length,
                  });
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  sttLogger.error("Transcription failed", { error: msg });
                  setError(msg);
                } finally {
                  setIsTranscribing(false);
                }
              },
            );

            await runOnStop();
          };

          recorder.start();
          setIsRecording(true);
          sttLogger.info("MediaRecorder started");
        })
        .catch((e: unknown) => {
          const details = toErrorDetails(e);
          const runtime = isTauriRuntime() ? "tauri" : "browser";
          sttLogger.error("Failed to getUserMedia for STT", {
            ...details,
            runtime,
            isSecureContext:
              typeof window !== "undefined"
                ? window.isSecureContext
                : undefined,
            origin:
              typeof window !== "undefined"
                ? window.location?.origin
                : undefined,
          });

          const shouldFallbackToNative =
            runtime === "tauri" && modeRef.current === "media";
          if (shouldFallbackToNative) {
            sttLogger.warn(
              "Switching to native STT after getUserMedia failure",
              details,
            );
            modeRef.current = "tauri";
            setUnsupportedReason(STT_TAURI_BACKEND_REASON);
            setIsSupported(true);
            stopTracks();
            startTauriRecording();
            return;
          }

          setError(details.message);
          setIsRecording(false);
          stopTracks();
        });
    });

    run();
  }, [isSupported, lang, startTauriRecording, stopTracks]);

  const stopRecording = useCallback(() => {
    const run = logSyncDecorator("speech:stt:ui", "stopRecording", () => {
      if (modeRef.current === "tauri") {
        const runBackendStop = logAsyncDecorator(
          "speech:stt:ui",
          "stopRecordingTauriBackend",
          async () => {
            if (!isRecording) {
              sttLogger.debug("Tauri STT stop ignored — not recording");
              return;
            }

            setIsRecording(false);
            setIsTranscribing(true);
            setError(null);

            try {
              const transcriptValue = await invoke<string>("stt_stop", {
                language: lang.split("-")[0],
              });
              const normalized = (transcriptValue || "").trim();
              if (normalized) {
                setTranscript(normalized);
                sttLogger.info("Native STT transcription received", {
                  length: normalized.length,
                });
              } else {
                sttLogger.warn("Native STT transcription returned empty text");
              }
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              sttLogger.error("Native STT stop/transcribe failed", {
                error: msg,
              });
              setError(msg);
            } finally {
              setIsTranscribing(false);
            }
          },
        );

        void runBackendStop();
        return;
      }

      const rec = recorderRef.current;
      if (!rec) {
        sttLogger.debug("No recorder instance to stop");
        setIsRecording(false);
        stopTracks();
        return;
      }
      try {
        rec.stop();
      } catch (e) {
        sttLogger.warn("Recorder stop threw", { error: e });
      }
    });

    run();
  }, [isRecording, lang, stopTracks]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    return () => {
      if (modeRef.current === "tauri" && isRecordingRef.current) {
        invoke("stt_stop", { language: lang.split("-")[0] }).catch(
          () => undefined,
        );
      }
    };
  }, [lang]);

  return {
    isSupported,
    unsupportedReason,
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopRecording,
  };
}

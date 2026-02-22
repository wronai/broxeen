import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logger, logAsyncDecorator, logSyncDecorator } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";

export interface TtsOptions {
  rate: number;
  pitch: number;
  volume: number;
  voice: string;
  lang: string;
}

const DEFAULT_OPTIONS: TtsOptions = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  voice: "",
  lang: "pl-PL",
};

const ttsLogger = logger.scope("speech:tts");
const MAX_TTS_SENTENCES = 100;
const TTS_UNAVAILABLE_REASON =
  "Synteza mowy (TTS) nie jest wspierana w tym środowisku (brak SpeechSynthesis API).";
const TTS_TAURI_FALLBACK_UNAVAILABLE_REASON =
  "Synteza mowy (TTS) nie jest dostępna: brak SpeechSynthesis API i brak backendu TTS w Tauri.";

interface TauriTtsAvailability {
  supported?: boolean;
  backend?: string;
  reason?: string | null;
}

interface BackendTtsInfo {
  engine?: string;
  engine_info?: string;
  piper_installed?: boolean;
  setup_instructions?: string | null;
}

function getSpeechSynthesisApi(): SpeechSynthesis | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.speechSynthesis;
}

function preprocessForTts(text: string): string {
  const normalized = text
    .replace(/[^\p{L}\p{N}\s.,!?;:()\-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/([.!?])\s*([A-ZĄĆĘŁŃÓŚŹŻ])/g, "$1 | $2")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized.split(" | ").slice(0, MAX_TTS_SENTENCES).join(" ");
}

function estimateBackendSpeechDurationMs(text: string, rate: number): number {
  const words = Math.max(1, text.split(/\s+/).length);
  const wordsPerMinute = Math.max(80, Math.round(175 * Math.max(0.5, rate)));
  const minutes = words / wordsPerMinute;
  return Math.max(900, Math.round(minutes * 60_000));
}

export function useTts(options: Partial<TtsOptions> = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [progress, setProgress] = useState(0);
  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(
    null,
  );
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const totalLenRef = useRef(0);
  const backendSupportedRef = useRef(false);
  const backendModeRef = useRef<"none" | "native" | "legacy">("none");
  const backendProgressTimerRef = useRef<number | null>(null);
  const backendProgressIntervalRef = useRef<number | null>(null);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const clearBackendProgress = useCallback(() => {
    if (backendProgressTimerRef.current !== null) {
      window.clearTimeout(backendProgressTimerRef.current);
      backendProgressTimerRef.current = null;
    }

    if (backendProgressIntervalRef.current !== null) {
      window.clearInterval(backendProgressIntervalRef.current);
      backendProgressIntervalRef.current = null;
    }
  }, []);

  const startBackendProgress = useCallback(
    (durationMs: number) => {
      clearBackendProgress();

      const startedAt = Date.now();
      setProgress(0);

      backendProgressIntervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const next = Math.min(95, Math.round((elapsed / durationMs) * 95));
        setProgress(next);
      }, 250);

      backendProgressTimerRef.current = window.setTimeout(() => {
        clearBackendProgress();
        setProgress(100);
        setIsSpeaking(false);
        setIsPaused(false);
      }, durationMs);
    },
    [clearBackendProgress],
  );

  useEffect(() => {
    let isMounted = true;
    const speechSynthesisApi = getSpeechSynthesisApi();
    const runtimeIsTauri = isTauriRuntime();
    const browserSupported = !!speechSynthesisApi;

    backendSupportedRef.current = false;
    backendModeRef.current = "none";
    setIsSupported(browserSupported);
    setUnsupportedReason(browserSupported ? null : TTS_UNAVAILABLE_REASON);

    ttsLogger.info("Initializing TTS hook", {
      hasSpeechSynthesis: browserSupported,
      runtime: runtimeIsTauri ? "tauri" : "browser",
    });

    const loadVoices = logSyncDecorator("speech:tts", "loadVoices", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) {
        ttsLogger.warn(
          "window.speechSynthesis is not supported in this environment",
        );
        return;
      }
      const available = synthesis.getVoices();
      ttsLogger.info("TTS voices snapshot captured", {
        count: available.length,
      });
      setVoices(available);
    });

    if (browserSupported) {
      loadVoices();
      ttsLogger.debug("Registering speechSynthesis.onvoiceschanged listener");
      speechSynthesisApi.onvoiceschanged = loadVoices;
    } else if (runtimeIsTauri) {
      const probeTauriBackendTts = logAsyncDecorator(
        "speech:tts",
        "probeTauriBackendTts",
        async () => {
          try {
            const backendInfo =
              await invoke<BackendTtsInfo>("backend_tts_info");
            const engine = (backendInfo?.engine ?? "").trim();
            const backendSupported = engine.length > 0 && engine !== "None";

            if (!isMounted) {
              return;
            }

            backendSupportedRef.current = backendSupported;
            backendModeRef.current = backendSupported ? "native" : "none";
            setIsSupported(backendSupported);
            setUnsupportedReason(
              backendSupported ? null : TTS_TAURI_FALLBACK_UNAVAILABLE_REASON,
            );

            ttsLogger.info("Tauri native backend TTS probe completed", {
              supported: backendSupported,
              engine,
              engineInfo: backendInfo?.engine_info,
              piperInstalled: backendInfo?.piper_installed,
            });

            if (backendInfo?.setup_instructions) {
              ttsLogger.warn(
                "Piper TTS is not installed; backend may use espeak fallback",
                {
                  setupHintAvailable: true,
                },
              );
            }
          } catch (nativeError) {
            ttsLogger.warn(
              "Failed to probe native backend TTS info, trying legacy tts_is_available",
              {
                error: nativeError,
              },
            );

            try {
              const availability =
                await invoke<TauriTtsAvailability>("tts_is_available");
              const backendSupported = !!availability?.supported;

              if (!isMounted) {
                return;
              }

              backendSupportedRef.current = backendSupported;
              backendModeRef.current = backendSupported ? "legacy" : "none";
              setIsSupported(backendSupported);
              setUnsupportedReason(
                backendSupported
                  ? null
                  : availability?.reason ||
                      TTS_TAURI_FALLBACK_UNAVAILABLE_REASON,
              );

              ttsLogger.info("Legacy Tauri backend TTS probe completed", {
                supported: backendSupported,
                backend: availability?.backend || "unknown",
                reason: availability?.reason || null,
              });
            } catch (error) {
              if (!isMounted) {
                return;
              }

              backendSupportedRef.current = false;
              backendModeRef.current = "none";
              setIsSupported(false);
              setUnsupportedReason(TTS_TAURI_FALLBACK_UNAVAILABLE_REASON);
              ttsLogger.warn("Failed to probe Tauri backend TTS support", {
                error,
              });
            }

            if (!isMounted) {
              return;
            }
          }
        },
      );

      void probeTauriBackendTts();
    }

    return () => {
      isMounted = false;
      clearBackendProgress();
      const synthesis = getSpeechSynthesisApi();
      if (synthesis) {
        ttsLogger.debug("Removing speechSynthesis.onvoiceschanged listener");
        synthesis.onvoiceschanged = null;
      }
    };
  }, [clearBackendProgress]);

  const speak = useCallback(
    (text: string) => {
      const runSpeak = logSyncDecorator("speech:tts", "speak", () => {
        const preparedText = preprocessForTts(text);

        if (!preparedText) {
          ttsLogger.warn("Empty text provided for TTS after preprocessing");
          return;
        }

        const synthesis = getSpeechSynthesisApi();

        if (!synthesis) {
          const runtimeIsTauri = isTauriRuntime();
          if (!runtimeIsTauri || !backendSupportedRef.current) {
            ttsLogger.warn("TTS backend is not available for this runtime");
            return;
          }

          setIsSpeaking(true);
          setIsPaused(false);

          const estimatedDurationMs = estimateBackendSpeechDurationMs(
            preparedText,
            opts.rate,
          );
          startBackendProgress(estimatedDurationMs);

          const runSpeakViaBackend = logAsyncDecorator(
            "speech:tts",
            "speakViaTauriBackend",
            async () => {
              try {
                if (backendModeRef.current === "native") {
                  await invoke("backend_tts_speak", {
                    text: preparedText,
                    lang: opts.lang,
                    rate: opts.rate,
                    volume: opts.volume,
                  });
                } else {
                  await invoke("tts_speak", {
                    text: preparedText,
                    lang: opts.lang,
                    rate: opts.rate,
                    pitch: opts.pitch,
                    volume: opts.volume,
                    voice: opts.voice || null,
                  });
                }

                ttsLogger.info("Started TTS through Tauri backend", {
                  textLength: preparedText.length,
                  lang: opts.lang,
                  mode: backendModeRef.current,
                  estimatedDurationMs,
                });
              } catch (error) {
                clearBackendProgress();
                setIsSpeaking(false);
                setIsPaused(false);
                setProgress(0);

                const message =
                  error instanceof Error ? error.message : String(error);
                ttsLogger.error("Tauri backend TTS failed", { error: message });
                setUnsupportedReason(
                  message || TTS_TAURI_FALLBACK_UNAVAILABLE_REASON,
                );
              }
            },
          );

          void runSpeakViaBackend();
          return;
        }

        ttsLogger.info("Starting TTS utterance", {
          textLength: preparedText.length,
          lang: opts.lang,
          requestedVoice: opts.voice || "auto",
        });

        synthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(preparedText);
        utterance.rate = opts.rate;
        utterance.pitch = opts.pitch;
        utterance.volume = opts.volume;
        utterance.lang = opts.lang;

        if (opts.voice) {
          const found = voices.find((v) => v.name === opts.voice);
          if (found) {
            ttsLogger.debug(`Using configured voice: ${found.name}`);
            utterance.voice = found;
          } else {
            ttsLogger.warn(`Configured voice not found: ${opts.voice}`);
          }
        } else {
          const plVoice = voices.find((v) => v.lang.startsWith("pl"));
          if (plVoice) {
            ttsLogger.debug(`Using default PL voice: ${plVoice.name}`);
            utterance.voice = plVoice;
          }
        }

        totalLenRef.current = preparedText.length;
        utterance.onboundary = (e) => {
          if (totalLenRef.current > 0) {
            setProgress(Math.round((e.charIndex / totalLenRef.current) * 100));
          }
        };

        utterance.onstart = () => {
          ttsLogger.info("TTS started");
          setIsSpeaking(true);
          setIsPaused(false);
          setProgress(0);
        };

        utterance.onend = () => {
          ttsLogger.info("TTS ended");
          setIsSpeaking(false);
          setIsPaused(false);
          setProgress(100);
        };

        utterance.onerror = (e) => {
          ttsLogger.error("TTS error", e);
          setIsSpeaking(false);
          setIsPaused(false);
        };

        utteranceRef.current = utterance;
        synthesis.speak(utterance);
      });

      runSpeak();
    },
    [
      clearBackendProgress,
      opts.rate,
      opts.pitch,
      opts.volume,
      opts.voice,
      opts.lang,
      startBackendProgress,
      voices,
    ],
  );

  const pause = useCallback(() => {
    const runPause = logSyncDecorator("speech:tts", "pause", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) {
        if (isTauriRuntime() && backendSupportedRef.current) {
          if (backendModeRef.current === "native") {
            ttsLogger.info("Pausing native Tauri backend TTS");
            invoke("backend_tts_pause").catch((e) =>
              ttsLogger.warn("Failed to pause TTS", { error: e }),
            );
            setIsPaused(true);
          } else {
            ttsLogger.warn(
              "Pause is not supported for legacy Tauri backend TTS. Use stop instead.",
            );
          }
        }
        return;
      }
      ttsLogger.info("Pausing TTS");
      synthesis.pause();
      setIsPaused(true);
    });

    runPause();
  }, []);

  const resume = useCallback(() => {
    const runResume = logSyncDecorator("speech:tts", "resume", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) {
        if (isTauriRuntime() && backendSupportedRef.current) {
          if (backendModeRef.current === "native") {
            ttsLogger.info("Resuming native Tauri backend TTS");
            invoke("backend_tts_resume").catch((e) =>
              ttsLogger.warn("Failed to resume TTS", { error: e }),
            );
            setIsPaused(false);
          } else {
            ttsLogger.warn(
              "Resume is not supported for legacy Tauri backend TTS.",
            );
          }
        }
        return;
      }
      ttsLogger.info("Resuming TTS");
      synthesis.resume();
      setIsPaused(false);
    });

    runResume();
  }, []);

  const stop = useCallback(() => {
    const runStop = logSyncDecorator("speech:tts", "stop", () => {
      const synthesis = getSpeechSynthesisApi();

      clearBackendProgress();

      if (synthesis) {
        ttsLogger.info("Stopping TTS manually");
        synthesis.cancel();
      } else if (isTauriRuntime() && backendSupportedRef.current) {
        const runStopViaBackend = logAsyncDecorator(
          "speech:tts",
          "stopViaTauriBackend",
          async () => {
            try {
              if (backendModeRef.current === "native") {
                await invoke("backend_tts_stop");
              } else if (backendModeRef.current === "legacy") {
                await invoke("tts_stop");
              }
            } catch (error) {
              ttsLogger.warn("Failed to stop Tauri backend TTS", { error });
            }
          },
        );

        void runStopViaBackend();
      }

      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
    });

    runStop();
  }, [clearBackendProgress]);

  return {
    speak,
    pause,
    resume,
    stop,
    isSpeaking,
    isPaused,
    voices,
    progress,
    isSupported,
    unsupportedReason,
  };
}

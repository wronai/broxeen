import { useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSpeech } from "./useSpeech";
import { useStt } from "./useStt";
import { useTts } from "./useTts";
import { isTauriRuntime } from "../lib/runtime";
import { logger } from "../lib/logger";
import type { AudioSettings } from "../domain/audioSettings";
import type { EventStore } from "../domain/eventStore";
import type { MicPhase } from "../components/ChatInput";

const speechLogger = logger.scope("chat:speech");

// ─── Hook ────────────────────────────────────────────────────────────

export interface UseChatSpeechDeps {
  settings: AudioSettings;
  eventStore: EventStore;
  wakeWordEnabled: boolean;
  setWakeWordEnabled: (v: boolean) => void;
  setInput: (v: string) => void;
  onTranscriptReady: (text: string) => void;
  appendStatusNotice: (key: string, text: string) => void;
}

export interface UseChatSpeechReturn {
  // Speech state
  isListening: boolean;
  speechSupported: boolean;
  speechUnsupportedReason: string | null | undefined;
  // STT state
  stt: ReturnType<typeof useStt>;
  // TTS state
  tts: ReturnType<typeof useTts>;
  // Computed
  micPhase: MicPhase;
  shouldUseWebSpeech: boolean;
  // Actions
  toggleMic: () => void;
}

export function useChatSpeech(deps: UseChatSpeechDeps): UseChatSpeechReturn {
  const {
    settings,
    eventStore,
    wakeWordEnabled,
    setWakeWordEnabled,
    setInput,
    onTranscriptReady,
    appendStatusNotice,
  } = deps;

  // ── Core speech hooks ──
  const {
    isListening,
    transcript,
    interimTranscript,
    finalTranscript,
    isSupported: speechSupported,
    unsupportedReason: speechUnsupportedReason,
    startListening,
    stopListening,
    enableAutoListen,
    disableAutoListen,
    clearFinalTranscript,
  } = useSpeech(settings.tts_lang);

  const stt = useStt({ lang: settings.tts_lang, audioSettings: settings });

  const shouldUseWebSpeech =
    settings.stt_engine === "webspeech" && speechSupported;

  const tts = useTts({
    rate: settings.tts_rate,
    pitch: settings.tts_pitch,
    volume: settings.tts_volume,
    voice: settings.tts_voice,
    lang: settings.tts_lang,
  });

  const micPhase = useMemo(() => {
    if (stt.isTranscribing) return "transcribing" as const;
    if (stt.isRecording) return "recording" as const;
    if (isListening) return "listening" as const;
    return "idle" as const;
  }, [isListening, stt.isRecording, stt.isTranscribing]);

  // ── Effects ──

  // Stop TTS when mic activates
  useEffect(() => {
    if (micPhase !== "idle" && tts.isSpeaking) {
      tts.stop();
    }
  }, [micPhase, tts]);

  // Refs for auto-listen
  const lastSpeechSubmitRef = useRef<string>("");
  const sttAutoListenTimerRef = useRef<number | null>(null);
  const sttAutoListenStartedAtRef = useRef<number | null>(null);
  const sttAutoListenSilenceHitsRef = useRef<number>(0);

  // Speech unsupported notices
  useEffect(() => {
    if (settings.mic_enabled && settings.stt_engine === "webspeech" && !speechSupported) {
      if (speechUnsupportedReason && !stt.isSupported) {
        appendStatusNotice(
          "speech_unsupported",
          `ℹ️ ${speechUnsupportedReason}`,
        );
      }
      if (stt.isSupported) {
        appendStatusNotice(
          "speech_unsupported",
          `ℹ️ ${speechUnsupportedReason}`,
        );
      }
    }

    if (settings.mic_enabled && stt.error) {
      appendStatusNotice("stt_error", `ℹ️ Błąd STT: ${stt.error}`);
    }

    if (settings.tts_enabled && !tts.isSupported && tts.unsupportedReason) {
      appendStatusNotice("tts_unsupported", `ℹ️ ${tts.unsupportedReason}`);
    }
  }, [
    settings.mic_enabled,
    settings.stt_engine,
    settings.tts_enabled,
    speechSupported,
    speechUnsupportedReason,
    stt.isSupported,
    stt.error,
    tts.isSupported,
    tts.unsupportedReason,
    appendStatusNotice,
  ]);

  // Apply finalized speech transcript
  useEffect(() => {
    if (transcript && transcript !== lastSpeechSubmitRef.current && !isListening) {
      speechLogger.info("Applying finalized speech transcript", {
        transcriptLength: transcript.length,
      });
      lastSpeechSubmitRef.current = transcript;
      onTranscriptReady(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isListening]);

  // Apply auto-listen speech transcript
  useEffect(() => {
    if (finalTranscript) {
      speechLogger.info("Applying auto-listen speech transcript", {
        transcriptLength: finalTranscript.length,
      });
      onTranscriptReady(finalTranscript);
      clearFinalTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalTranscript]);

  // Auto-listen (Web Speech API)
  useEffect(() => {
    if (!settings.mic_enabled) {
      disableAutoListen();
      return;
    }

    if (!settings.auto_listen) {
      return;
    }

    if (!shouldUseWebSpeech) {
      return;
    }

    enableAutoListen();
    return () => disableAutoListen();
  }, [
    settings.mic_enabled,
    settings.auto_listen,
    shouldUseWebSpeech,
    enableAutoListen,
    disableAutoListen,
  ]);

  // Auto-listen fallback for STT (Tauri/native capture or MediaRecorder mode)
  useEffect(() => {
    const runtimeIsTauri = isTauriRuntime();

    const shouldRun =
      settings.mic_enabled &&
      settings.auto_listen &&
      !shouldUseWebSpeech &&
      stt.isSupported &&
      !wakeWordEnabled;

    if (!shouldRun) {
      if (sttAutoListenTimerRef.current !== null) {
        window.clearInterval(sttAutoListenTimerRef.current);
        sttAutoListenTimerRef.current = null;
      }
      sttAutoListenStartedAtRef.current = null;
      sttAutoListenSilenceHitsRef.current = 0;
      return;
    }

    // Start a new recording when idle
    if (!stt.isRecording && !stt.isTranscribing) {
      speechLogger.info("Auto-listen(STT): starting recording");
      sttAutoListenStartedAtRef.current = Date.now();
      sttAutoListenSilenceHitsRef.current = 0;
      try {
        stt.startRecording();
      } catch (e) {
        speechLogger.warn("Auto-listen(STT): startRecording failed", { error: e });
        sttAutoListenStartedAtRef.current = null;
        sttAutoListenSilenceHitsRef.current = 0;
      }
    }

    // Silence polling is only available in Tauri native audio path.
    if (!runtimeIsTauri) {
      return;
    }

    if (sttAutoListenTimerRef.current !== null) {
      return;
    }

    const silenceMs = Math.max(300, Math.min(5000, settings.auto_listen_silence_ms || 1000));
    const thresholdSeconds = silenceMs / 1000;
    const requiredHits = Math.max(1, Math.round(silenceMs / 250));

    sttAutoListenTimerRef.current = window.setInterval(async () => {
      try {
        if (!stt.isRecording || stt.isTranscribing) {
          return;
        }

        const startedAt = sttAutoListenStartedAtRef.current;
        const elapsedMs = startedAt ? Date.now() - startedAt : 0;

        // Avoid stopping too early (let Whisper get enough audio)
        if (elapsedMs < 1200) {
          return;
        }

        const silent = await invoke<boolean>('stt_is_silence', {
          thresholdSeconds,
          rmsThreshold: 0.015,
        });

        if (silent) {
          sttAutoListenSilenceHitsRef.current += 1;
        } else {
          sttAutoListenSilenceHitsRef.current = 0;
        }

        // Require consecutive silent checks to reduce flapping
        if (sttAutoListenSilenceHitsRef.current >= requiredHits) {
          speechLogger.info("Auto-listen(STT): silence detected -> stopping recording");
          sttAutoListenSilenceHitsRef.current = 0;
          stt.stopRecording();
          sttAutoListenStartedAtRef.current = null;
        }
      } catch (e) {
        speechLogger.debug("Auto-listen(STT): silence probe failed", { error: String(e) });
      }
    }, 250);

    return () => {
      if (sttAutoListenTimerRef.current !== null) {
        window.clearInterval(sttAutoListenTimerRef.current);
        sttAutoListenTimerRef.current = null;
      }
    };
  }, [
    settings.mic_enabled,
    settings.auto_listen,
    settings.auto_listen_silence_ms,
    shouldUseWebSpeech,
    stt.isSupported,
    stt.isRecording,
    stt.isTranscribing,
    stt.startRecording,
    stt.stopRecording,
    wakeWordEnabled,
  ]);

  // Apply finalized STT transcript to input
  const wakeWordTriggeredSttRef = useRef(false);

  useEffect(() => {
    if (stt.transcript && !stt.isRecording && !stt.isTranscribing) {
      speechLogger.info("✓ Applying finalized STT transcript to input", {
        transcript: stt.transcript,
        transcriptLength: stt.transcript.length,
        wakeWordTriggered: wakeWordTriggeredSttRef.current,
      });
      setInput(stt.transcript);
      stt.setTranscript("");
      speechLogger.info("→ Transcript cleared, ready for next input");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.transcript, stt.isRecording, stt.isTranscribing, setInput]);

  // Log STT/TTS availability warnings
  useEffect(() => {
    if (!settings.mic_enabled) {
      return;
    }

    if (settings.stt_engine === "webspeech" && !speechSupported && speechUnsupportedReason) {
      speechLogger.warn("Native STT (Web Speech API) is unavailable", {
        reason: speechUnsupportedReason,
        cloudFallbackSupported: stt.isSupported,
      });
    }

    if (!speechSupported && !stt.isSupported && stt.unsupportedReason) {
      speechLogger.warn("Cloud STT fallback is also unavailable", {
        reason: stt.unsupportedReason,
      });
    }
  }, [
    settings.mic_enabled,
    settings.stt_engine,
    speechSupported,
    speechUnsupportedReason,
    stt.isSupported,
    stt.unsupportedReason,
  ]);

  useEffect(() => {
    if (settings.tts_enabled && !tts.isSupported && tts.unsupportedReason) {
      speechLogger.warn(
        "TTS is enabled in settings but speech synthesis is unavailable",
        {
          reason: tts.unsupportedReason,
        },
      );
    }
  }, [settings.tts_enabled, tts.isSupported, tts.unsupportedReason]);

  // Listen for TTS triggers from Summary Generated Events
  useEffect(() => {
    if (!settings.tts_enabled) return;

    const unsub = eventStore.on("summary_generated", (event) => {
      const { summary } = event.payload;
      if (summary) {
        speechLogger.info(
          "Summary generated, TTS will be triggered by message_updated",
        );
      }
    });

    return unsub;
  }, [eventStore, settings.tts_enabled]);

  const previousLoadingWaitIdsRef = useRef(new Set<number>());

  // Listen for TTS triggers from Message Updated (for LLM general responses)
  useEffect(() => {
    if (!settings.tts_enabled) return;

    const unsub = eventStore.on("message_updated", (event) => {
      const { id, updates } = event.payload;
      if (
        updates.loading === false &&
        updates.text &&
        previousLoadingWaitIdsRef.current.has(id)
      ) {
        previousLoadingWaitIdsRef.current.delete(id);
        speechLogger.info("TTS auto-read triggered by message load complete");
        tts.speak(updates.text.slice(0, 3000));
      }
    });

    const unsub2 = eventStore.on("message_added", (event) => {
      if (event.payload.loading) {
        previousLoadingWaitIdsRef.current.add(event.payload.id);
      }
    });

    return () => {
      unsub();
      unsub2();
    };
  }, [eventStore, settings.tts_enabled, tts]);

  // ── Wake word ──

  // Listen for wake word detection from backend
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!settings.mic_enabled) return;
    if (!stt.isSupported) return;

    let unlisten: (() => void) | null = null;

    const setupWakeWordListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen("wake-word-detected", (event) => {
          const payload = event.payload as { confidence: number; timestamp: number };
          speechLogger.info("🎤 Wake word 'heyken' detected!", {
            confidence: payload.confidence,
            timestamp: payload.timestamp,
            sttRecording: stt.isRecording,
            sttTranscribing: stt.isTranscribing,
          });

          speechLogger.info("🎤 Wake word detected - manual recording only");
        });
        speechLogger.info("Wake word listener registered");
      } catch (err) {
        speechLogger.warn("Failed to setup wake word listener", { error: err });
      }
    };

    setupWakeWordListener();

    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
    };
  }, [settings.mic_enabled, stt.isSupported, stt.isRecording, stt.isTranscribing, stt.startRecording]);

  // Ref to track wake word running state
  const wakeWordRunningRef = useRef(false);
  const wakeWordStoppedForSttRef = useRef(false);

  // Start/stop wake word listening based on toggle
  useEffect(() => {
    if (!isTauriRuntime()) {
      wakeWordRunningRef.current = false;
      return;
    }
    if (!wakeWordEnabled) {
      if (wakeWordRunningRef.current) {
        speechLogger.debug("Stopping wake word listening (toggle disabled)");
        invoke("wake_word_stop").catch((err) => {
          speechLogger.debug("Failed to stop wake word listening", { error: err });
        });
        wakeWordRunningRef.current = false;
      }
      return;
    }
    if (!settings.mic_enabled) {
      speechLogger.warn("Cannot enable wake word: microphone disabled in settings");
      if (wakeWordRunningRef.current) {
        invoke("wake_word_stop").catch(() => { });
        wakeWordRunningRef.current = false;
      }
      return;
    }

    if (!wakeWordRunningRef.current) {
      speechLogger.info("Starting wake word listening for 'heyken'");
      invoke("wake_word_start")
        .then(() => {
          speechLogger.info("Wake word listening started successfully");
          wakeWordRunningRef.current = true;
          appendStatusNotice("wake_word", "🔊 Nasłuchiwanie 'heyken' aktywne");
        })
        .catch((err) => {
          speechLogger.error("Failed to start wake word listening", { error: err });
          wakeWordRunningRef.current = false;
          setWakeWordEnabled(false);
        });
    }

    return () => {
      if (wakeWordRunningRef.current) {
        speechLogger.debug("Cleanup: stopping wake word listening");
        invoke("wake_word_stop").catch(() => { });
        wakeWordRunningRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled, settings.mic_enabled]);

  // Stop wake word when wake-word-triggered STT starts, restart when it finishes
  useEffect(() => {
    if (!isTauriRuntime() || !wakeWordEnabled) {
      wakeWordStoppedForSttRef.current = false;
      return;
    }

    if (!wakeWordTriggeredSttRef.current) {
      wakeWordStoppedForSttRef.current = false;
      return;
    }

    if (stt.isRecording || stt.isTranscribing) {
      if (wakeWordRunningRef.current && !wakeWordStoppedForSttRef.current) {
        speechLogger.info("⏸ Pausing wake word during wake-word-triggered STT", {
          isRecording: stt.isRecording,
          isTranscribing: stt.isTranscribing,
        });
        invoke("wake_word_stop").catch(() => { });
        wakeWordRunningRef.current = false;
        wakeWordStoppedForSttRef.current = true;
      }
    } else {
      if (wakeWordStoppedForSttRef.current) {
        speechLogger.info("▶ Resuming wake word after wake-word-triggered STT completed", {
          wakeWordTriggered: wakeWordTriggeredSttRef.current,
          wakeWordRunning: wakeWordRunningRef.current,
        });
        wakeWordTriggeredSttRef.current = false;
        wakeWordStoppedForSttRef.current = false;

        if (!wakeWordRunningRef.current) {
          speechLogger.info("→ Restarting wake word listener...");
          invoke("wake_word_start")
            .then(() => {
              wakeWordRunningRef.current = true;
              speechLogger.info("✓ Wake word listener restarted successfully");
            })
            .catch((err) => {
              speechLogger.error("✗ Failed to restart wake word after STT", { error: err });
            });
        }
      }
    }
  }, [stt.isRecording, stt.isTranscribing, wakeWordEnabled]);

  // ── toggleMic ──

  const toggleMic = useCallback(() => {
    if (shouldUseWebSpeech) {
      if (isListening) {
        speechLogger.info("Microphone toggle -> stop listening (native)");
        stopListening();
      } else {
        speechLogger.info("Microphone toggle -> start listening (native)");
        startListening();
      }
      return;
    }

    if (!stt.isSupported) {
      speechLogger.warn("Microphone pressed but STT is unsupported", {
        speechSupported,
        sttSupported: stt.isSupported,
        speechUnsupportedReason,
        sttUnsupportedReason: stt.unsupportedReason,
      });

      if (speechUnsupportedReason) {
        appendStatusNotice(
          "mic_unsupported",
          `ℹ️ ${speechUnsupportedReason}`
        );
      } else if (stt.unsupportedReason) {
        appendStatusNotice(
          "mic_unsupported",
          `ℹ️ ${stt.unsupportedReason}`
        );
      }
      return;
    }

    if (stt.isRecording) {
      speechLogger.info("Microphone toggle -> stop recording (cloud STT)");
      stt.stopRecording();
      return;
    }

    speechLogger.info("Microphone toggle -> start recording (cloud STT)");
    stt.startRecording();
  }, [shouldUseWebSpeech, isListening, startListening, stopListening, stt, speechSupported, speechUnsupportedReason, appendStatusNotice]);

  return {
    isListening,
    speechSupported,
    speechUnsupportedReason,
    stt,
    tts,
    micPhase,
    shouldUseWebSpeech,
    toggleMic,
  };
}

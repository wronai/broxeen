import { useState, useCallback, useEffect, useRef } from "react";
import { logger, logSyncDecorator } from "../lib/logger";

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

export function useTts(options: Partial<TtsOptions> = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [progress, setProgress] = useState(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const totalLenRef = useRef(0);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  useEffect(() => {
    ttsLogger.info("Initializing TTS hook", {
      hasSpeechSynthesis:
        typeof window !== "undefined" && !!window.speechSynthesis,
    });

    const loadVoices = logSyncDecorator("speech:tts", "loadVoices", () => {
      if (!window.speechSynthesis) {
        ttsLogger.warn("window.speechSynthesis is not supported in this environment");
        return;
      }
      const available = window.speechSynthesis.getVoices();
      ttsLogger.info("TTS voices snapshot captured", { count: available.length });
      setVoices(available);
    });

    loadVoices();
    if (window.speechSynthesis) {
      ttsLogger.debug("Registering speechSynthesis.onvoiceschanged listener");
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (window.speechSynthesis) {
        ttsLogger.debug("Removing speechSynthesis.onvoiceschanged listener");
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      const runSpeak = logSyncDecorator("speech:tts", "speak", () => {
        if (!window.speechSynthesis) {
          ttsLogger.warn("window.speechSynthesis is not supported");
          return;
        }

        if (!text.trim()) {
          ttsLogger.warn("Empty text provided for TTS");
          return;
        }

        ttsLogger.info("Starting TTS utterance", {
          textLength: text.length,
          lang: opts.lang,
          requestedVoice: opts.voice || "auto",
        });

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
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

        totalLenRef.current = text.length;
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
        window.speechSynthesis.speak(utterance);
      });

      runSpeak();
    },
    [opts.rate, opts.pitch, opts.volume, opts.voice, opts.lang, voices],
  );

  const pause = useCallback(() => {
    const runPause = logSyncDecorator("speech:tts", "pause", () => {
      if (!window.speechSynthesis) return;
      ttsLogger.info("Pausing TTS");
      window.speechSynthesis.pause();
      setIsPaused(true);
    });

    runPause();
  }, []);

  const resume = useCallback(() => {
    const runResume = logSyncDecorator("speech:tts", "resume", () => {
      if (!window.speechSynthesis) return;
      ttsLogger.info("Resuming TTS");
      window.speechSynthesis.resume();
      setIsPaused(false);
    });

    runResume();
  }, []);

  const stop = useCallback(() => {
    const runStop = logSyncDecorator("speech:tts", "stop", () => {
      if (!window.speechSynthesis) return;
      ttsLogger.info("Stopping TTS manually");
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
    });

    runStop();
  }, []);

  return { speak, pause, resume, stop, isSpeaking, isPaused, voices, progress };
}

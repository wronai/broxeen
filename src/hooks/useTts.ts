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
const MAX_TTS_SENTENCES = 100;
const TTS_UNAVAILABLE_REASON =
  "Synteza mowy (TTS) nie jest wspierana w tym środowisku (brak SpeechSynthesis API).";

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

export function useTts(options: Partial<TtsOptions> = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [progress, setProgress] = useState(0);
  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const totalLenRef = useRef(0);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  useEffect(() => {
    const speechSynthesisApi = getSpeechSynthesisApi();
    const supported = !!speechSynthesisApi;
    setIsSupported(supported);
    setUnsupportedReason(supported ? null : TTS_UNAVAILABLE_REASON);

    ttsLogger.info("Initializing TTS hook", {
      hasSpeechSynthesis: supported,
    });

    const loadVoices = logSyncDecorator("speech:tts", "loadVoices", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) {
        ttsLogger.warn("window.speechSynthesis is not supported in this environment");
        return;
      }
      const available = synthesis.getVoices();
      ttsLogger.info("TTS voices snapshot captured", { count: available.length });
      setVoices(available);
    });

    loadVoices();
    if (speechSynthesisApi) {
      ttsLogger.debug("Registering speechSynthesis.onvoiceschanged listener");
      speechSynthesisApi.onvoiceschanged = loadVoices;
    }

    return () => {
      const synthesis = getSpeechSynthesisApi();
      if (synthesis) {
        ttsLogger.debug("Removing speechSynthesis.onvoiceschanged listener");
        synthesis.onvoiceschanged = null;
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      const runSpeak = logSyncDecorator("speech:tts", "speak", () => {
        const synthesis = getSpeechSynthesisApi();
        if (!synthesis) {
          ttsLogger.warn("window.speechSynthesis is not supported");
          return;
        }

        const preparedText = preprocessForTts(text);

        if (!preparedText) {
          ttsLogger.warn("Empty text provided for TTS after preprocessing");
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
    [opts.rate, opts.pitch, opts.volume, opts.voice, opts.lang, voices],
  );

  const pause = useCallback(() => {
    const runPause = logSyncDecorator("speech:tts", "pause", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) return;
      ttsLogger.info("Pausing TTS");
      synthesis.pause();
      setIsPaused(true);
    });

    runPause();
  }, []);

  const resume = useCallback(() => {
    const runResume = logSyncDecorator("speech:tts", "resume", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) return;
      ttsLogger.info("Resuming TTS");
      synthesis.resume();
      setIsPaused(false);
    });

    runResume();
  }, []);

  const stop = useCallback(() => {
    const runStop = logSyncDecorator("speech:tts", "stop", () => {
      const synthesis = getSpeechSynthesisApi();
      if (!synthesis) return;
      ttsLogger.info("Stopping TTS manually");
      synthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      setProgress(0);
    });

    runStop();
  }, []);

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

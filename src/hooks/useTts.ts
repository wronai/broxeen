import { useState, useCallback, useEffect, useRef } from "react";
import { logger } from "../lib/logger";

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

export function useTts(options: Partial<TtsOptions> = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [progress, setProgress] = useState(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const totalLenRef = useRef(0);

  const opts = { ...DEFAULT_OPTIONS, ...options };

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      logger.debug(`TTS Voices loaded: ${available.length}`);
      setVoices(available);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      logger.debug(`TTS Speaking: "${text.slice(0, 50)}..."`);
      window.speechSynthesis.cancel();
      if (!text.trim()) {
        logger.warn("TTS: Empty text provided");
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = opts.rate;
      utterance.pitch = opts.pitch;
      utterance.volume = opts.volume;
      utterance.lang = opts.lang;

      if (opts.voice) {
        const found = voices.find((v) => v.name === opts.voice);
        if (found) {
          logger.debug(`TTS using voice: ${found.name}`);
          utterance.voice = found;
        } else {
          logger.warn(`TTS voice not found: ${opts.voice}`);
        }
      } else {
        const plVoice = voices.find((v) => v.lang.startsWith("pl"));
        if (plVoice) {
          logger.debug(`TTS using default PL voice: ${plVoice.name}`);
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
        logger.debug("TTS started");
        setIsSpeaking(true);
        setIsPaused(false);
        setProgress(0);
      };
      utterance.onend = () => {
        logger.debug("TTS ended");
        setIsSpeaking(false);
        setIsPaused(false);
        setProgress(100);
      };
      utterance.onerror = (e) => {
        logger.error("TTS error:", e);
        setIsSpeaking(false);
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [opts.rate, opts.pitch, opts.volume, opts.voice, opts.lang, voices],
  );

  const pause = useCallback(() => {
    logger.debug("TTS paused");
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    logger.debug("TTS resumed");
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    logger.debug("TTS stopped manually");
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
  }, []);

  return { speak, pause, resume, stop, isSpeaking, isPaused, voices, progress };
}

import { useState, useCallback, useEffect, useRef } from "react";

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
      window.speechSynthesis.cancel();
      if (!text.trim()) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = opts.rate;
      utterance.pitch = opts.pitch;
      utterance.volume = opts.volume;
      utterance.lang = opts.lang;

      if (opts.voice) {
        const found = voices.find((v) => v.name === opts.voice);
        if (found) utterance.voice = found;
      } else {
        const plVoice = voices.find((v) => v.lang.startsWith("pl"));
        if (plVoice) utterance.voice = plVoice;
      }

      totalLenRef.current = text.length;
      utterance.onboundary = (e) => {
        if (totalLenRef.current > 0) {
          setProgress(Math.round((e.charIndex / totalLenRef.current) * 100));
        }
      };
      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
        setProgress(0);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        setProgress(100);
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [opts.rate, opts.pitch, opts.volume, opts.voice, opts.lang, voices],
  );

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis.resume();
    setIsPaused(false);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
  }, []);

  return { speak, pause, resume, stop, isSpeaking, isPaused, voices, progress };
}

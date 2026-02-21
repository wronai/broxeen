import { useState, useCallback, useRef, useEffect } from "react";
import { logger, logSyncDecorator } from "../lib/logger";

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

const speechLogger = logger.scope("speech:recognition");

export function useSpeech(lang: string = "pl-PL") {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const SpeechRecognition =
      typeof window !== "undefined"
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : undefined;
    const supported = !!SpeechRecognition;

    speechLogger.info("Speech recognition capability check", {
      supported,
      lang,
      hasSpeechRecognition:
        typeof window !== "undefined" && !!window.SpeechRecognition,
      hasWebkitSpeechRecognition:
        typeof window !== "undefined" && !!window.webkitSpeechRecognition,
    });

    if (!supported) {
      speechLogger.warn("Speech recognition is not available in this runtime");
    }

    setIsSupported(supported);
  }, [lang]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        speechLogger.debug(
          "Unmount cleanup: aborting active speech recognition instance",
        );
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const runStartListening = logSyncDecorator(
      "speech:recognition",
      "startListening",
      () => {
        const SpeechRecognition =
          typeof window !== "undefined"
            ? window.SpeechRecognition || window.webkitSpeechRecognition
            : undefined;
        if (!SpeechRecognition) {
          speechLogger.error("SpeechRecognition API not found");
          return;
        }

        if (recognitionRef.current) {
          speechLogger.warn(
            "Existing recognition instance found. Aborting before restart.",
          );
          recognitionRef.current.abort();
        }

        speechLogger.info("Starting speech recognition session", {
          lang,
          interimResults: true,
          continuous: false,
        });

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = lang;

        recognition.onstart = () => {
          speechLogger.info("Speech recognition started");
          setIsListening(true);
          setTranscript("");
          setInterimTranscript("");
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          let interim = "";
          let final_ = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final_ += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }

          if (final_) {
            speechLogger.debug("Final transcript captured", { final_ });
            setTranscript(final_);
          }

          setInterimTranscript(interim);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          speechLogger.error("Speech recognition error", { error: event.error });
          setIsListening(false);
        };

        recognition.onend = () => {
          speechLogger.info("Speech recognition ended");
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
      },
    );

    runStartListening();
  }, [lang]);

  const stopListening = useCallback(() => {
    const runStopListening = logSyncDecorator(
      "speech:recognition",
      "stopListening",
      () => {
        if (recognitionRef.current) {
          speechLogger.info("Stopping speech recognition manually");
          recognitionRef.current.stop();
        } else {
          speechLogger.debug("No active recognition instance to stop");
        }
        setIsListening(false);
      },
    );

    runStopListening();
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    isSupported,
    startListening,
    stopListening,
  };
}

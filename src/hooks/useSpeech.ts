import { useState, useCallback, useRef, useEffect } from "react";
import { logger, logSyncDecorator } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";

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
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

const speechLogger = logger.scope("speech:recognition");

const STT_UNAVAILABLE_TAURI_REASON =
  "Analiza mowy (STT) nie jest dostępna w aplikacji desktop Tauri na Linux (WebKitGTK).";
const STT_UNAVAILABLE_BROWSER_REASON =
  "Analiza mowy (STT) nie jest wspierana w tym środowisku (brak Web Speech API).";

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

function getUnsupportedReason(supported: boolean, runtimeIsTauri: boolean): string | null {
  if (supported) {
    return null;
  }

  return runtimeIsTauri ? STT_UNAVAILABLE_TAURI_REASON : STT_UNAVAILABLE_BROWSER_REASON;
}

export function useSpeech(lang: string = "pl-PL") {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    const runtimeIsTauri = isTauriRuntime();
    const SpeechRecognition = getSpeechRecognitionCtor();
    const supported = !!SpeechRecognition;
    const reason = getUnsupportedReason(supported, runtimeIsTauri);

    speechLogger.info("Speech recognition capability check", {
      supported,
      lang,
      runtime: runtimeIsTauri ? "tauri" : "browser",
      hasSpeechRecognition:
        typeof window !== "undefined" && !!window.SpeechRecognition,
      hasWebkitSpeechRecognition:
        typeof window !== "undefined" && !!window.webkitSpeechRecognition,
    });

    if (reason) {
      speechLogger.warn("Speech recognition is not available in this runtime", {
        reason,
      });
    }

    setIsSupported(supported);
    setUnsupportedReason(reason);
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
        const runtimeIsTauri = isTauriRuntime();
        const SpeechRecognition = getSpeechRecognitionCtor();
        if (!SpeechRecognition) {
          const reason = getUnsupportedReason(false, runtimeIsTauri);
          speechLogger.error("SpeechRecognition API not found", {
            runtime: runtimeIsTauri ? "tauri" : "browser",
            reason,
          });
          setIsSupported(false);
          setUnsupportedReason(reason);
          setIsListening(false);
          return;
        }

        setIsSupported(true);
        setUnsupportedReason(null);

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
          speechLogger.debug("Speech recognition result event", {
            resultIndex: event.resultIndex,
            resultsLength: event.results.length,
          });

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
            speechLogger.debug("Final transcript captured", {
              finalLength: final_.length,
            });
            setTranscript((prev) => (prev ? `${prev} ${final_}`.trim() : final_));
          }

          speechLogger.debug("Interim transcript captured", {
            interimLength: interim.length,
          });
          setInterimTranscript(interim);
        };

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
          speechLogger.error("Speech recognition error", { error: event.error });
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognition.onend = () => {
          speechLogger.info("Speech recognition ended");
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        try {
          recognition.start();
          speechLogger.debug("Speech recognition start() invoked");
        } catch (error) {
          speechLogger.error("Failed to start speech recognition", error);
          setIsListening(false);
          recognitionRef.current = null;
        }
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
    unsupportedReason,
    startListening,
    stopListening,
  };
}

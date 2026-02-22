import { useState, useRef, useEffect } from "react";
import {
  Send,
  Mic,
  MicOff,
  Loader2,
  Globe,
  Search,
  Zap,
  Copy,
  Bot,
} from "lucide-react";
import { resolve } from "../lib/resolver";
import { looksLikeUrl } from "../lib/phonetic";
import { useSpeech } from "../hooks/useSpeech";
import { useStt } from "../hooks/useStt";
import { useTts } from "../hooks/useTts";
import { useLlm } from "../hooks/useLlm";
import { useCqrs } from "../contexts/CqrsContext";
import { useChatMessages } from "../hooks/useChatMessages";
import TtsControls from "./TtsControls";
import type { AudioSettings } from "../domain/audioSettings";
import { type ChatMessage } from "../domain/chatEvents";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/llmClient";

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 0,
    role: "system",
    text: "Witaj w Broxeen! Wpisz adres strony, powiedz go głosem, lub wpisz zapytanie. Treść możesz odsłuchać przez TTS. 🎧",
  },
];

interface ChatProps {
  settings: AudioSettings;
}

export default function Chat({ settings }: ChatProps) {
  // State managed by CQRS Event Store
  const { commands, eventStore } = useCqrs();
  const messages = useChatMessages();

  const [input, setInput] = useState("");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatLogger = logger.scope("chat:ui");

  // Keep track of extracted text for LLM context.
  // We can listen to content_fetched events to update this state.
  useEffect(() => {
    const unsub = eventStore.on("content_fetched", (event) => {
      setPageContent(event.payload.content);
    });
    return unsub;
  }, [eventStore]);

  const llm = useLlm({ pageContent });
  const llmAvailable = !!getConfig().apiKey;

  // ... (speech hooks remain exactly the same)
  const {
    isListening,
    transcript,
    interimTranscript,
    isSupported: speechSupported,
    unsupportedReason: speechUnsupportedReason,
    startListening,
    stopListening,
  } = useSpeech(settings.tts_lang);

  const stt = useStt({ lang: settings.tts_lang });

  const tts = useTts({
    rate: settings.tts_rate,
    pitch: settings.tts_pitch,
    volume: settings.tts_volume,
    voice: settings.tts_voice,
    lang: settings.tts_lang,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (transcript && !isListening) {
      chatLogger.info("Applying finalized speech transcript", {
        transcriptLength: transcript.length,
      });
      handleSubmit(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isListening]);

  useEffect(() => {
    if (stt.transcript && !stt.isRecording && !stt.isTranscribing) {
      chatLogger.info("Applying finalized cloud STT transcript", {
        transcriptLength: stt.transcript.length,
      });
      handleSubmit(stt.transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.transcript, stt.isRecording, stt.isTranscribing]);

  useEffect(() => {
    if (!settings.mic_enabled) {
      return;
    }

    if (!speechSupported && speechUnsupportedReason) {
      chatLogger.warn("Native STT (Web Speech API) is unavailable", {
        reason: speechUnsupportedReason,
        cloudFallbackSupported: stt.isSupported,
      });
    }

    if (!speechSupported && !stt.isSupported && stt.unsupportedReason) {
      chatLogger.warn("Cloud STT fallback is also unavailable", {
        reason: stt.unsupportedReason,
      });
    }
  }, [
    settings.mic_enabled,
    speechSupported,
    speechUnsupportedReason,
    stt.isSupported,
    stt.unsupportedReason,
  ]);

  useEffect(() => {
    if (settings.tts_enabled && !tts.isSupported && tts.unsupportedReason) {
      chatLogger.warn(
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
        chatLogger.info(
          "Summary generated, TTS will be triggered by message_updated",
        );
      }
    });

    return unsub;
  }, [eventStore, settings.tts_enabled, chatLogger]);

  const previousLoadingWaitIdsRef = useRef(new Set<number>());

  // Listen for TTS triggers from Message Updated (for LLM general responses)
  useEffect(() => {
    if (!settings.tts_enabled) return;

    const unsub = eventStore.on("message_updated", (event) => {
      const { id, updates } = event.payload;
      // If a message finishes loading and has text, and we were tracking it
      if (
        updates.loading === false &&
        updates.text &&
        previousLoadingWaitIdsRef.current.has(id)
      ) {
        previousLoadingWaitIdsRef.current.delete(id);
        chatLogger.info("TTS auto-read triggered by message load complete");
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
  }, [eventStore, settings.tts_enabled, tts, chatLogger]);

  const handleSubmit = async (text?: string) => {
    const query = (text || input).trim();
    if (!query) {
      chatLogger.debug("Ignoring empty submit");
      return;
    }

    // Save to history
    if (inputHistoryRef.current[inputHistoryRef.current.length - 1] !== query) {
      inputHistoryRef.current.push(query);
    }
    historyIndexRef.current = -1; // Reset index

    setInput("");
    chatLogger.info("Handling submit", { queryLength: query.length });

    // Emit user message directly to store since commands assume loading state
    // In a pure CQRS world this might be a SendUserMessageCommand, but direct event is fine for UI interaction
    eventStore.append({
      type: "message_added",
      payload: { id: Date.now(), role: "user", text: query },
    });

    const result = resolve(query);
    chatLogger.info("Query resolved", {
      resolveType: result.resolveType,
      needsClarification: result.needsClarification,
      hasUrl: !!result.url,
      suggestionsCount: result.suggestions.length,
    });

    if (result.needsClarification) {
      eventStore.append({
        type: "message_added",
        payload: {
          id: Date.now(),
          role: "assistant",
          text: "Czy chodziło Ci o jedną z tych stron?",
          suggestions: result.suggestions,
          resolveType: result.resolveType,
        },
      });
      return;
    }

    if (!result.url) {
      // If LLM is available and we have page content or it's a general question, route to LLM
      if (llmAvailable && !looksLikeUrl(query)) {
        chatLogger.info("No URL resolved, routing to LLM Q&A", {
          hasPageContent: !!pageContent,
        });
        await handleLlmQuestion(query);
        return;
      }
      chatLogger.warn(
        "Resolution returned no URL and no clarification request",
      );
      return;
    }

    // Execute CQRS Browse Command
    await commands.browse.execute({
      query: query,
      resolvedUrl: result.url,
      resolveType: result.resolveType,
    });
  };

  const handleLlmQuestion = async (question: string) => {
    await commands.sendMessage.execute(question, pageContent);
  };

  const handleSuggestionClick = (url: string) => {
    setInput("");
    handleSubmit(url);
  };

  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const history = inputHistoryRef.current;
      if (history.length > 0) {
        // Move index backwards (older)
        const nextIndex =
          historyIndexRef.current === -1
            ? history.length - 1
            : Math.max(0, historyIndexRef.current - 1);

        historyIndexRef.current = nextIndex;
        setInput(history[nextIndex]);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const history = inputHistoryRef.current;
      if (historyIndexRef.current !== -1) {
        // Move index forwards (newer)
        const nextIndex = historyIndexRef.current + 1;
        if (nextIndex >= history.length) {
          // Reached the end, clear input
          historyIndexRef.current = -1;
          setInput("");
        } else {
          historyIndexRef.current = nextIndex;
          setInput(history[nextIndex]);
        }
      }
      return;
    }
  };

  const toggleMic = () => {
    if (speechSupported) {
      if (isListening) {
        chatLogger.info("Microphone toggle -> stop listening (native)");
        stopListening();
      } else {
        chatLogger.info("Microphone toggle -> start listening (native)");
        startListening();
      }
      return;
    }

    if (!stt.isSupported) {
      chatLogger.warn("Microphone pressed but cloud STT is unsupported", {
        reason: stt.unsupportedReason,
      });
      return;
    }

    if (stt.isRecording) {
      chatLogger.info("Microphone toggle -> stop recording (cloud STT)");
      stt.stopRecording();
      return;
    }

    chatLogger.info("Microphone toggle -> start recording (cloud STT)");
    stt.startRecording();
  };

  const resolveIcon = (type?: string) => {
    switch (type) {
      case "exact":
        return <Globe size={14} className="text-green-400" />;
      case "fuzzy":
        return <Zap size={14} className="text-yellow-400" />;
      case "search":
        return <Search size={14} className="text-blue-400" />;
      default:
        return null;
    }
  };

  const copyChatContent = () => {
    chatLogger.debug("Preparing chat transcript copy");
    const chatContent = messages
      .filter((msg) => msg.role !== "system")
      .map((msg) => {
        const role = msg.role === "user" ? "Użytkownik:" : "Asystent:";
        let content = `${role}\n${msg.text}`;
        if (msg.url) {
          content += `\nURL: ${msg.url}`;
        }
        return content;
      })
      .join("\n\n---\n\n");

    navigator.clipboard
      .writeText(chatContent)
      .then(() => {
        chatLogger.info("Chat content copied to clipboard", {
          characters: chatContent.length,
        });
      })
      .catch((err) => {
        chatLogger.error("Failed to copy chat content", err);
      });
  };

  const copyMessageContext = async (msg: ChatMessage) => {
    await commands.copyContext.execute(msg.id);
  };

  return (
    <>
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-h-full max-w-full">
            <button
              className="absolute -top-10 right-0 p-2 text-white hover:text-gray-300"
              onClick={() => setExpandedImage(null)}
            >
              Zamknij (ESC)
            </button>
            <img
              src={`data:image/png;base64,${expandedImage}`}
              alt="Screenshot strony"
              className="max-h-[90vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl">
            {/* Header with copy button */}
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-200">Czat</h2>
              <button
                onClick={copyChatContent}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
                title="Kopiuj zawartość czatu"
              >
                <Copy size={16} />
                <span>Kopiuj</span>
              </button>
            </div>

            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="flex mt-20 flex-col items-center justify-center text-center fade-in">
                  <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-broxeen-400 to-emerald-400 sm:text-5xl">
                    Witaj w Broxeen
                  </h1>
                  <p className="max-w-xl text-lg text-gray-400">
                    Wpisz adres URL, zapytaj o coś lub kliknij ikonę mikrofonu,
                    aby zacząć.
                  </p>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-broxeen-600 text-white cursor-pointer transition-colors hover:bg-broxeen-500"
                        : msg.role === "system"
                          ? "bg-gray-800/50 text-gray-300"
                          : "bg-gray-800 text-gray-100"
                    }`}
                    onClick={
                      msg.role === "user"
                        ? () => handleSubmit(msg.text)
                        : undefined
                    }
                    title={
                      msg.role === "user"
                        ? "Kliknij, aby ponowić to zapytanie"
                        : undefined
                    }
                  >
                    {msg.url && (
                      <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                        {resolveIcon(msg.resolveType)}
                        <span className="truncate">{msg.url}</span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4">
                      {msg.role === "assistant" && msg.screenshotBase64 && (
                        <div className="shrink-0 max-w-[256px] max-h-[300px] overflow-y-auto rounded-lg border border-gray-700 bg-black/50 scrollbar-thin scrollbar-thumb-gray-600">
                          <img
                            src={`data:image/png;base64,${msg.screenshotBase64}`}
                            alt="Screenshot strony"
                            className="w-full h-auto object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 w-full min-w-0">
                        {msg.loading ? (
                          <div className="flex items-center gap-2 text-gray-400">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{msg.text}</span>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap text-sm leading-relaxed">
                            {msg.pageTitle && (
                              <div className="font-bold mb-2">
                                {msg.pageTitle}
                              </div>
                            )}
                            {msg.text}
                          </div>
                        )}

                        {/* Action links */}
                        {msg.role === "assistant" &&
                          !msg.loading &&
                          (msg.rssUrl || msg.contactUrl || msg.phoneUrl) && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {msg.rssUrl && (
                                <a
                                  href={
                                    msg.rssUrl.startsWith("http")
                                      ? msg.rssUrl
                                      : msg.url
                                        ? new URL(msg.rssUrl, msg.url).href
                                        : msg.rssUrl
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1.5 rounded-lg bg-orange-600/20 px-3 py-1.5 text-xs font-medium text-orange-400 hover:bg-orange-600/30 transition"
                                >
                                  📰 Kanał RSS
                                </a>
                              )}
                              {msg.contactUrl && (
                                <a
                                  href={
                                    msg.contactUrl.startsWith("http") ||
                                    msg.contactUrl.startsWith("mailto:")
                                      ? msg.contactUrl
                                      : msg.url
                                        ? new URL(msg.contactUrl, msg.url).href
                                        : msg.contactUrl
                                  }
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-600/30 transition"
                                >
                                  ✉️ Napisz wiadomość
                                </a>
                              )}
                              {msg.phoneUrl && (
                                <a
                                  href={
                                    msg.phoneUrl.startsWith("tel:")
                                      ? msg.phoneUrl
                                      : `tel:${msg.phoneUrl}`
                                  }
                                  className="flex items-center gap-1.5 rounded-lg bg-green-600/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-600/30 transition"
                                >
                                  📞 Zadzwoń
                                </a>
                              )}
                            </div>
                          )}

                        {msg.suggestions && msg.suggestions.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {msg.suggestions.map((s) => (
                              <button
                                key={s}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSuggestionClick(s);
                                }}
                                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-broxeen-300 transition hover:bg-gray-600"
                              >
                                {s.replace("https://", "")}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {msg.role === "assistant" &&
                      !msg.loading &&
                      msg.text.length > 50 && (
                        <div className="mt-3 flex items-center gap-2 border-t border-gray-700/50 pt-2">
                          <TtsControls
                            isSpeaking={tts.isSpeaking}
                            isPaused={tts.isPaused}
                            progress={tts.progress}
                            onSpeak={() => tts.speak(msg.text.slice(0, 3000))}
                            onPause={tts.pause}
                            onResume={tts.resume}
                            onStop={tts.stop}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyMessageContext(msg);
                            }}
                            className="ml-auto rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-700 hover:text-gray-300"
                            title="Kopiuj tę interakcję"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t border-gray-800 bg-gray-900/80 px-4 py-4 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-3">
              {settings.mic_enabled && (speechSupported || stt.isSupported) && (
                <button
                  onClick={toggleMic}
                  className={`rounded-xl p-2.5 transition ${
                    isListening || stt.isRecording
                      ? "animate-pulse bg-red-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                  }`}
                  title={
                    isListening || stt.isRecording
                      ? "Zatrzymaj"
                      : speechSupported
                        ? "Mów (mikrofon)"
                        : "Mów (STT w chmurze)"
                  }
                >
                  {isListening || stt.isRecording ? (
                    <MicOff size={20} />
                  ) : (
                    <Mic size={20} />
                  )}
                </button>
              )}

              <div className="relative flex-1">
                <input
                  type="text"
                  value={
                    isListening
                      ? interimTranscript || "Słucham..."
                      : stt.isRecording
                        ? "Nagrywam..."
                        : stt.isTranscribing
                          ? "Transkrybuję..."
                          : input
                  }
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Wpisz adres, zapytanie lub powiedz głosem..."
                  disabled={
                    isListening || stt.isRecording || stt.isTranscribing
                  }
                  className="w-full rounded-xl bg-gray-800 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700 transition focus:ring-broxeen-500 disabled:opacity-50"
                />
                <button
                  onClick={() => handleSubmit()}
                  disabled={
                    isListening ||
                    stt.isRecording ||
                    stt.isTranscribing ||
                    !input.trim()
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 transition hover:text-broxeen-400 disabled:opacity-30"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>

            {settings.mic_enabled &&
              !speechSupported &&
              speechUnsupportedReason &&
              !stt.isSupported && (
                <p className="mt-2 text-xs text-amber-300">
                  ℹ️ {speechUnsupportedReason}
                </p>
              )}

            {settings.mic_enabled && !speechSupported && stt.isSupported && (
              <p className="mt-2 text-xs text-amber-300">
                ℹ️ STT w tym runtime używa transkrypcji w chmurze (OpenRouter).
              </p>
            )}

            {settings.mic_enabled && !speechSupported && stt.error && (
              <p className="mt-2 text-xs text-amber-300">
                ℹ️ Błąd STT: {stt.error}
              </p>
            )}

            {settings.tts_enabled &&
              !tts.isSupported &&
              tts.unsupportedReason && (
                <p className="mt-1 text-xs text-amber-300">
                  ℹ️ {tts.unsupportedReason}
                </p>
              )}
          </div>
        </div>
      </div>
    </>
  );
}

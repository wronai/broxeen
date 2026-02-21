import { useState, useRef, useEffect } from "react";
import { Send, Mic, MicOff, Loader2, Globe, Search, Zap, Copy } from "lucide-react";
import { resolve } from "../lib/resolver";
import { useSpeech } from "../hooks/useSpeech";
import { useTts } from "../hooks/useTts";
import TtsControls from "./TtsControls";
import type { AudioSettings } from "../domain/audioSettings";
import {
  projectChatMessages,
  type ChatEvent,
  type ChatMessage,
} from "../domain/chatEvents";
import { executeBrowseCommand } from "../lib/browseGateway";
import { logger } from "../lib/logger";

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
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const nextIdRef = useRef(1);
  const eventsRef = useRef<ChatEvent[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    isListening,
    transcript,
    interimTranscript,
    isSupported: speechSupported,
    startListening,
    stopListening,
  } = useSpeech(settings.tts_lang);

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
      handleSubmit(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isListening]);

  const applyEvent = (event: ChatEvent) => {
    eventsRef.current.push(event);
    setMessages((prev) => projectChatMessages(prev, event));
  };

  const addMessage = (msg: Omit<ChatMessage, "id">) => {
    const id = nextIdRef.current++;
    applyEvent({
      type: "message_added",
      payload: { ...msg, id },
    });
    return id;
  };

  const updateMessage = (id: number, updates: Partial<ChatMessage>) => {
    applyEvent({
      type: "message_updated",
      payload: { id, updates },
    });
  };

  const handleSubmit = async (text?: string) => {
    const query = (text || input).trim();
    if (!query) return;
    setInput("");

    logger.debug(`Handling submit: "${query}"`);
    addMessage({ role: "user", text: query });

    const result = resolve(query);
    logger.debug("Resolution result:", result);

    if (result.needsClarification) {
      addMessage({
        role: "assistant",
        text: "Czy chodziło Ci o jedną z tych stron?",
        suggestions: result.suggestions,
        resolveType: result.resolveType,
      });
      return;
    }

    if (!result.url) return;

    const loadingId = nextIdRef.current++;
    const resolvedUrl = result.url;
    applyEvent({
      type: "message_added",
      payload: {
        id: loadingId,
        role: "assistant",
        text: `Pobieram: ${resolvedUrl}...`,
        url: resolvedUrl,
        resolveType: result.resolveType,
        loading: true,
      },
    });

    try {
      const browseResult = await executeBrowseCommand(resolvedUrl);

      logger.debug("Browse result received:", {
        url: browseResult.url,
        title: browseResult.title,
        contentLength: browseResult.content.length,
      });

      updateMessage(loadingId, {
        text: browseResult.content.slice(0, 5000),
        url: browseResult.url,
        loading: false,
      });

      if (settings.tts_enabled) {
        logger.debug("TTS is enabled, starting speech...");
        const toRead = browseResult.content.slice(0, 3000);
        tts.speak(toRead);
      }
    } catch (err) {
      logger.error("Browse failed:", err);
      updateMessage(loadingId, {
        text: `Nie udało się pobrać strony: ${err}`,
        loading: false,
      });
    }
  };

  const handleSuggestionClick = (url: string) => {
    setInput("");
    addMessage({ role: "user", text: url });
    handleSubmit(url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleMic = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
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
    const chatContent = messages
      .filter(msg => msg.role !== "system")
      .map(msg => {
        const role = msg.role === "user" ? "Użytkownik:" : "Asystent:";
        let content = `${role}\n${msg.text}`;
        if (msg.url) {
          content += `\nURL: ${msg.url}`;
        }
        return content;
      })
      .join("\n\n---\n\n");
    
    navigator.clipboard.writeText(chatContent).then(() => {
      // Optional: Add toast notification here
      logger.info("Chat content copied to clipboard");
    }).catch(err => {
      logger.error("Failed to copy chat content:", err);
    });
  };

  return (
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
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-broxeen-600 text-white"
                    : msg.role === "system"
                      ? "bg-gray-800/50 text-gray-300"
                      : "bg-gray-800 text-gray-100"
                }`}
              >
                {msg.url && (
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                    {resolveIcon(msg.resolveType)}
                    <span className="truncate">{msg.url}</span>
                  </div>
                )}

                {msg.loading ? (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span>{msg.text}</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {msg.text}
                  </div>
                )}

                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {msg.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSuggestionClick(s)}
                        className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-broxeen-300 transition hover:bg-gray-600"
                      >
                        {s.replace("https://", "")}
                      </button>
                    ))}
                  </div>
                )}

                {msg.role === "assistant" && !msg.loading && msg.text.length > 50 && (
                  <div className="mt-3 border-t border-gray-700/50 pt-2">
                    <TtsControls
                      isSpeaking={tts.isSpeaking}
                      isPaused={tts.isPaused}
                      progress={tts.progress}
                      onSpeak={() => tts.speak(msg.text.slice(0, 3000))}
                      onPause={tts.pause}
                      onResume={tts.resume}
                      onStop={tts.stop}
                    />
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
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {speechSupported && settings.mic_enabled && (
            <button
              onClick={toggleMic}
              className={`rounded-xl p-2.5 transition ${
                isListening
                  ? "animate-pulse bg-red-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
              title={isListening ? "Zatrzymaj słuchanie" : "Mów (mikrofon)"}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          )}

          <div className="relative flex-1">
            <input
              type="text"
              value={isListening ? interimTranscript || "Słucham..." : input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Wpisz adres, zapytanie lub powiedz głosem..."
              disabled={isListening}
              className="w-full rounded-xl bg-gray-800 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700 transition focus:ring-broxeen-500 disabled:opacity-50"
            />
            <button
              onClick={() => handleSubmit()}
              disabled={isListening || !input.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 transition hover:text-broxeen-400 disabled:opacity-30"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

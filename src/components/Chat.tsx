import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useLlm } from "../hooks/useLlm";
import { useCqrs } from "../contexts/CqrsContext";
import { useChatMessages } from "../hooks/useChatMessages";
import { usePlugins } from "../contexts/pluginContext";
import { type NetworkConfig } from "./NetworkSelector";
import type { NetworkHistoryItem } from "./NetworkHistorySelector";
import { type CameraPreviewProps } from "./CameraPreview";
import { ChatOverlays, type ExpandedImageData, type ExpandedLiveData } from "./ChatOverlays";
import type { AudioSettings } from "../domain/audioSettings";
import { type ChatMessage } from "../domain/chatEvents";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/llmClient";
import { configStore } from "../config/configStore";
import { runAutoConfig } from "../config/autoConfig";
import { useDatabaseManager } from "../hooks/useDatabaseManager";
import { useHistoryPersistence } from "../hooks/useHistoryPersistence";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput, type QueryScope } from "./ChatInput";
import { useChatDispatch } from "../hooks/useChatDispatch";
import { useChatSpeech } from "../hooks/useChatSpeech";

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
  const { ask } = usePlugins();
  const dbManager = useDatabaseManager();
  const { addToCommandHistory, addToNetworkHistory } = useHistoryPersistence(dbManager);

  // Initialize welcome message if EventStore is empty (only in production, not tests)
  useEffect(() => {
    if (messages.length === 0 && process.env.NODE_ENV !== 'test') {
      eventStore.append({
        type: "message_added",
        payload: INITIAL_MESSAGES[0],
      });
    }
  }, [messages.length, eventStore]);

  const [input, setInput] = useState("");
  const [expandedImage, setExpandedImage] = useState<ExpandedImageData | null>(null);
  const [expandedLive, setExpandedLive] = useState<ExpandedLiveData | null>(null);
  const [pageContent, setPageContent] = useState<string>("");
  const [showNetworkSelector, setShowNetworkSelector] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkConfig | null>(null);
  const [pendingNetworkQuery, setPendingNetworkQuery] = useState<string>("");
  const [showCommandHistory, setShowCommandHistory] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);

  const hasNonSystemMessages = useMemo(
    () => messages.some((m) => m.role !== "system"),
    [messages],
  );

  const showWelcomeScreen = useMemo(() => {
    // Show welcome screen only for the initial state (single system message).
    // Ignore status notices (id >= 1000000) when checking message count.
    const userMessages = messages.filter(m => m.id < 1000000);
    return userMessages.length === 1 && userMessages[0]?.role === "system";
  }, [messages]);
  const [discoveredCameras, setDiscoveredCameras] = useState<CameraPreviewProps['camera'][]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraPreviewProps['camera'] | null>(null);
  const [currentScope, setCurrentScope] = useState<QueryScope>('local');
  const currentScopeRef = useRef<QueryScope>('local');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const statusNoticeRef = useRef<Record<string, string>>({});
  const statusNoticeIdRef = useRef(1000000);
  const messageIdRef = useRef<number>(Date.now());
  const chatLogger = logger.scope("chat:ui");

  const nextMessageId = () => {
    messageIdRef.current += 1;
    return messageIdRef.current;
  };

  // Get recent user queries for suggestions
  const getRecentQueries = () => {
    return messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.text)
      .slice(-5);
  };

  // Get current context for suggestions
  const getCurrentContext = () => {
    const hour = new Date().getHours();
    let timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    if (hour >= 5 && hour < 12) timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 22) timeOfDay = 'evening';
    else timeOfDay = 'night';

    // Get last category from recent queries
    const lastQuery = getRecentQueries()[0] || '';
    let lastCategory: string | undefined;
    if (lastQuery.includes('kamer')) lastCategory = 'camera';
    else if (lastQuery.includes('sieci') || lastQuery.includes('network')) lastCategory = 'network';
    else if (lastQuery.includes('.pl') || lastQuery.includes('.com')) lastCategory = 'browse';
    else if (lastQuery.includes('wyszukaj')) lastCategory = 'search';

    return {
      timeOfDay,
      lastCategory,
      deviceCount: discoveredCameras.length,
      hasActiveCameras: discoveredCameras.length > 0,
      isNetworkAvailable: selectedNetwork !== null
    };
  };

  // Handle suggestion learning
  const handleSuggestionLearning = (query: string, category: string, success: boolean) => {
    chatLogger.info('Suggestion learning', { query, category, success });
    // This could be extended to send learning data to backend
  };

  // Auto-watch integration
  useEffect(() => {
    // Listen for new messages and trigger auto-watch logic
    const unsub = eventStore.on("message_added", async (event) => {
      const message = event.payload;

      // Integrate with AutoWatchIntegration for user messages
      if (message.role === 'user') {
        chatLogger.info('User message for auto-watch analysis:', {
          text: message.text,
          timestamp: new Date().toISOString()
        });

        // TODO: Initialize and integrate AutoWatchIntegration
        // const autoWatchIntegration = new AutoWatchIntegration(watchManager, dbManager, autoWatchConfig);
        // await autoWatchIntegration.processMessage(message);
      }
    });

    return unsub;
  }, [eventStore, chatLogger]);

  // Keep track of extracted text for LLM context.
  // We can listen to content_fetched events to update this state.
  useEffect(() => {
    const unsub = eventStore.on("content_fetched", (event) => {
      setPageContent(event.payload.content);
    });
    return unsub;
  }, [eventStore]);

  // Auto-config detection — show interactive setup prompt on first load
  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    let cancelled = false;
    runAutoConfig().then((result) => {
      if (cancelled) return;
      chatLogger.info('Auto-config result', {
        needsSetup: result.needsSetup,
        capabilities: result.capabilities,
      });

      // Show the auto-config message as the first assistant message
      eventStore.append({
        type: "message_added",
        payload: {
          id: nextMessageId(),
          role: "assistant",
          text: result.messageText,
          type: result.prompt ? "config_prompt" : "content",
          configPrompt: result.prompt,
        },
      });
    }).catch((err) => {
      chatLogger.error('Auto-config failed', err);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const llm = useLlm({ pageContent });
  const llmAvailable = !!getConfig().apiKey;

  // Helper to append status notices to chat
  const appendStatusNotice = useCallback((key: string, text: string) => {
    const prev = statusNoticeRef.current[key];
    if (prev === text) return;

    statusNoticeRef.current[key] = text;
    statusNoticeIdRef.current += 1;
    eventStore.append({
      type: "message_added",
      payload: {
        id: statusNoticeIdRef.current,
        role: "system",
        text,
      },
    });
  }, [eventStore]);

  // Ref to break circular dep: useChatSpeech needs handleSubmit, useChatDispatch needs speech outputs
  const handleSubmitRef = useRef<(text: string) => void>(() => {});

  // ── Speech / STT / TTS / Wake Word ──
  const {
    isListening,
    speechSupported,
    stt,
    tts,
    micPhase,
    toggleMic,
  } = useChatSpeech({
    settings,
    eventStore,
    wakeWordEnabled,
    setWakeWordEnabled,
    setInput,
    onTranscriptReady: (text) => handleSubmitRef.current(text),
    appendStatusNotice,
  });

  // ── Dispatch hook (handleSubmit + related handlers) ──
  const dispatch = useChatDispatch({
    eventStore,
    ask,
    settings,
    tts,
    isListening,
    sttIsRecording: stt.isRecording,
    currentScope,
    input,
    pendingNetworkQuery,
    discoveredCameras,
    nextMessageId,
    addToCommandHistory,
    setInput,
    setShowCommandHistory,
    setExpandedLive,
    setSelectedNetwork,
    setShowNetworkSelector,
    setPendingNetworkQuery,
    setSelectedCamera,
  });

  const {
    handleSubmit,
    handleCommandHistorySelect,
    handleSuggestionClick,
    handleNetworkOptionClick,
    handleCameraSelect,
    handleCameraAnalysisComplete,
    handleCameraStreamStart,
  } = dispatch;

  // Wire up the ref now that handleSubmit is available
  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    currentScopeRef.current = currentScope;
  }, [currentScope]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{
        mode: "prefill" | "execute" | "execute_silent";
        text: string;
      }>;
      const detail = custom.detail;
      if (!detail?.text) return;

      if (detail.mode === "prefill") {
        setInput(detail.text);
        setTimeout(() => {
          const inputElement = document.querySelector(
            "input[type='text']",
          ) as HTMLInputElement | null;
          if (inputElement) {
            inputElement.focus();
            inputElement.selectionStart = inputElement.selectionEnd = detail.text.length;
          }
        }, 0);
        return;
      }

      if (detail.mode === "execute_silent") {
        void ask(detail.text, "text", currentScopeRef.current).catch(() => undefined);
        return;
      }

      void handleSubmit(detail.text);
    };

    window.addEventListener("broxeen:chat_action", handler);
    return () => window.removeEventListener("broxeen:chat_action", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<{
        targetId: string;
        targetName: string;
        targetType: string;
        timestamp: number;
        changeScore: number;
        summary: string;
        thumbnailBase64?: string;
        thumbnailMimeType?: string;
      }>;

      const detail = custom.detail;
      if (!detail?.summary) return;

      console.log('[Chat] Received monitor_change event:', {
        targetName: detail.targetName,
        changeScore: detail.changeScore,
        hasThumbnail: !!detail.thumbnailBase64,
        thumbnailSize: detail.thumbnailBase64?.length || 0,
        mimeType: detail.thumbnailMimeType
      });

      const pct = Math.round(detail.changeScore * 100);
      const eventTime = new Date(detail.timestamp).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const mime = detail.thumbnailMimeType || "image/jpeg";
      const dataUrl = detail.thumbnailBase64
        ? `data:${mime};base64,${detail.thumbnailBase64}`
        : null;

      console.log('[Chat] Data URL created:', dataUrl ? `YES (${dataUrl.length} chars)` : 'NO');

      const monitoringText = [
        `👁️ **Monitoring**: **${detail.targetName}** (${pct}%) — 🕐 ${eventTime}`,
        dataUrl ? `\n\n![](${dataUrl})` : "",
        `\n\n${detail.summary}`,
      ].join("");

      console.log('[Chat] Monitoring message length:', monitoringText.length);

      // Single message: header + optional embedded thumbnail + one-sentence summary
      eventStore.append({
        type: "message_added",
        payload: {
          id: nextMessageId(),
          role: "assistant",
          text: monitoringText,
          type: "content",
          timestamp: detail.timestamp,
        },
      });

      if (settings.tts_enabled) {
        tts.speak(detail.summary.slice(0, 3000));
      }
    };

    window.addEventListener("broxeen:monitor_change", handler);
    return () => {
      window.removeEventListener("broxeen:monitor_change", handler);
    };
  }, [eventStore, settings.tts_enabled, tts]);



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

  // Welcome screen quick-action cards (same order as rendered)
  const welcomeCards = [
    { query: 'skanuj sieć', prefill: '' },
    { query: 'znajdź kamery w sieci', prefill: '' },
    { query: '', prefill: 'przeglądaj ' },
    { query: '', prefill: 'znajdź pliki ' },
    { query: 'konfiguruj email', prefill: '' },
    { query: 'konfiguracja', prefill: '' },
    { query: '', prefill: 'monitoruj ' },
    { query: 'pomoc', prefill: '' },
  ];

  // Handle ESC key to close expanded image + Ctrl+1..8 for welcome screen shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expandedImage) {
        setExpandedImage(null);
      }
      if (event.key === 'Escape' && expandedLive) {
        setExpandedLive(null);
      }

      // Ctrl+1..8 → trigger welcome screen card (only when welcome screen is visible)
      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        const num = parseInt(event.key, 10);
        if (num >= 1 && num <= 8 && showWelcomeScreen) {
          const card = welcomeCards[num - 1];
          if (card) {
            event.preventDefault();
            if (card.query) {
              handleSubmit(card.query);
            } else if (card.prefill) {
              setInput(card.prefill);
            }
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedImage, expandedLive, showWelcomeScreen]);

  return (
    <>
      <ChatOverlays
        expandedImage={expandedImage}
        expandedLive={expandedLive}
        onCloseImage={() => setExpandedImage(null)}
        onCloseLive={() => setExpandedLive(null)}
      />

      <div className="flex h-full flex-col">
        {/* Chat messages area */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-transparent via-gray-950/50 to-transparent">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <ChatMessageList
              messages={messages}
              showWelcomeScreen={showWelcomeScreen}
              showCommandHistory={showCommandHistory}
              hasNonSystemMessages={hasNonSystemMessages}
              selectedCamera={selectedCamera}
              tts={tts}
              settingsTtsEnabled={settings.tts_enabled}
              messagesEndRef={messagesEndRef}
              onSubmit={handleSubmit}
              onSetInput={setInput}
              onExpandImage={setExpandedImage}
              onExpandLive={setExpandedLive}
              onCommandHistorySelect={handleCommandHistorySelect}
              onSuggestionClick={handleSuggestionClick}
              onNetworkOptionClick={handleNetworkOptionClick}
              onCameraSelect={handleCameraSelect}
              onCameraAnalysisComplete={handleCameraAnalysisComplete}
              onCopyMessageContext={copyMessageContext}
              onSuggestionLearning={handleSuggestionLearning}
              onShowCommandHistory={setShowCommandHistory}
              getRecentQueries={getRecentQueries}
              getCurrentContext={getCurrentContext}
            />
          </div>
        </div>

        <ChatInput
          input={input}
          onInputChange={setInput}
          onSubmit={handleSubmit}
          settings={settings}
          currentScope={currentScope}
          onScopeChange={setCurrentScope}
          isListening={isListening}
          stt={stt}
          speechSupported={speechSupported}
          wakeWordEnabled={wakeWordEnabled}
          onWakeWordToggle={setWakeWordEnabled}
          micPhase={micPhase}
          toggleMic={toggleMic}
          selectedNetwork={selectedNetwork}
          hasNonSystemMessages={hasNonSystemMessages}
          getRecentQueries={getRecentQueries}
        />
      </div>
    </>
  );
}

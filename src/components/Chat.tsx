import { useState, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
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
  Wifi,
  ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { resolve } from "../lib/resolver";
import { looksLikeUrl } from "../lib/phonetic";
import { useSpeech } from "../hooks/useSpeech";
import { useStt } from "../hooks/useStt";
import { useTts } from "../hooks/useTts";
import { useLlm } from "../hooks/useLlm";
import { useCqrs } from "../contexts/CqrsContext";
import { useChatMessages } from "../hooks/useChatMessages";
import { usePlugins } from "../contexts/pluginContext";
import TtsControls from "./TtsControls";
import { WatchBadge } from "./WatchBadge.simple";
import { NetworkSelector, type NetworkConfig, type NetworkScope } from "./NetworkSelector";
import type { NetworkHistoryItem } from "./NetworkHistorySelector";
import { CommandHistory, type CommandHistoryItem } from "./CommandHistory";
import { QuickCommandHistory } from "./QuickCommandHistory";
import { CameraPreview, type CameraPreviewProps } from "./CameraPreview";
import { CameraLiveInline } from "./CameraLiveInline";
import { ActionSuggestions } from "./ActionSuggestions";
import { QuickCommands } from "./QuickCommands";
import { ChatConfigPrompt, buildApiKeyPrompt, buildConfigOverviewPrompt, buildMonitorConfigPrompt, buildNetworkConfigPrompt, buildModelSelectionPrompt } from "./ChatConfigPrompt";
import type { ConfigPromptData } from "./ChatConfigPrompt";
import { processRegistry } from "../core/processRegistry";
import type { AudioSettings } from "../domain/audioSettings";
import { type ChatMessage } from "../domain/chatEvents";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/llmClient";
import { configStore } from "../config/configStore";
import { runAutoConfig } from "../config/autoConfig";
import { errorReporting, capturePluginError, captureNetworkError } from "../utils/errorReporting";
import { useDatabaseManager } from "../hooks/useDatabaseManager";
import { useHistoryPersistence } from "../hooks/useHistoryPersistence";
import { isTauriRuntime } from "../lib/runtime";
import { MessageQuickActions } from "./MessageQuickActions";
import { MessageResultCard } from "./MessageResultCard";
import { ThinkingMessage } from "./ThinkingMessage";
import { FileResultsDisplay } from "./FileResultsDisplay";

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

type QueryScope = 'local' | 'internet' | 'tor' | 'vpn';

interface ScopeOption {
  id: QueryScope;
  name: string;
  icon: React.ReactNode;
  description: string;
}

export default function Chat({ settings }: ChatProps) {
  // State managed by CQRS Event Store
  const { commands, eventStore } = useCqrs();
  const messages = useChatMessages();
  const { ask } = usePlugins();
  const dbManager = useDatabaseManager();
  const { addToCommandHistory, addToNetworkHistory } = useHistoryPersistence(dbManager);

  const [input, setInput] = useState("");
  const [expandedImage, setExpandedImage] = useState<{ data: string; mimeType?: string } | null>(null);
  const [expandedLive, setExpandedLive] = useState<{ url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string } | null>(null);
  const [pageContent, setPageContent] = useState<string>("");
  const [showNetworkSelector, setShowNetworkSelector] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkConfig | null>(null);
  const [pendingNetworkQuery, setPendingNetworkQuery] = useState<string>("");
  const [showCommandHistory, setShowCommandHistory] = useState(false);

  const hasNonSystemMessages = useMemo(
    () => messages.some((m) => m.role !== "system"),
    [messages],
  );

  const showWelcomeScreen = useMemo(() => {
    // Show welcome screen only for the initial state (single system message).
    // If any additional system notices are appended (e.g. STT fallback), render normal chat view.
    return messages.length === 1 && messages[0]?.role === "system";
  }, [messages]);
  const [inputFocused, setInputFocused] = useState(false);
  const [showQuickHistory, setShowQuickHistory] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteActiveIndex, setAutocompleteActiveIndex] = useState(0);
  const [discoveredCameras, setDiscoveredCameras] = useState<CameraPreviewProps['camera'][]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraPreviewProps['camera'] | null>(null);
  const [currentScope, setCurrentScope] = useState<QueryScope>('local');
  const currentScopeRef = useRef<QueryScope>('local');
  const [showScopeSelector, setShowScopeSelector] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSpeechSubmitRef = useRef<string>("");
  const sttAutoListenTimerRef = useRef<number | null>(null);
  const sttAutoListenStartedAtRef = useRef<number | null>(null);
  const sttAutoListenSilenceHitsRef = useRef<number>(0);
  const statusNoticeRef = useRef<Record<string, string>>({});
  const statusNoticeIdRef = useRef(1000000);
  const messageIdRef = useRef<number>(Date.now());
  const chatLogger = logger.scope("chat:ui");

  const nextMessageId = () => {
    messageIdRef.current += 1;
    return messageIdRef.current;
  };

  // Scope options configuration
  const scopeOptions: ScopeOption[] = [
    {
      id: 'local',
      name: 'Sieć lokalna',
      icon: <Wifi size={16} />,
      description: 'Przeszukuj tylko Twoją lokalną sieć'
    },
    {
      id: 'internet',
      name: 'Internet',
      icon: <Globe size={16} />,
      description: 'Przeszukuj cały internet'
    },
    {
      id: 'tor',
      name: 'Tor',
      icon: <Search size={16} />,
      description: 'Przeszukuj przez sieć Tor'
    },
    {
      id: 'vpn',
      name: 'VPN',
      icon: <Zap size={16} />,
      description: 'Przeszukuj przez połączenie VPN'
    }
  ];

  // Get recent user queries for suggestions
  const getRecentQueries = () => {
    return messages
      .filter(msg => msg.role === 'user')
      .map(msg => msg.text)
      .slice(-5);
  };

  const baseAutocompleteSuggestions = useMemo(() => {
    return [
      'skanuj sieć',
      'znajdź kamery w sieci',
      'status urządzeń',
      'lista urządzeń',
      'tylko kamery',
      'pokaż kamery',
      'przeglądaj ',
      'wyszukaj ',
      'znajdź pliki ',
      'znajdź pliki pdf',
      'konfiguracja',
      'konfiguruj email',
      'monitoruj ',
      'pomoc',
    ];
  }, []);

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

  // Close scope selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showScopeSelector) {
        const target = event.target as Element;
        if (!target.closest('.scope-selector-container')) {
          setShowScopeSelector(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showScopeSelector]);

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

  // ... (speech hooks remain exactly the same)
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

  const stt = useStt({ lang: settings.tts_lang });

  const autocompleteSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!inputFocused) return [];
    if (!q) return [];
    if (isListening || stt.isRecording || stt.isTranscribing) return [];

    const recent = getRecentQueries();
    const candidates = [
      ...recent,
      ...baseAutocompleteSuggestions,
    ];

    const seen = new Set<string>();
    const filtered: string[] = [];
    for (const c of candidates) {
      const trimmed = String(c ?? '');
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      if (key === q) continue;
      if (!key.includes(q)) continue;
      seen.add(key);
      filtered.push(trimmed);
      if (filtered.length >= 8) break;
    }
    return filtered;
  }, [baseAutocompleteSuggestions, input, inputFocused, isListening, stt.isRecording, stt.isTranscribing, messages]);

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

  useEffect(() => {
    // If user starts speaking/recording, stop any ongoing TTS to avoid overlap.
    if (micPhase !== "idle" && tts.isSpeaking) {
      tts.stop();
    }
  }, [micPhase, tts]);

  useEffect(() => {
    const appendStatusNotice = (key: string, text: string) => {
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
    };

    if (settings.mic_enabled && !speechSupported) {
      if (speechUnsupportedReason && !stt.isSupported) {
        appendStatusNotice("speech_unsupported", `ℹ️ ${speechUnsupportedReason}`);
      }
      if (stt.isSupported) {
        appendStatusNotice(
          "stt_fallback",
          "ℹ️ STT w tym runtime używa transkrypcji w chmurze (OpenRouter).",
        );
      }
      if (stt.error) {
        appendStatusNotice("stt_error", `ℹ️ Błąd STT: ${stt.error}`);
      }
    }

    if (settings.tts_enabled && !tts.isSupported && tts.unsupportedReason) {
      appendStatusNotice("tts_unsupported", `ℹ️ ${tts.unsupportedReason}`);
    }
  }, [
    eventStore,
    settings.mic_enabled,
    settings.tts_enabled,
    speechSupported,
    speechUnsupportedReason,
    stt.isSupported,
    stt.error,
    tts.isSupported,
    tts.unsupportedReason,
  ]);

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

      const pct = Math.round(detail.changeScore * 100);
      const mime = detail.thumbnailMimeType || "image/jpeg";
      const dataUrl = detail.thumbnailBase64
        ? `data:${mime};base64,${detail.thumbnailBase64}`
        : null;

      const monitoringText = [
        `👁️ **Monitoring**: **${detail.targetName}** (${pct}%)`,
        dataUrl ? `\n\n![](${dataUrl})` : "",
        `\n\n${detail.summary}`,
      ].join("");

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

  useEffect(() => {
    if (transcript && transcript !== lastSpeechSubmitRef.current && !isListening) {
      chatLogger.info("Applying finalized speech transcript", {
        transcriptLength: transcript.length,
      });
      lastSpeechSubmitRef.current = transcript;
      handleSubmit(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, isListening]);

  useEffect(() => {
    if (finalTranscript) {
      chatLogger.info("Applying auto-listen speech transcript", {
        transcriptLength: finalTranscript.length,
      });
      handleSubmit(finalTranscript);
      clearFinalTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalTranscript]);

  useEffect(() => {
    if (!settings.mic_enabled) {
      disableAutoListen();
      return;
    }

    if (!settings.auto_listen) {
      return;
    }

    if (!speechSupported) {
      // Auto-listen currently supported only for Web Speech API path.
      return;
    }

    enableAutoListen();
    return () => disableAutoListen();
  }, [
    settings.mic_enabled,
    settings.auto_listen,
    speechSupported,
    enableAutoListen,
    disableAutoListen,
  ]);

  // Auto-listen fallback for STT (Tauri/native capture or MediaRecorder mode).
  // When Web Speech API is not available, keep recording and auto-stop on silence.
  useEffect(() => {
    const runtimeIsTauri = isTauriRuntime();

    const shouldRun =
      settings.mic_enabled &&
      settings.auto_listen &&
      !speechSupported &&
      stt.isSupported;

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
      chatLogger.info("Auto-listen(STT): starting recording");
      sttAutoListenStartedAtRef.current = Date.now();
      sttAutoListenSilenceHitsRef.current = 0;
      stt.startRecording();
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
          chatLogger.info("Auto-listen(STT): silence detected -> stopping recording");
          sttAutoListenSilenceHitsRef.current = 0;
          stt.stopRecording();
          sttAutoListenStartedAtRef.current = null;
        }
      } catch (e) {
        // Best-effort; don't break auto-listen loop.
        chatLogger.debug("Auto-listen(STT): silence probe failed", { error: String(e) });
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
    speechSupported,
    stt.isSupported,
    stt.isRecording,
    stt.isTranscribing,
    stt.startRecording,
    stt.stopRecording,
    chatLogger,
  ]);

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

  // Input focus and quick history logic
  useEffect(() => {
    // Show quick history when input is focused and empty
    if (inputFocused && !input.trim() && !hasNonSystemMessages) {
      setShowQuickHistory(true);
    } else {
      setShowQuickHistory(false);
    }
  }, [inputFocused, input, hasNonSystemMessages]);

  // Hide quick history when user starts typing
  useEffect(() => {
    if (input.trim()) {
      setShowQuickHistory(false);
    }
  }, [input]);

  useEffect(() => {
    if (!inputFocused) {
      setShowAutocomplete(false);
      return;
    }
    if (autocompleteSuggestions.length > 0) {
      setShowAutocomplete(true);
      setAutocompleteActiveIndex((idx) => {
        if (idx < 0) return 0;
        if (idx >= autocompleteSuggestions.length) return 0;
        return idx;
      });
    } else {
      setShowAutocomplete(false);
    }
  }, [autocompleteSuggestions, inputFocused]);

  // Network selection handlers
  const handleNetworkSelect = (networkConfig: NetworkConfig) => {
    setSelectedNetwork(networkConfig);
    setShowNetworkSelector(false);
    chatLogger.info('Network selected', {
      scope: networkConfig.scope,
      name: networkConfig.name
    });

    // Add to history
    addToNetworkHistory(networkConfig.scope, networkConfig.name, `${configStore.get<string>('network.defaultSubnet')}.0/24`);

    // Execute the pending query with network context
    if (pendingNetworkQuery) {
      setInput(pendingNetworkQuery);
      handleSubmit(pendingNetworkQuery);
      setPendingNetworkQuery("");
    }
  };

  const handleHistorySelect = (historyItem: NetworkHistoryItem) => {
    chatLogger.info('History network selected', {
      address: historyItem.address,
      name: historyItem.name,
      scope: historyItem.scope
    });

    // Convert to NetworkConfig
    const networkConfig = {
      scope: historyItem.scope,
      name: historyItem.name,
      description: `Historia: ${historyItem.address}`,
      icon: null,
      features: []
    } as NetworkConfig;

    setSelectedNetwork(networkConfig);
    setShowNetworkSelector(false);

    // Execute the pending query with history context
    if (pendingNetworkQuery) {
      const enhancedQuery = `${pendingNetworkQuery} (adres: ${historyItem.address})`;
      setInput(enhancedQuery);
      handleSubmit(enhancedQuery);
      setPendingNetworkQuery("");
    }
  };

  // addToNetworkHistory and addToCommandHistory are now provided by useHistoryPersistence hook

  const handleCommandHistorySelect = (command: string) => {
    chatLogger.info('Command selected from history', { command });
    setInput(command);
    setShowCommandHistory(false);
    setShowQuickHistory(false);

    // Auto-execute the command
    setTimeout(() => {
      handleSubmit(command);
    }, 100);
  };

  const handleQuickHistorySelect = (command: string) => {
    chatLogger.info('Command selected from quick history', { command });
    setInput(command);
    setShowQuickHistory(false);
    setInputFocused(true);

    // Focus back to input
    setTimeout(() => {
      const inputElement = document.querySelector('input[type="text"]') as HTMLInputElement;
      if (inputElement) {
        inputElement.focus();
        // Move cursor to end
        inputElement.setSelectionRange(command.length, command.length);
      }
    }, 100);
  };

  const handleInputFocus = () => {
    setInputFocused(true);
  };

  const handleAutocompleteSelect = (choice: string) => {
    setInput(choice);
    setShowAutocomplete(false);
    setTimeout(() => {
      const inputElement = document.querySelector("input[type='text']") as HTMLInputElement | null;
      if (inputElement) {
        inputElement.focus();
        inputElement.selectionStart = inputElement.selectionEnd = choice.length;
      }
    }, 0);
  };

  const handleInputBlur = () => {
    setInputFocused(false);
    // Small delay to allow click events to fire
    setTimeout(() => {
      setInputFocused(false);
    }, 200);
  };

  const sendAmbiguousQuerySuggestions = async (userQuery: string) => {
    chatLogger.info('Sending suggestions for ambiguous query', { userQuery });

    // Add user message to chat
    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "user",
        text: userQuery
      },
    });

    // Add suggestions message from assistant
    const suggestionsId = nextMessageId();
    eventStore.append({
      type: "message_added",
      payload: {
        id: suggestionsId,
        role: "assistant",
        text: getAmbiguousQueryText(userQuery),
        type: "suggestions",
        suggestions: getSuggestionsForQuery(userQuery)
      },
    });

    // Store the suggestions message ID for handling clicks
    (window as any).broxeenSuggestionsId = suggestionsId;
  };

  const getAmbiguousQueryText = (query: string) => {
    return `Nie jestem pewien, co dokładnie chcesz zrobić z zapytaniem: **"${query}"**

Oto kilka możliwości, które mogą Cię interesować:

Wybierz jedną z poniższych opcji, aby kontynuować:`;
  };

  const getSuggestionsForQuery = (query: string) => {
    const lowerQuery = query.toLowerCase();
    const suggestions = [];

    // File-related suggestions
    if (lowerQuery.includes('pdf') || lowerQuery.includes('plik') || lowerQuery.includes('dokument')) {
      suggestions.push(
        {
          action: 'find_files',
          text: '📄 Znajdź pliki PDF',
          description: 'Przeszukaj wszystkie dokumenty PDF w systemie',
          query: 'znajdź pliki pdf'
        },
        {
          action: 'find_documents',
          text: '📂 Przeszukaj dokumenty',
          description: 'Znajdź pliki w folderze Dokumenty i Pulpit',
          query: 'znajdź dokumenty'
        },
        {
          action: 'recent_files',
          text: '🕐 Najnowsze pliki',
          description: 'Pokaż ostatnio modyfikowane dokumenty',
          query: 'znajdź ostatnie dokumenty'
        }
      );
    }

    // Network-related suggestions
    if (lowerQuery.includes('sieci') || lowerQuery.includes('kamer') || lowerQuery.includes('urządzen')) {
      suggestions.push(
        {
          action: 'network_scan',
          text: '🔍 Skanuj sieć w poszukiwaniu kamer',
          description: 'Znajdź wszystkie kamery IP w Twojej sieci lokalnej',
          query: 'znajdź kamere w sieci'
        },
        {
          action: 'network_global',
          text: '🌐 Przeszukaj internet globalny',
          description: 'Wyszukaj publiczne urządzenia w sieci',
          query: 'skanuj siec globalnie'
        },
        {
          action: 'camera_status',
          text: '📷 Sprawdź status kamer',
          description: 'Zobacz które kamery są online',
          query: 'sprawdz status kamer'
        }
      );
    }

    // Browse-related suggestions
    if (lowerQuery.includes('stron') || lowerQuery.includes('www') || lowerQuery.includes('http')) {
      suggestions.push(
        {
          action: 'browse_url',
          text: '🌍 Przeglądaj stronę internetową',
          description: 'Otwórz i przeczytaj zawartość strony',
          query: 'przeglądaj stronę'
        },
        {
          action: 'search_web',
          text: '🔎 Wyszukaj w internecie',
          description: 'Znajdź informacje w wyszukiwarce',
          query: 'wyszukaj w internecie'
        }
      );
    }

    // General help suggestions
    suggestions.push(
      {
        action: 'help',
        text: '❓ Pokaż pomoc',
        description: 'Zobacz dostępne komendy i funkcje',
        query: 'pomoc'
      },
      {
        action: 'chat',
        text: '💬 Porozmawiaj ze mną',
        description: 'Zadaj pytanie i porozmawiaj z asystentem',
        query: 'jak mogę Ci pomóc?'
      }
    );

    return suggestions.slice(0, 5); // Limit to 5 suggestions
  };

  const handleSuggestionClick = (suggestion: any) => {
    chatLogger.info('Suggestion clicked', { action: suggestion.action, query: suggestion.query });

    // Add confirmation message
    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "assistant",
        text: `✅ Wybrano: **${suggestion.text}**

${suggestion.description}

Wykonuję akcję: ${suggestion.query}`,
        type: "content"
      },
    });

    // Execute the suggested query
    setTimeout(() => {
      handleSubmit(suggestion.query);
    }, 500);
  };

  const sendNetworkSelectionMessage = async (userQuery: string) => {
    chatLogger.info('Sending network selection message', { userQuery });

    // Add user message to chat
    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "user",
        text: userQuery
      },
    });

    // Add network selection message from assistant
    const networkSelectionId = nextMessageId();
    eventStore.append({
      type: "message_added",
      payload: {
        id: networkSelectionId,
        role: "assistant",
        text: getNetworkSelectionText(),
        type: "network_selection",
        networkOptions: [
          { scope: 'local', name: 'Sieć lokalna', description: 'Szybkie skanowanie Twojej sieci domowej/biurowej' },
          { scope: 'global', name: 'Internet globalny', description: 'Przeszukiwanie publicznych urządzeń' },
          { scope: 'tor', name: 'Sieć Tor', description: 'Anonimowe skanowanie przez sieć Tor' },
          { scope: 'vpn', name: 'Połączenie VPN', description: 'Skanowanie przez zewnętrzną sieć VPN' },
          { scope: 'custom', name: 'Konfiguracja niestandardowa', description: 'Własne ustawienia sieciowe' }
        ]
      },
    });

    // Store the network selection message ID for handling clicks
    (window as any).broxeenNetworkSelectionId = networkSelectionId;
  };

  const getNetworkSelectionText = () => {
    return `Skanuję kamery w sieci:

Skanowanie urządzeń w sieci, takich jak kamery IP, jest standardową procedurą podczas audytów bezpieczeństwa lub konfiguracji domowego monitoringu. Pozwala to upewnić się, że wszystkie urządzenia są widoczne i odpowiednio zabezpieczone.

**Wybierz zakres sieci, który chcesz przeskanować:**`;
  };

  const handleNetworkOptionClick = (scope: string, name: string) => {
    chatLogger.info('Network option clicked', { scope, name });

    // Find the network config
    const networkConfig = {
      scope: scope as NetworkScope,
      name,
      description: `Wybrano: ${name}`,
      icon: null,
      features: []
    } as NetworkConfig;

    setSelectedNetwork(networkConfig);
    setShowNetworkSelector(false);

    // Execute the pending query directly with plugin system
    if (pendingNetworkQuery) {
      setInput(pendingNetworkQuery);
      handleSubmit(pendingNetworkQuery);
      setPendingNetworkQuery("");
    }
  };

  const getNetworkScopeDescription = (scope: string) => {
    switch (scope) {
      case 'local':
        return '🏠 **Skanowanie sieci lokalnej**\n• Szybkie wykrywanie urządzeń w Twojej sieci\n• Bezpieczne - tylko Twoja sieć domowa/biurowa\n• Zwykle 1-3 sekundy skanowania';
      case 'global':
        return '🌐 **Skanowanie globalne**\n• Przeszukiwanie publicznych urządzeń\n• Wymaga stabilnego połączenia internetowego\n• Może zająć więcej czasu';
      case 'tor':
        return '🔒 **Skanowanie przez Tor**\n• Anonimowe skanowanie\n• Wolniejsze połączenia\n• Ominięcie geo-restrykcji';
      case 'vpn':
        return '🏢 **Skanowanie VPN**\n• Przez zewnętrzną sieć VPN\n• Zdalny dostęp do zasobów\n• Zależne od konfiguracji VPN';
      case 'custom':
        return '⚙️ **Konfiguracja niestandardowa**\n• Pełna kontrola nad ustawieniami\n• Niestandardowe zakresy IP\n• Zaawansowane opcje';
      default:
        return 'Nieznany zakres sieci';
    }
  };

  const getNetworkIcon = (scope: string) => {
    switch (scope) {
      case 'local': return '🏠';
      case 'global': return '🌐';
      case 'tor': return '🔒';
      case 'vpn': return '🏢';
      case 'custom': return '⚙️';
      default: return '📡';
    }
  };

  const parseCameraResults = (result: string): CameraPreviewProps['camera'][] => {
    const cameras: CameraPreviewProps['camera'][] = [];

    // Parse camera information from the result
    const lines = result.split('\n');
    let currentCamera: Partial<CameraPreviewProps['camera']> | null = null;

    for (const line of lines) {
      // Look for camera entries
      if (line.includes('Kamera') || line.includes('kamera')) {
        if (currentCamera) {
          cameras.push(currentCamera as CameraPreviewProps['camera']);
        }

        // Extract camera name and IP
        const cameraMatch = line.match(/(.+?)\s*(\d+\.\d+\.\d+\.\d+)/);
        if (cameraMatch) {
          const camCfg = configStore.getAll().camera;
          currentCamera = {
            id: cameraMatch[2],
            name: cameraMatch[1].trim(),
            ip: cameraMatch[2],
            status: 'online',
            type: 'IP Camera',
            streamUrl: `rtsp://${cameraMatch[2]}:${camCfg.rtspPort}${camCfg.defaultStreamPath}`,
          };
        }
      }
    }

    // Add the last camera if exists
    if (currentCamera) {
      cameras.push(currentCamera as CameraPreviewProps['camera']);
    }

    return cameras;
  };

  const handleCameraSelect = (camera: CameraPreviewProps['camera']) => {
    chatLogger.info('Camera selected', { camera: camera.name });
    setSelectedCamera(camera);

    // Add camera selection message
    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "assistant",
        text: `📷 Wybrano kamerę: **${camera.name}**

🌐 Adres IP: ${camera.ip}
📡 Status: ${camera.status}
🎥 Typ: ${camera.type}

🧠 **AI Analiza aktywna** - kamera będzie analizować zmiany co sekundę i automatycznie wykrywać aktywność.

Kliknij przycisk odtwarzania, aby rozpocząć monitoring z AI.`,
        type: "content"
      },
    });
  };

  const handleCameraAnalysisComplete = (cameraId: string, analysis: string) => {
    chatLogger.info('Camera analysis completed', { cameraId, analysis });

    // Add AI analysis message to chat
    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "assistant",
        text: `🧠 **AI Analiza Kamery**

📷 Kamera: ${discoveredCameras.find(c => c.id === cameraId)?.name || cameraId}
⏰ Czas: ${new Date().toLocaleString('pl-PL')}

${analysis}`,
        type: "camera_analysis",
        analysis
      },
    });
  };

  const handleCameraStreamStart = (camera: CameraPreviewProps['camera']) => {
    chatLogger.info('Camera stream started', { camera: camera.name });
  };

  const categorizeCommand = (command: string): CommandHistoryItem['category'] => {
    const lowerCommand = command.toLowerCase();

    if (lowerCommand.includes('znajdź') && lowerCommand.includes('sieci')) {
      return 'network';
    }
    if (lowerCommand.includes('kamere') || lowerCommand.includes('kamer')) {
      return 'camera';
    }
    if (looksLikeUrl(lowerCommand) || lowerCommand.includes('browse') || lowerCommand.includes('przeglądaj')) {
      return 'browse';
    }
    if (lowerCommand.includes('co') || lowerCommand.includes('jak') || lowerCommand.includes('dlaczego')) {
      return 'chat';
    }

    return 'other';
  };

  const checkIfAmbiguousQuery = (query: string): boolean => {
    const lowerQuery = query.toLowerCase();

    chatLogger.info('Checking ambiguous query', { query, length: query.length });

    // Check for ambiguous patterns
    const ambiguousPatterns = [
      // Very short queries
      lowerQuery.length < 5,
      // Generic words without context
      /^(pomoc|help|co|jak|dlaczego|test|sprawdz|pokaz|zrob|zrób|wejdź|otwórz|znajdź|szukaj|start|startuj|uruchom|włącz|wyłącz|stop|koniec)$/,
      // Questions that could mean multiple things
      /^(co masz|jak działa|pokaż mi|wejdź na|otwórz|sprawdź|czy możesz|możesz|jaka jest|ile jest|gdzie jest)$/,
      // Single words that are unclear
      /^(sieć|kamera|strona|urządzenie|system|aplikacja|program|komputer|internet|wifi|poczta|google|youtube|facebook)$/,
      // Very general requests
      /^(pokaż|zobacz|wejdź|otwórz|uruchom|włącz|sprawdź|znajdź|szukaj|testuj|odśwież|reload|refresh)$/,
    ];

    const isAmbiguous = ambiguousPatterns.some(pattern => {
      if (typeof pattern === 'boolean') return pattern;
      if (pattern instanceof RegExp) {
        const matches = pattern.test(lowerQuery);
        if (matches) {
          chatLogger.info('Query matched ambiguous pattern', { pattern: pattern.source, query });
        }
        return matches;
      }
      return false;
    });

    chatLogger.info('Ambiguous query result', { query, isAmbiguous });
    return isAmbiguous;
  };

  const checkIfNetworkQuery = (query: string): boolean => {
    const networkKeywords = [
      'znajdź kamere w sieci',
      'skanuj siec',
      'odkryj urządz',
      'wyszukaj kamere',
      'poszukaj kamery',
      'sieć lokalna',
      'network scan'
    ];

    return networkKeywords.some(keyword =>
      query.toLowerCase().includes(keyword)
    );
  };

  const containsUrl = (query: string): boolean => {
    const urlPatterns = [
      /https?:\/\/[^\s]+/i,
      /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
    ];

    return urlPatterns.some(pattern => pattern.test(query));
  };

  /** Data-driven config command route table: [route_key, pattern] */
  const CONFIG_COMMAND_ROUTES: ReadonlyArray<[string, RegExp]> = [
    ['monitor', /^(konfiguruj\s*monitoring|monitoring\s*konfiguracja|ustaw\s*monitoring)$/i],
    ['ai', /konfiguruj\s*(ai|llm|model)|config\s*(ai|llm)|ustaw\s*(ai|model|klucz)/i],
    ['network', /^(konfiguruj\s*sie[cć]|konfiguracja\s*sieci|ustaw\s*sie[cć])$/i],
    ['reset', /reset.*konfig|resetuj.*konfig|przywróć.*domyśl|restore.*default/i],
    ['help', /^(pomoc|help|co\s+umiesz|co\s+potrafisz|jak\s+zacząć|jak\s+zaczac|start)$/i],
    ['overview', /^(konfigur|config|ustawieni|settings|setup)/i],
  ];

  /** Handle config/setup commands locally with interactive prompts */
  const handleConfigCommand = (query: string): { text: string; prompt: ConfigPromptData } | null => {
    const lower = query.toLowerCase().trim();

    // Find matching route
    let route: string | null = null;
    for (const [key, pattern] of CONFIG_COMMAND_ROUTES) {
      if (pattern.test(lower)) {
        // "overview" must NOT match specific sub-config keywords
        if (key === 'overview' && /\b(ai|llm|sieć|network|ssh|model|monitor|monitoring)\b/.test(lower)) continue;
        route = key;
        break;
      }
    }
    if (!route) return null;

    switch (route) {
      case 'monitor': {
        const intervalMs = configStore.get<number>('monitor.defaultIntervalMs');
        const threshold = configStore.get<number>('monitor.defaultChangeThreshold');
        const thumb = configStore.get<number>('monitor.thumbnailMaxWidth');
        return {
          text: `👁️ **Konfiguracja monitoringu**\n\nAktualnie: interwał **${intervalMs}ms**, próg **${Math.round((threshold || 0) * 100)}%**, miniaturka **${thumb}px**.\nWybierz akcję:`,
          prompt: buildMonitorConfigPrompt(),
        };
      }
      case 'overview':
        return {
          text: '⚙️ **Konfiguracja Broxeen**\n\nWybierz sekcję do konfiguracji:',
          prompt: buildConfigOverviewPrompt(),
        };
      case 'ai': {
        const status = configStore.getConfigStatus();
        if (!status.llmConfigured) {
          return {
            text: '🧠 **Konfiguracja AI**\n\nAby korzystać z AI, potrzebujesz klucza API OpenRouter.\nWprowadź klucz poniżej lub kliknij link, aby go uzyskać:',
            prompt: buildApiKeyPrompt(),
          };
        }
        return {
          text: `🧠 **Konfiguracja AI**\n\nAktualny model: **${configStore.get('llm.model')}**\nWybierz nowy model lub zmień ustawienia:`,
          prompt: buildModelSelectionPrompt(),
        };
      }
      case 'network': {
        const subnet = configStore.get<string>('network.defaultSubnet');
        return {
          text: `🌐 **Konfiguracja sieci**\n\nAktualna podsieć: **${subnet}.0/24**\nWybierz akcję:`,
          prompt: buildNetworkConfigPrompt(subnet),
        };
      }
      case 'reset':
        configStore.reset();
        return {
          text: '🔄 **Konfiguracja zresetowana**\n\nPrzywrócono domyślne ustawienia. Skonfiguruj ponownie:',
          prompt: buildConfigOverviewPrompt(),
        };
    }

    // Help / what can you do
    if (route === 'help') {
      const status = configStore.getConfigStatus();
      const helpActions: import('./ChatConfigPrompt').ConfigAction[] = [
        { id: 'help-scan', label: 'Skanuj sieć', icon: '🔍', type: 'prefill', prefillText: 'skanuj sieć', variant: 'primary', description: 'Znajdź urządzenia w sieci' },
        { id: 'help-cameras', label: 'Znajdź kamery', icon: '📷', type: 'prefill', prefillText: 'znajdź kamery w sieci', variant: 'primary', description: 'Szukaj kamer IP' },
        { id: 'help-browse', label: 'Przeglądaj stronę', icon: '🌍', type: 'prefill', prefillText: 'przeglądaj ', variant: 'secondary', description: 'Otwórz i przeczytaj stronę' },
        { id: 'help-ssh', label: 'Połącz SSH', icon: '📡', type: 'prefill', prefillText: 'ssh ', variant: 'secondary', description: 'Zdalne połączenie SSH' },
        { id: 'help-disk', label: 'Dyski', icon: '💾', type: 'prefill', prefillText: 'pokaż dyski', variant: 'secondary', description: 'Informacje o dyskach' },
        { id: 'help-files', label: 'Szukaj plików', icon: '📁', type: 'prefill', prefillText: 'znajdź pliki ', variant: 'primary', description: 'Wyszukaj dokumenty na dysku' },
        { id: 'help-email', label: 'Email', icon: '📧', type: 'execute', executeQuery: 'konfiguruj email', variant: 'secondary', description: 'Skonfiguruj i zarządzaj email' },
        { id: 'help-inbox', label: 'Sprawdź pocztę', icon: '📬', type: 'execute', executeQuery: 'sprawdź skrzynkę email', variant: 'secondary', description: 'Odczytaj wiadomości email' },
        { id: 'help-config', label: 'Konfiguracja', icon: '⚙️', type: 'execute', executeQuery: 'konfiguracja', variant: 'secondary', description: 'Zmień ustawienia' },
      ];

      if (!status.llmConfigured) {
        helpActions.unshift({
          id: 'help-setup-ai', label: 'Skonfiguruj AI', icon: '🧠', type: 'execute', executeQuery: 'konfiguruj ai', variant: 'warning', description: 'Wymagane do rozmów z AI',
        });
      }

      return {
        text: '👋 **Witaj w Broxeen!**\n\nOto co mogę dla Ciebie zrobić. Kliknij przycisk lub wpisz komendę:',
        prompt: {
          title: 'Dostępne akcje',
          actions: helpActions,
          layout: 'cards',
        },
      };
    }

    return null;
  };

  const handleSubmit = async (text?: string) => {
    const query = (text || input).trim();
    if (!query) {
      chatLogger.debug("Ignoring empty submit");
      return;
    }

    // Hide command history when user submits
    setShowCommandHistory(false);

    // Save to history
    if (inputHistoryRef.current[inputHistoryRef.current.length - 1] !== query) {
      inputHistoryRef.current.push(query);
    }
    historyIndexRef.current = -1; // Reset index

    setInput("");
    chatLogger.info("Handling submit", { queryLength: query.length });

    // Emit user message directly to store
    eventStore.append({
      type: "message_added",
      payload: { id: nextMessageId(), role: "user", text: query },
    });

    // ── Config commands — handled locally with interactive prompts ──
    const configResult = handleConfigCommand(query);
    if (configResult) {
      eventStore.append({
        type: "message_added",
        payload: {
          id: nextMessageId(),
          role: "assistant",
          text: configResult.text,
          type: "config_prompt",
          configPrompt: configResult.prompt,
        },
      });
      addToCommandHistory(query, configResult.text, 'other', true);
      return;
    }

    const processId = `query:${Date.now()}`;

    // Show thinking message while processing
    const thinkingId = nextMessageId();
    const thinkingLabel = /plik|dokument|file/i.test(query)
      ? 'Szukam plików na dysku'
      : /email|mail|poczta|skrzynk/i.test(query)
        ? 'Sprawdzam skrzynkę email'
        : /skan|kamer|sieć|siec/i.test(query)
          ? 'Skanuję sieć'
          : 'Przetwarzam zapytanie';
    const estimatedSec = /plik|dokument|file/i.test(query) ? 8 : /email|mail/i.test(query) ? 10 : 5;

    eventStore.append({
      type: "message_added",
      payload: {
        id: thinkingId,
        role: "assistant",
        text: thinkingLabel,
        type: "thinking",
        thinkingInfo: {
          label: thinkingLabel,
          estimatedSeconds: estimatedSec,
          startedAt: Date.now(),
        },
      },
    });

    try {
      processRegistry.upsertRunning({
        id: processId,
        type: 'query',
        label: `Zapytanie: ${query.length > 60 ? query.slice(0, 57) + '...' : query}`,
        details: `scope=${currentScope}`,
        stopCommand: undefined,
      });

      // Use plugin system to handle the query with scope information
      const result = await ask(query, isListening || stt.isRecording ? "voice" : "text", currentScope);

      // Remove thinking message once we have a response
      eventStore.append({
        type: "message_updated",
        payload: { id: thinkingId, updates: { type: "content", text: "", thinkingInfo: undefined } },
      });

      chatLogger.info("Plugin system result", {
        status: result.status,
        contentBlocks: result.content.length,
        executionTime: result.metadata.duration_ms,
        scope: currentScope,
      });

      if (result.status === 'success') {
        // Handle fallback results with configPrompt (action suggestions)
        const fallbackPrompt = (result.metadata as any)?.configPrompt;
        if (result.pluginId === 'fallback' && fallbackPrompt) {
          const textData = result.content[0]?.data as string || '';
          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: textData,
              type: "config_prompt",
              configPrompt: fallbackPrompt,
            },
          });
          addToCommandHistory(query, textData, categorizeCommand(query), true);
          processRegistry.complete(processId);
          processRegistry.remove(processId);
          return;
        }

        const hasCameraLiveBlock = result.content.some((block) => {
          if (block.type !== 'structured') return false;
          try {
            const parsed = JSON.parse(String(block.data ?? '')) as any;
            return parsed?.kind === 'camera_live' && typeof parsed.url === 'string' && typeof parsed.cameraId === 'string';
          } catch {
            return false;
          }
        });

        const contentBlocks = hasCameraLiveBlock
          ? result.content.filter((b) => b.type === 'structured')
          : result.content;

        const runtimeIsTauri = isTauriRuntime();
        let firstLivePayload: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string } | null = null;

        // Convert plugin content blocks to chat messages
        let fullResult = '';
        for (const block of contentBlocks) {
          let messageText = '';
          let messageType: 'content' | 'image' | 'camera_live' = 'content';
          let livePayload: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string; snapshotUrl?: string | null; startInSnapshotMode?: boolean } | undefined;

          if (block.type === 'text') {
            messageText = block.data as string;
          } else if (block.type === 'image') {
            messageText = block.data as string;
            messageType = 'image';
          } else if (block.type === 'config_prompt') {
            // Config prompt blocks: create separate message with interactive buttons
            eventStore.append({
              type: "message_added",
              payload: {
                id: nextMessageId(),
                role: "assistant",
                text: block.data as string,
                type: "config_prompt",
                configPrompt: block.configPrompt,
              },
            });
            continue; // Skip adding to fullResult
          } else if (block.type === 'structured') {
            // Structured blocks: support camera_live payload
            try {
              const parsed = JSON.parse(String(block.data ?? '')) as any;
              if (parsed && parsed.kind === 'camera_live' && typeof parsed.url === 'string' && typeof parsed.cameraId === 'string') {
                messageType = 'camera_live';
                livePayload = {
                  url: parsed.url,
                  cameraId: parsed.cameraId,
                  fps: typeof parsed.fps === 'number' ? parsed.fps : undefined,
                  initialBase64: typeof parsed.initialBase64 === 'string' ? parsed.initialBase64 : undefined,
                  initialMimeType: typeof parsed.initialMimeType === 'string' ? parsed.initialMimeType : undefined,
                  snapshotUrl: typeof parsed.snapshotUrl === 'string' ? parsed.snapshotUrl : null,
                  startInSnapshotMode: parsed.startInSnapshotMode === true,
                };
                if (!firstLivePayload) firstLivePayload = livePayload;
                messageText = '';
              } else {
                messageText = String(block.data);
              }
            } catch {
              messageText = String(block.data);
            }
          } else {
            messageText = String(block.data);
          }

          if (messageText) {
            fullResult += messageText + ' ';
          }
          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: messageText,
              type: messageType,
              mimeType: block.mimeType,
              title: block.title,
              live: livePayload,
            },
          });
        }

        if (runtimeIsTauri && firstLivePayload) {
          setExpandedLive(firstLivePayload);
        }

        // Auto-play TTS for plugin responses (bypass loading-wait mechanism)
        if (settings.tts_enabled && tts.isSupported && fullResult.trim().length > 0) {
          tts.speak(fullResult.trim().slice(0, 3000));
        }

        // Add to command history
        addToCommandHistory(query, fullResult.trim(), categorizeCommand(query), true);

        processRegistry.complete(processId);
        processRegistry.remove(processId);
      } else {
        // Clear thinking message on error
        eventStore.append({
          type: "message_updated",
          payload: { id: thinkingId, updates: { type: "content", text: "", thinkingInfo: undefined } },
        });

        const errorMessage = (result.content[0]?.data as string) ?? "Wystąpił błąd podczas przetwarzania zapytania.";
        const looksLikeRecoverableError =
          /\bcommand\b.*\bnot found\b/i.test(errorMessage)
          || /\bno handler registered\b/i.test(errorMessage)
          || /\bhandler\b.*\bnot found\b/i.test(errorMessage)
          || /\btimeout\b/i.test(errorMessage)
          || /\btimed out\b/i.test(errorMessage)
          || /\betimedout\b/i.test(errorMessage)
          || /\beconnrefused\b/i.test(errorMessage)
          || /\benetunreach\b/i.test(errorMessage)
          || /\bnetwork is unreachable\b/i.test(errorMessage)
          || /\bpermission denied\b/i.test(errorMessage)
          || /\beacces\b/i.test(errorMessage)
          || /\bffmpeg\b.*\bnot found\b/i.test(errorMessage)
          || /\bno such file or directory\b/i.test(errorMessage);

        if (looksLikeRecoverableError) {
          try {
            const { generateFallback } = await import('../core/fallbackHandler');
            const fallback = await generateFallback({
              query: `${query}\n\nBłąd: ${errorMessage}`,
              detectedIntent: 'system:error',
              scope: currentScope,
            });

            eventStore.append({
              type: "message_added",
              payload: {
                id: nextMessageId(),
                role: "assistant",
                text: `⚠️ ${errorMessage}\n\n${fallback.text}`,
                type: "config_prompt",
                configPrompt: fallback.configPrompt,
              },
            });
          } catch {
            eventStore.append({
              type: "message_added",
              payload: {
                id: nextMessageId(),
                role: "assistant",
                text: errorMessage,
                type: "error",
              },
            });
          }
        } else {
          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: errorMessage,
              type: "error",
            },
          });
        }

        // Add to command history
        addToCommandHistory(query, errorMessage, categorizeCommand(query), false);

        processRegistry.fail(processId, errorMessage);
        processRegistry.remove(processId);
      }
    } catch (error) {
      // Clear thinking message on error
      eventStore.append({
        type: "message_updated",
        payload: { id: thinkingId, updates: { type: "content", text: "", thinkingInfo: undefined } },
      });

      const errorMessage = (error as any)?.message ?? "Wystąpił błąd podczas przetwarzania zapytania.";
      const looksLikeRecoverableError =
        /\bcommand\b.*\bnot found\b/i.test(errorMessage)
        || /\bno handler registered\b/i.test(errorMessage)
        || /\bhandler\b.*\bnot found\b/i.test(errorMessage)
        || /\btimeout\b/i.test(errorMessage)
        || /\btimed out\b/i.test(errorMessage)
        || /\betimedout\b/i.test(errorMessage)
        || /\beconnrefused\b/i.test(errorMessage)
        || /\benetunreach\b/i.test(errorMessage)
        || /\bnetwork is unreachable\b/i.test(errorMessage)
        || /\bpermission denied\b/i.test(errorMessage)
        || /\beacces\b/i.test(errorMessage)
        || /\bffmpeg\b.*\bnot found\b/i.test(errorMessage)
        || /\bno such file or directory\b/i.test(errorMessage);

      if (looksLikeRecoverableError) {
        try {
          const { generateFallback } = await import('../core/fallbackHandler');
          const fallback = await generateFallback({
            query: `${query}\n\nBłąd: ${errorMessage}`,
            detectedIntent: 'system:error',
            scope: currentScope,
          });

          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: `⚠️ ${errorMessage}\n\n${fallback.text}`,
              type: "config_prompt",
              configPrompt: fallback.configPrompt,
            },
          });
        } catch {
          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: errorMessage,
              type: "error",
            },
          });
        }
      } else {
        eventStore.append({
          type: "message_added",
          payload: {
            id: nextMessageId(),
            role: "assistant",
            text: errorMessage,
            type: "error",
          },
        });
      }

      // Add to command history
      addToCommandHistory(query, errorMessage, categorizeCommand(query), false);

      processRegistry.fail(processId, errorMessage);
      processRegistry.remove(processId);
    }

  };

  const handleLlmQuestion = async (question: string) => {
    await commands.sendMessage.execute(question, pageContent);
  };

  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      const choice = autocompleteSuggestions[Math.min(autocompleteActiveIndex, autocompleteSuggestions.length - 1)];
      if (choice) {
        setInput(choice);
        setTimeout(() => {
          const inputElement = document.querySelector("input[type='text']") as HTMLInputElement | null;
          if (inputElement) {
            inputElement.focus();
            inputElement.selectionStart = inputElement.selectionEnd = choice.length;
          }
        }, 0);
      }
      return;
    }

    if (e.key === 'ArrowDown' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      setAutocompleteActiveIndex((idx) => (idx + 1) % autocompleteSuggestions.length);
      return;
    }

    if (e.key === 'ArrowUp' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      setAutocompleteActiveIndex((idx) => (idx - 1 + autocompleteSuggestions.length) % autocompleteSuggestions.length);
      return;
    }

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
              src={`data:${expandedImage.mimeType || 'image/jpeg'};base64,${expandedImage.data}`}
              alt="Powiększony obraz"
              className="max-h-[90vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {expandedLive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setExpandedLive(null)}
        >
          <div className="relative h-full w-full max-w-6xl">
            <button
              className="absolute -top-10 right-0 p-2 text-white hover:text-gray-300"
              onClick={() => setExpandedLive(null)}
            >
              Zamknij (ESC)
            </button>
            <div className="h-full w-full" onClick={(e) => e.stopPropagation()}>
              <CameraLiveInline
                url={expandedLive.url}
                cameraId={expandedLive.cameraId}
                fps={expandedLive.fps}
                initialFrame={
                  expandedLive.initialBase64
                    ? { base64: expandedLive.initialBase64, mimeType: expandedLive.initialMimeType || 'image/jpeg' }
                    : null
                }
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full flex-col">
        {/* Chat messages area */}
        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-transparent via-gray-950/50 to-transparent">
          <div className="mx-auto max-w-3xl px-4 py-6">
            <div className="space-y-4">
              {/* Command History - show when no messages */}
              {!hasNonSystemMessages && showCommandHistory && (
                <CommandHistory
                  onSelect={handleCommandHistorySelect}
                  className="mb-6"
                  maxItems={10}
                />
              )}

              {showWelcomeScreen && !showCommandHistory && (
                <>
                  <div className="flex mt-16 flex-col items-center justify-center text-center fade-in">
                    <h1 className="mb-3 text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-broxeen-400 to-emerald-400 sm:text-5xl">
                      Witaj w Broxeen
                    </h1>
                    <p className="max-w-xl text-base text-gray-400 mb-6">
                      Kliknij akcję poniżej, wpisz komendę lub użyj mikrofonu 🎤
                    </p>

                    {/* Quick-start action cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl w-full mb-6">
                      {[
                        { icon: '🔍', label: 'Skanuj sieć', desc: 'Znajdź urządzenia w LAN', query: 'skanuj sieć', color: 'from-blue-600/20 to-blue-800/10 border-blue-500/30 hover:border-blue-400/50' },
                        { icon: '📷', label: 'Znajdź kamery', desc: 'Odkryj kamery IP', query: 'znajdź kamery w sieci', color: 'from-purple-600/20 to-purple-800/10 border-purple-500/30 hover:border-purple-400/50' },
                        { icon: '🌍', label: 'Przeglądaj stronę', desc: 'Otwórz dowolny URL', query: '', prefill: 'przeglądaj ', color: 'from-green-600/20 to-green-800/10 border-green-500/30 hover:border-green-400/50' },
                        { icon: '📁', label: 'Szukaj plików', desc: 'Wyszukaj dokumenty na dysku', query: '', prefill: 'znajdź pliki ', color: 'from-teal-600/20 to-teal-800/10 border-teal-500/30 hover:border-teal-400/50' },
                        { icon: '📧', label: 'Email', desc: 'Wyślij pliki, sprawdź pocztę', query: 'konfiguruj email', color: 'from-violet-600/20 to-violet-800/10 border-violet-500/30 hover:border-violet-400/50' },
                        { icon: '⚙️', label: 'Konfiguracja', desc: 'Ustaw AI, sieć, SSH', query: 'konfiguracja', color: 'from-amber-600/20 to-amber-800/10 border-amber-500/30 hover:border-amber-400/50' },
                        { icon: '👁️', label: 'Monitoruj', desc: 'Obserwuj zmiany', query: '', prefill: 'monitoruj ', color: 'from-red-600/20 to-red-800/10 border-red-500/30 hover:border-red-400/50' },
                        { icon: '❓', label: 'Pomoc', desc: 'Co mogę zrobić?', query: 'pomoc', color: 'from-gray-600/20 to-gray-800/10 border-gray-500/30 hover:border-gray-400/50' },
                      ].map((card, idx) => (
                        <button
                          key={card.label}
                          onClick={() => {
                            if (card.query) {
                              handleSubmit(card.query);
                            } else if (card.prefill) {
                              setInput(card.prefill);
                            }
                          }}
                          className={`group relative flex flex-col items-start gap-1 rounded-xl border bg-gradient-to-br p-4 text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${card.color}`}
                        >
                          <div className="flex w-full items-start justify-between">
                            <span className="text-2xl mb-1">{card.icon}</span>
                            <kbd className="hidden sm:inline-flex items-center rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-mono text-gray-500 group-hover:text-gray-400">
                              ^{idx + 1}
                            </kbd>
                          </div>
                          <span className="text-sm font-semibold text-gray-200 group-hover:text-white">{card.label}</span>
                          <span className="text-[11px] text-gray-400 group-hover:text-gray-300">{card.desc}</span>
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowCommandHistory(true)}
                        className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-lg hover:bg-gray-700 hover:text-gray-200 transition-colors"
                      >
                        📜 Historia komend
                      </button>
                    </div>
                  </div>

                  {/* Action Suggestions */}
                  <ActionSuggestions
                    onActionSelect={(query) => {
                      setInput(query);
                      handleSubmit(query);
                    }}
                    recentQueries={getRecentQueries()}
                    isVisible={true}
                    currentContext={getCurrentContext()}
                    onLearn={handleSuggestionLearning}
                  />

                  {/* Quick Commands */}
                  <div className="mt-4">
                    <QuickCommands
                      onCommandSelect={(query) => {
                        setInput(query);
                        handleSubmit(query);
                      }}
                      recentCommands={getRecentQueries()}
                    />
                  </div>
                </>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user"
                    ? "justify-end slide-in-right"
                    : msg.role === "system"
                      ? "justify-start"
                      : "justify-start slide-in-left"
                    }`}
                  data-testid="message"
                >
                  {/* Bot avatar for assistant messages */}
                  {msg.role === "assistant" && (
                    <div className="mr-2.5 mt-1 flex-shrink-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-broxeen-500 to-broxeen-700 text-xs shadow-lg shadow-broxeen-500/20">
                        <Bot size={14} className="text-white" />
                      </div>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-3 ${msg.role === "user"
                      ? "max-w-[85%] bg-gradient-to-br from-broxeen-500 to-broxeen-700 text-white cursor-pointer transition-all hover:from-broxeen-400 hover:to-broxeen-600 shadow-lg shadow-broxeen-500/10"
                      : msg.role === "system"
                        ? `max-w-[95%] border-l-2 text-xs py-2 px-3 rounded-lg ${msg.text.includes('Błąd') || msg.text.includes('Error') ? 'border-amber-500/60 bg-amber-950/20 text-amber-300/80' : 'border-blue-500/40 bg-blue-950/20 text-gray-400'}`
                        : "max-w-[85%] bg-gray-800/60 backdrop-blur-sm border border-gray-700/40 text-gray-100 shadow-md"
                      }`}
                    onClick={
                      msg.role === "user"
                        ? () => {
                          setInput(msg.text);
                          const inputElement = document.querySelector('textarea') as HTMLTextAreaElement;
                          if (inputElement) {
                            inputElement.focus();
                            setTimeout(() => {
                              inputElement.selectionStart = inputElement.selectionEnd = msg.text.length;
                            }, 0);
                          }
                        }
                        : undefined
                    }
                    title={
                      msg.role === "user"
                        ? "Kliknij, aby skopiować do pola chat"
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
                            className="w-full h-auto object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => msg.screenshotBase64 && setExpandedImage({ data: msg.screenshotBase64, mimeType: 'image/png' })}
                          />
                        </div>
                      )}
                      {msg.role === "assistant" && msg.type === "image" && msg.text && (
                        <div className="shrink-0 w-full max-w-sm rounded-lg border border-gray-700 bg-black/50 overflow-hidden">
                          {msg.title && (
                            <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700 truncate">
                              📷 {msg.title}
                            </div>
                          )}
                          <img
                            src={`data:${msg.mimeType || 'image/jpeg'};base64,${msg.text}`}
                            alt={msg.title || "Podgląd kamery"}
                            className="w-full h-auto object-contain max-h-64 cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setExpandedImage({ data: msg.text, mimeType: msg.mimeType || 'image/jpeg' })}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                      {msg.role === "assistant" && msg.type === "camera_live" && msg.live && (
                        <div className="shrink-0 w-full max-w-sm rounded-lg border border-gray-700 bg-black/50 overflow-hidden p-3">
                          <CameraLiveInline
                            url={msg.live.url}
                            cameraId={msg.live.cameraId}
                            fps={msg.live.fps}
                            snapshotUrl={msg.live.snapshotUrl}
                            startInSnapshotMode={msg.live.startInSnapshotMode}
                            initialFrame={
                              msg.live.initialBase64
                                ? {
                                  base64: msg.live.initialBase64,
                                  mimeType: msg.live.initialMimeType || 'image/jpeg',
                                }
                                : null
                            }
                            className="w-full"
                            imageClassName="w-full h-auto object-contain max-h-64 rounded cursor-pointer hover:opacity-90 transition-opacity"
                            onClickImage={(img) => setExpandedImage({ data: img.base64, mimeType: img.mimeType })}
                          />
                        </div>
                      )}
                      <div className="flex-1 w-full min-w-0">
                        {/* Thinking / processing indicator */}
                        {msg.type === 'thinking' && msg.thinkingInfo ? (
                          <ThinkingMessage
                            label={msg.thinkingInfo.label}
                            estimatedSeconds={msg.thinkingInfo.estimatedSeconds}
                            startedAt={msg.thinkingInfo.startedAt}
                          />
                        ) : msg.loading ? (
                          <div className="flex items-center gap-2 text-gray-400">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{msg.text}</span>
                          </div>
                        ) : msg.type === 'thinking' && !msg.thinkingInfo ? null : msg.type === 'image' || msg.type === 'camera_live' ? null : (
                          <div className="text-sm leading-relaxed">
                            {msg.pageTitle && (
                              <div className="font-bold mb-2">
                                {msg.pageTitle}
                              </div>
                            )}
                            <MessageResultCard text={msg.text} msgType={msg.type}>
                              <div className="prose prose-invert max-w-none prose-sm">
                                <ReactMarkdown
                                  urlTransform={(url) => url}
                                  remarkPlugins={[remarkGfm, remarkBreaks]}
                                  components={{
                                    // Customize styling for common elements
                                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                                    em: ({ children }) => <em className="italic">{children}</em>,
                                    code: ({ className, children }) => {
                                      const isInline = !className?.includes('language-');
                                      const codeText = String(children).replace(/\n$/, '');

                                      return isInline ?
                                        <code
                                          className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono cursor-pointer hover:bg-gray-600 transition-colors"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setInput(codeText);
                                            const inputElement = document.querySelector('textarea') as HTMLTextAreaElement;
                                            if (inputElement) {
                                              inputElement.focus();
                                              setTimeout(() => {
                                                inputElement.selectionStart = inputElement.selectionEnd = codeText.length;
                                              }, 0);
                                            }
                                          }}
                                          title="Kliknij, aby skopiować do pola chat"
                                        >
                                          {children}
                                        </code> :
                                        <code className="block bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>;
                                    },
                                    ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                    li: ({ children }) => <li className="text-gray-200">{children}</li>,
                                    a: ({ href, children }) => (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-400 hover:text-blue-300 underline"
                                      >
                                        {children}
                                      </a>
                                    ),
                                    blockquote: ({ children }) => (
                                      <blockquote className="border-l-4 border-gray-600 pl-4 italic text-gray-300 my-2">
                                        {children}
                                      </blockquote>
                                    ),
                                    img: ({ src, alt }) => {
                                      if (!src) return null;
                                      const isDataUrl = src.startsWith('data:');
                                      const canPreview = isDataUrl;
                                      return (
                                        <img
                                          src={src}
                                          alt={alt || 'Obraz'}
                                          className="max-w-full h-auto rounded border border-gray-700 bg-black/30 cursor-pointer hover:opacity-90 transition-opacity"
                                          onClick={() => {
                                            if (!canPreview) return;
                                            const m = src.match(/^data:([^;]+);base64,(.+)$/);
                                            if (!m) return;
                                            setExpandedImage({ data: m[2], mimeType: m[1] });
                                          }}
                                        />
                                      );
                                    },
                                  }}
                                >
                                  {(() => {
                                    const markers = [
                                      '💡 **Sugerowane akcje:**',
                                      '💡 **Sugerowane akcje**:',
                                      'Sugerowane akcje:',
                                      'Sugerowane akcje',
                                    ];

                                    for (const candidate of markers) {
                                      const idx = msg.text.indexOf(candidate);
                                      if (idx !== -1) {
                                        return msg.text.slice(0, idx).trimEnd();
                                      }
                                    }

                                    return msg.text;
                                  })()}
                                </ReactMarkdown>
                              </div>
                            </MessageResultCard>
                          </div>
                        )}

                        {/* Inline Action Hints */}
                        {msg.role === "assistant" && !msg.loading && (() => {
                          const markers = [
                            '💡 **Sugerowane akcje:**',
                            '💡 **Sugerowane akcje**:',
                            'Sugerowane akcje:',
                            'Sugerowane akcje',
                          ];

                          let markerIdx = -1;
                          let markerText = '';
                          for (const candidate of markers) {
                            const idx = msg.text.indexOf(candidate);
                            if (idx !== -1) {
                              markerIdx = idx;
                              markerText = candidate;
                              break;
                            }
                          }

                          if (markerIdx === -1) return null;

                          const afterMarker = msg.text.slice(markerIdx + markerText.length);
                          const section = afterMarker
                            .split('\n')
                            .map((l) => l.trimEnd())
                            .join('\n');

                          const hintPattern = /^-\s*"([^"]+)"(?:\s*[—–-]\s*(.+))?$/gm;
                          const hints: Array<{ query: string; label: string; isPrefill: boolean }> = [];
                          const seen = new Set<string>();
                          let m: RegExpExecArray | null;

                          while ((m = hintPattern.exec(section)) !== null) {
                            const query = m[1].trim();
                            const label = (m[2]?.trim() || query).trim();
                            if (!query || !label) continue;
                            // Basic hardening: prevent absurdly long / pasted content queries
                            if (query.length > 200) continue;
                            if (seen.has(query)) continue;
                            seen.add(query);

                            // Detect if this is a template to prefill (contains HASŁO, PASSWORD, etc.)
                            const isPrefill = /HASŁO|PASSWORD|HASLO|USER|USERNAME|NAZWA/i.test(query);

                            hints.push({ query, label, isPrefill });
                            if (hints.length >= 10) break;
                          }

                          if (hints.length === 0) return null;
                          return (
                            <div className="mt-3 flex flex-wrap gap-2" data-testid="action-hints">
                              {hints.map((hint) => (
                                <button
                                  key={hint.query}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (hint.isPrefill) {
                                      // Prefill input for editing
                                      setInput(hint.query);
                                      const inputElement = document.querySelector('textarea') as HTMLTextAreaElement;
                                      if (inputElement) {
                                        inputElement.focus();
                                        // Select the placeholder text for easy replacement
                                        setTimeout(() => {
                                          const placeholderMatch = hint.query.match(/HASŁO|PASSWORD|HASLO|USER|USERNAME|NAZWA/i);
                                          if (placeholderMatch) {
                                            const placeholderPos = hint.query.indexOf(placeholderMatch[0]);
                                            inputElement.selectionStart = placeholderPos;
                                            inputElement.selectionEnd = placeholderPos + placeholderMatch[0].length;
                                          } else {
                                            inputElement.selectionStart = inputElement.selectionEnd = hint.query.length;
                                          }
                                        }, 0);
                                      }
                                    } else {
                                      // Execute immediately
                                      handleSubmit(hint.query);
                                    }
                                  }}
                                  className="flex items-center gap-1.5 rounded-lg bg-broxeen-600/20 border border-broxeen-600/30 px-3 py-1.5 text-xs font-medium text-broxeen-300 hover:bg-broxeen-600/30 transition"
                                  title={hint.query}
                                >
                                  <Zap size={12} />
                                  <span>{hint.label}</span>
                                </button>
                              ))}
                            </div>
                          );
                        })()}

                        {/* Network Selection Options */}
                        {msg.type === "network_selection" && msg.networkOptions && (
                          <div className="mt-4 space-y-2" data-testid="network-selection">
                            {msg.networkOptions.map((option: any, index: number) => (
                              <button
                                key={index}
                                onClick={() => handleNetworkOptionClick(option.scope, option.name)}
                                className="w-full text-left p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors group"
                                data-testid={`network-option-${option.scope}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium text-gray-200 group-hover:text-broxeen-400">
                                      {getNetworkIcon(option.scope)} {option.name}
                                    </div>
                                    <div className="text-sm text-gray-400 mt-1">
                                      {option.description}
                                    </div>
                                  </div>
                                  <div className="text-gray-400 group-hover:text-broxeen-400">
                                    →
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Suggestions */}
                        {msg.type === "suggestions" && msg.suggestions && (
                          <div className="mt-4 space-y-2" data-testid="suggestions">
                            {msg.suggestions.map((suggestion: any, index: number) => (
                              <button
                                key={index}
                                onClick={() => handleSuggestionClick(suggestion)}
                                className="w-full text-left p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors group"
                                data-testid={`suggestion-${suggestion.action}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium text-gray-200 group-hover:text-broxeen-400">
                                      {suggestion.text}
                                    </div>
                                    <div className="text-sm text-gray-400 mt-1">
                                      {suggestion.description}
                                    </div>
                                  </div>
                                  <div className="text-gray-400 group-hover:text-broxeen-400">
                                    →
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Config Prompt (interactive buttons/fields) */}
                        {msg.type === "config_prompt" && msg.configPrompt && (
                          <ChatConfigPrompt
                            data={msg.configPrompt}
                            onPrefill={(text) => setInput(text)}
                            onExecute={(query) => handleSubmit(query)}
                          />
                        )}

                        {/* Camera List */}
                        {msg.type === "camera_list" && msg.cameras && (
                          <div className="mt-4 space-y-4" data-testid="camera-list">
                            {msg.cameras.map((camera, index: number) => (
                              <CameraPreview
                                key={camera.id}
                                camera={{
                                  ...camera,
                                  ip: camera.address,
                                  type: 'rtsp',
                                  status: camera.status as 'online' | 'offline'
                                }}
                                onSelect={handleCameraSelect}
                                onAnalysisComplete={handleCameraAnalysisComplete}
                                className="max-w-md"
                              />
                            ))}
                          </div>
                        )}

                        {/* AI Analysis Message */}
                        {msg.type === "camera_analysis" && (
                          <div className="mt-4 p-4 bg-blue-900/20 border border-blue-700/50 rounded-lg" data-testid="camera-analysis">
                            <div className="flex items-start space-x-3">
                              <div className="flex-shrink-0">
                                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
                                  🧠
                                </div>
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-medium text-blue-400 mb-2">
                                  AI Analiza Kamery
                                </div>
                                <div className="text-sm text-gray-300 prose prose-invert max-w-none prose-sm">
                                  <ReactMarkdown
                                    urlTransform={(url) => url}
                                    remarkPlugins={[remarkGfm, remarkBreaks]}
                                    components={{
                                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                      strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                                      em: ({ children }) => <em className="italic">{children}</em>,
                                      code: ({ className, children }) => {
                                        const isInline = !className?.includes('language-');
                                        return isInline ?
                                          <code className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code> :
                                          <code className="block bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>;
                                      },
                                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                      li: ({ children }) => <li className="text-gray-200">{children}</li>,
                                      a: ({ href, children }) => (
                                        <a
                                          href={href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-400 hover:text-blue-300 underline"
                                        >
                                          {children}
                                        </a>
                                      ),
                                    }}
                                  >
                                    {msg.text}
                                  </ReactMarkdown>
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                  Analiza wykonana automatycznie • Wykrywanie zmian co sekundę
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {selectedCamera && (
                          <div className="mt-4" data-testid="selected-camera-preview">
                            <CameraPreview
                              camera={selectedCamera}
                              onSelect={handleCameraSelect}
                              onAnalysisComplete={handleCameraAnalysisComplete}
                              className="max-w-2xl mx-auto"
                            />
                          </div>
                        )}
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
                                key={s.query}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSuggestionClick(s);
                                }}
                                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-broxeen-300 transition hover:bg-gray-600"
                              >
                                {s.text.replace("https://", "")}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Contextual quick actions */}
                        {msg.role === "assistant" && !msg.loading && msg.type !== "config_prompt" && (
                          <MessageQuickActions
                            message={msg}
                            onExecute={(query) => handleSubmit(query)}
                            onPrefill={(text) => setInput(text)}
                          />
                        )}
                      </div>
                    </div>

                    {msg.role === "assistant" &&
                      !msg.loading &&
                      msg.text.length > 50 &&
                      (tts.isSpeaking || messages[messages.length - 1]?.id === msg.id) && (
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
        <div className="border-t border-gray-800/50 bg-gray-900/90 px-4 py-4 backdrop-blur-lg">
          <div className="mx-auto max-w-3xl">
            {/* Scope Selector */}
            <div className="mb-3 flex items-center justify-between scope-selector-container">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Zakres:</span>
                <button
                  onClick={() => setShowScopeSelector(!showScopeSelector)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${currentScope === 'local'
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                    : 'bg-broxeen-600/20 text-broxeen-400 border border-broxeen-600/30 hover:bg-broxeen-600/30'
                    }`}
                >
                  {scopeOptions.find(option => option.id === currentScope)?.icon}
                  <span>{scopeOptions.find(option => option.id === currentScope)?.name}</span>
                  <ChevronDown size={14} className={`transition-transform ${showScopeSelector ? 'rotate-180' : ''}`} />
                </button>
                {currentScope !== 'local' && (
                  <span className="text-xs text-amber-400">
                    ⚠️ Przeszukujesz poza siecią lokalną
                  </span>
                )}
              </div>

              {/* Scope Selector Dropdown */}
              {showScopeSelector && (
                <div className="absolute bottom-full left-4 right-4 mb-2 z-50 rounded-lg bg-gray-800 border border-gray-700 shadow-lg">
                  <div className="p-2">
                    {scopeOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => {
                          setCurrentScope(option.id);
                          setShowScopeSelector(false);
                          chatLogger.info('Scope changed', { from: currentScope, to: option.id });
                        }}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ${currentScope === option.id
                          ? 'bg-broxeen-600 text-white'
                          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                          }`}
                      >
                        {option.icon}
                        <div className="flex-1">
                          <div className="text-sm font-medium">{option.name}</div>
                          <div className="text-xs text-gray-400">{option.description}</div>
                        </div>
                        {currentScope === option.id && (
                          <div className="w-2 h-2 rounded-full bg-white"></div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {settings.mic_enabled && (speechSupported || stt.isSupported) && (
                <button
                  onClick={toggleMic}
                  className={`rounded-xl p-2.5 transition ${isListening || stt.isRecording
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

              {(settings.mic_enabled && (speechSupported || stt.isSupported)) && (
                <div className="flex items-center">
                  <span
                    className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${micPhase === 'transcribing'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      : micPhase === 'recording' || micPhase === 'listening'
                        ? 'border-red-500/40 bg-red-500/10 text-red-300'
                        : 'border-gray-700 bg-gray-800/40 text-gray-400'
                      }`}
                    title={
                      micPhase === 'transcribing'
                        ? 'Transkrybuję'
                        : micPhase === 'recording'
                          ? 'Nagrywam'
                          : micPhase === 'listening'
                            ? 'Słucham'
                            : settings.auto_listen
                              ? `Auto-listen ON (${settings.auto_listen_silence_ms}ms)`
                              : 'Mikrofon idle'
                    }
                  >
                    {micPhase === 'transcribing'
                      ? 'Transkrypcja'
                      : micPhase === 'recording'
                        ? 'Nagrywam'
                        : micPhase === 'listening'
                          ? 'Słucham'
                          : settings.auto_listen
                            ? `Auto (${Math.round(settings.auto_listen_silence_ms / 100) / 10}s)`
                            : 'Idle'}
                  </span>
                </div>
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
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder="Wpisz adres, zapytanie lub powiedz głosem..."
                  disabled={
                    isListening || stt.isRecording || stt.isTranscribing
                  }
                  className="w-full rounded-xl bg-gray-800/80 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700/60 transition-all duration-200 focus:ring-2 focus:ring-broxeen-500/70 focus:shadow-[0_0_20px_rgba(14,165,233,0.12)] disabled:opacity-50"
                />

                {/* Quick Command History Dropdown */}
                {showQuickHistory && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
                    <QuickCommandHistory
                      onSelect={handleQuickHistorySelect}
                      maxItems={5}
                      selectedNetwork={selectedNetwork}
                    />
                  </div>
                )}

                {showAutocomplete && !showQuickHistory && (
                  <div
                    className="absolute bottom-full left-0 right-0 mb-2 z-50 overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
                    data-testid="chat-autocomplete"
                  >
                    <div className="max-h-56 overflow-y-auto py-1">
                      {autocompleteSuggestions.map((s, idx) => (
                        <button
                          key={`${s}-${idx}`}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleAutocompleteSelect(s);
                          }}
                          onMouseEnter={() => setAutocompleteActiveIndex(idx)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${idx === autocompleteActiveIndex
                            ? 'bg-broxeen-600/30 text-white'
                            : 'text-gray-200 hover:bg-gray-700/50'
                            }`}
                          data-testid={`chat-autocomplete-item-${idx}`}
                        >
                          <span className="truncate">{s}</span>
                          {idx === autocompleteActiveIndex && (
                            <span className="ml-3 shrink-0 text-[11px] text-gray-400">TAB</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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

          </div>
        </div>
      </div>
    </>
  );
}

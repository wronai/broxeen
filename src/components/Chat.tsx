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
  Wifi,
  ChevronDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { ActionSuggestions } from "./ActionSuggestions";
import { QuickCommands } from "./QuickCommands";
import type { AudioSettings } from "../domain/audioSettings";
import { type ChatMessage } from "../domain/chatEvents";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/llmClient";
import { errorReporting, capturePluginError, captureNetworkError } from "../utils/errorReporting";

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

  const [input, setInput] = useState("");
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string>("");
  const [showNetworkSelector, setShowNetworkSelector] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkConfig | null>(null);
  const [pendingNetworkQuery, setPendingNetworkQuery] = useState<string>("");
  const [showCommandHistory, setShowCommandHistory] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [showQuickHistory, setShowQuickHistory] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<CameraPreviewProps['camera'][]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraPreviewProps['camera'] | null>(null);
  const [currentScope, setCurrentScope] = useState<QueryScope>('local');
  const [showScopeSelector, setShowScopeSelector] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatLogger = logger.scope("chat:ui");

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

  // Input focus and quick history logic
  useEffect(() => {
    // Show quick history when input is focused and empty
    if (inputFocused && !input.trim() && messages.length === 0) {
      setShowQuickHistory(true);
    } else {
      setShowQuickHistory(false);
    }
  }, [inputFocused, input, messages.length]);

  // Hide quick history when user starts typing
  useEffect(() => {
    if (input.trim()) {
      setShowQuickHistory(false);
    }
  }, [input]);

  // Network selection handlers
  const handleNetworkSelect = (networkConfig: NetworkConfig) => {
    setSelectedNetwork(networkConfig);
    setShowNetworkSelector(false);
    chatLogger.info('Network selected', { 
      scope: networkConfig.scope, 
      name: networkConfig.name 
    });
    
    // Add to history
    addToNetworkHistory(networkConfig.scope, networkConfig.name, '192.168.1.0/24');
    
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

  const addToNetworkHistory = (scope: NetworkScope, name: string, address: string) => {
    try {
      const historyKey = 'broxeen_network_history';
      const savedHistory = localStorage.getItem(historyKey);
      let history: NetworkHistoryItem[] = [];
      
      if (savedHistory) {
        history = JSON.parse(savedHistory);
      }
      
      const newItem: NetworkHistoryItem = {
        id: Date.now().toString(),
        address,
        name,
        scope,
        lastUsed: Date.now(),
        usageCount: 1,
        description: `${scope === 'local' ? 'Sieć lokalna' : scope === 'global' ? 'Internet globalny' : scope === 'tor' ? 'Sieć Tor' : scope === 'vpn' ? 'VPN' : 'Custom'} - ${address}`
      };
      
      // Remove existing entry with same address
      const existingIndex = history.findIndex(item => item.address === address);
      let newHistory = [...history];
      
      if (existingIndex >= 0) {
        newHistory[existingIndex] = {
          ...newHistory[existingIndex],
          lastUsed: Date.now(),
          usageCount: newHistory[existingIndex].usageCount + 1
        };
      } else {
        newHistory.unshift(newItem);
      }
      
      // Keep only last 10 entries
      newHistory = newHistory.slice(0, 10);
      
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    } catch (error) {
      chatLogger.error('Failed to save network history', error);
    }
  };

  const addToCommandHistory = (command: string, result?: string, category: CommandHistoryItem['category'] = 'other', success: boolean = true) => {
    try {
      const historyKey = 'broxeen_command_history';
      const savedHistory = localStorage.getItem(historyKey);
      let history: CommandHistoryItem[] = [];
      
      if (savedHistory) {
        history = JSON.parse(savedHistory);
      }
      
      const newItem: CommandHistoryItem = {
        id: Date.now().toString(),
        command: command.trim(),
        timestamp: Date.now(),
        result,
        category,
        success
      };
      
      // Remove existing entry with same command
      const existingIndex = history.findIndex(item => item.command === newItem.command);
      let newHistory = [...history];
      
      if (existingIndex >= 0) {
        // Update existing entry
        newHistory[existingIndex] = {
          ...newHistory[existingIndex],
          timestamp: Date.now(),
          result,
          category,
          success
        };
      } else {
        // Add new entry
        newHistory.unshift(newItem);
      }
      
      // Keep only last 50 entries
      newHistory = newHistory.slice(0, 50);
      
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    } catch (error) {
      chatLogger.error('Failed to save command history', error);
    }
  };

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
        id: Date.now(), 
        role: "user", 
        text: userQuery 
      },
    });

    // Add suggestions message from assistant
    const suggestionsId = Date.now() + 1;
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
        id: Date.now(),
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
        id: Date.now(), 
        role: "user", 
        text: userQuery 
      },
    });

    // Add network selection message from assistant
    const networkSelectionId = Date.now() + 1;
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
          currentCamera = {
            id: cameraMatch[2],
            name: cameraMatch[1].trim(),
            ip: cameraMatch[2],
            status: 'online',
            type: 'IP Camera',
            streamUrl: `rtsp://${cameraMatch[2]}:554/stream`,
            snapshot: `https://picsum.photos/seed/${cameraMatch[2]}/640/480.jpg`
          };
        }
      }
    }
    
    // Add the last camera if exists
    if (currentCamera) {
      cameras.push(currentCamera as CameraPreviewProps['camera']);
    }
    
    // If no cameras found, create mock cameras for testing
    if (cameras.length === 0 && result.includes('Znaleziono')) {
      cameras.push(
        {
          id: '192.168.1.45',
          name: 'Kamera Hikvision',
          ip: '192.168.1.45',
          status: 'online',
          type: 'IP Camera',
          streamUrl: 'rtsp://192.168.1.45:554/stream',
          snapshot: 'https://picsum.photos/seed/camera1/640/480.jpg'
        },
        {
          id: '192.168.1.67',
          name: 'Kamera Reolink',
          ip: '192.168.1.67',
          status: 'online',
          type: 'IP Camera',
          streamUrl: 'rtsp://192.168.1.67:554/stream',
          snapshot: 'https://picsum.photos/seed/camera2/640/480.jpg'
        }
      );
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
        id: Date.now(),
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
        id: Date.now(),
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
      payload: { id: Date.now(), role: "user", text: query },
    });

    try {
      // Use plugin system to handle the query with scope information
      const result = await ask(query, isListening || stt.isRecording ? "voice" : "text", currentScope);
      
      chatLogger.info("Plugin system result", {
        status: result.status,
        contentBlocks: result.content.length,
        executionTime: result.metadata.duration_ms,
        scope: currentScope,
      });

      if (result.status === 'success') {
        // Convert plugin content blocks to chat messages
        let fullResult = '';
        for (const block of result.content) {
          let messageText = '';
          let messageType: 'content' | 'image' = 'content';
          
          if (block.type === 'text') {
            messageText = block.data as string;
          } else if (block.type === 'image') {
            messageText = block.data as string;
            messageType = 'image';
          } else {
            messageText = String(block.data);
          }

          fullResult += messageText + ' ';
          eventStore.append({
            type: "message_added",
            payload: {
              id: Date.now() + Math.random(), // Ensure unique IDs for multiple blocks
              role: "assistant",
              text: messageText,
              type: messageType,
              title: block.title,
            },
          });
        }
        
        // Auto-play TTS for plugin responses (bypass loading-wait mechanism)
        if (settings.tts_enabled && tts.isSupported && fullResult.trim().length > 0) {
          tts.speak(fullResult.trim().slice(0, 3000));
        }

        // Add to command history
        addToCommandHistory(query, fullResult.trim(), categorizeCommand(query), true);
      } else {
        // Handle error case
        const errorMessage = (result.content[0]?.data as string) ?? "Wystąpił błąd podczas przetwarzania zapytania.";
        eventStore.append({
          type: "message_added",
          payload: {
            id: Date.now(),
            role: "assistant",
            text: errorMessage,
            type: "error",
          },
        });
        
        // Add to command history
        addToCommandHistory(query, errorMessage, categorizeCommand(query), false);
      }
    } catch (error) {
      chatLogger.error("Plugin system execution failed", error);
      
      // Show error message instead of fallback to suggestions
      eventStore.append({
        type: "message_added",
        payload: {
          id: Date.now(),
          role: "assistant",
          text: `Wystąpił błąd podczas przetwarzania zapytania przez system pluginów: ${error instanceof Error ? error.message : 'Nieznany błąd'}`,
          type: "error",
        },
      });
      
      // Add to command history
      addToCommandHistory(query, "Błąd systemu pluginów", categorizeCommand(query), false);
    }
  };

  const handleLlmQuestion = async (question: string) => {
    await commands.sendMessage.execute(question, pageContent);
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
            {/* Header with copy button, watch badge and network indicator */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <h2 className="text-lg font-semibold text-gray-200">Czat</h2>
                {selectedNetwork && (
                  <div className="flex items-center space-x-2 px-3 py-1 bg-gray-700 rounded-full">
                    <Wifi className="w-4 h-4 text-broxeen-400" />
                    <span className="text-sm text-gray-300">{selectedNetwork.name}</span>
                    <button
                      onClick={() => setSelectedNetwork(null)}
                      className="text-gray-400 hover:text-gray-200"
                      title="Zmień sieć"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <WatchBadge 
                  // TODO: Pass watchManager when reactive system is integrated
                  // watchManager={watchManager}
                  className="mr-2"
                />
                <button
                  onClick={copyChatContent}
                  className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
                  title="Kopiuj zawartość czatu"
                >
                  <Copy size={16} />
                  <span>Kopiuj</span>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* Command History - show when no messages */}
              {messages.length === 0 && showCommandHistory && (
                <CommandHistory 
                  onSelect={handleCommandHistorySelect}
                  className="mb-6"
                  maxItems={10}
                />
              )}

              {messages.length === 0 && !showCommandHistory && (
                <>
                  <div className="flex mt-20 flex-col items-center justify-center text-center fade-in">
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-broxeen-400 to-emerald-400 sm:text-5xl">
                      Witaj w Broxeen
                    </h1>
                    <p className="max-w-xl text-lg text-gray-400">
                      Wpisz adres URL, zapytaj o coś lub kliknij ikonę mikrofonu,
                      aby zacząć.
                    </p>
                    <button
                      onClick={() => setShowCommandHistory(true)}
                      className="mt-4 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
                    >
                      Pokaż historię komend
                    </button>
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
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid="message"
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
                          <div className="text-sm leading-relaxed">
                            {msg.pageTitle && (
                              <div className="font-bold mb-2">
                                {msg.pageTitle}
                              </div>
                            )}
                            <div className="prose prose-invert max-w-none prose-sm">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                  // Customize styling for common elements
                                  p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                                  strong: ({children}) => <strong className="font-bold text-white">{children}</strong>,
                                  em: ({children}) => <em className="italic">{children}</em>,
                                  code: ({className, children}) => {
                                    const isInline = !className?.includes('language-');
                                    return isInline ? 
                                      <code className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code> :
                                      <code className="block bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>;
                                  },
                                  ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                  ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                  li: ({children}) => <li className="text-gray-200">{children}</li>,
                                a: ({href, children}) => (
                                  <a 
                                    href={href} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-400 hover:text-blue-300 underline"
                                  >
                                    {children}
                                  </a>
                                ),
                                blockquote: ({children}) => (
                                  <blockquote className="border-l-4 border-gray-600 pl-4 italic text-gray-300 my-2">
                                    {children}
                                  </blockquote>
                                ),
                              }}
                            >
                              {msg.text}
                            </ReactMarkdown>
                            </div>
                          </div>
                        )}

                        {/* Inline Action Hints — parsed from plugin response text */}
                        {msg.role === "assistant" && !msg.loading && (() => {
                          // Only parse hints from an explicit section to avoid false-positives
                          // from normal markdown bullet lists.
                          const markers = [
                            '💡 **Sugerowane akcje:**',
                            '💡 **Komendy:**',
                            '💡 Komendy:',
                            '💡 Komendy'
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
                          const hints: Array<{ query: string; label: string }> = [];
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
                            hints.push({ query, label });
                            if (hints.length >= 6) break;
                          }

                          if (hints.length === 0) return null;
                          return (
                            <div className="mt-3 flex flex-wrap gap-2" data-testid="action-hints">
                              {hints.map((hint) => (
                                <button
                                  key={hint.query}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSubmit(hint.query);
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
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                                      strong: ({children}) => <strong className="font-bold text-white">{children}</strong>,
                                      em: ({children}) => <em className="italic">{children}</em>,
                                      code: ({className, children}) => {
                                        const isInline = !className?.includes('language-');
                                        return isInline ? 
                                          <code className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono">{children}</code> :
                                          <code className="block bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>;
                                      },
                                      ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                                      ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                                      li: ({children}) => <li className="text-gray-200">{children}</li>,
                                      a: ({href, children}) => (
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
            {/* Scope Selector */}
            <div className="mb-3 flex items-center justify-between scope-selector-container">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Zakres:</span>
                <button
                  onClick={() => setShowScopeSelector(!showScopeSelector)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                    currentScope === 'local' 
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
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                          currentScope === option.id
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
                  onFocus={handleInputFocus}
                  onBlur={handleInputBlur}
                  placeholder="Wpisz adres, zapytanie lub powiedz głosem..."
                  disabled={
                    isListening || stt.isRecording || stt.isTranscribing
                  }
                  className="w-full rounded-xl bg-gray-800 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700 transition focus:ring-broxeen-500 disabled:opacity-50"
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

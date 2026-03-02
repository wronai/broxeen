import { useCallback } from "react";
import { type CameraPreviewProps } from "../components/CameraPreview";
import {
  buildApiKeyPrompt,
  buildConfigOverviewPrompt,
  buildMonitorConfigPrompt,
  buildNetworkConfigPrompt,
  buildModelSelectionPrompt,
} from "../components/ChatConfigPrompt";
import type { ConfigPromptData, ConfigAction } from "../components/ChatConfigPrompt";
import { type NetworkConfig, type NetworkScope } from "../components/NetworkSelector";
import { type CommandHistoryItem } from "../components/CommandHistory";
import { processRegistry } from "../core/processRegistry";
import { configStore } from "../config/configStore";
import { looksLikeUrl } from "../lib/phonetic";
import { isTauriRuntime } from "../lib/runtime";
import { logger } from "../lib/logger";
import type { QueryScope } from "../components/ChatInput";
import type { EventStore } from "../domain/eventStore";
import type { AudioSettings } from "../domain/audioSettings";

const dispatchLogger = logger.scope("chat:dispatch");

// ─── Pure helpers ────────────────────────────────────────────────────

/** Data-driven config command route table: [route_key, pattern] */
const CONFIG_COMMAND_ROUTES: ReadonlyArray<[string, RegExp]> = [
  ['monitor', /^(konfiguruj\s*monitoring|monitoring\s*konfiguracja|ustaw\s*monitoring)$/i],
  ['ai', /konfiguruj\s*(ai|llm|model)|config\s*(ai|llm)|ustaw\s*(ai|model|klucz)/i],
  ['network', /^(konfiguruj\s*sie[cć]|konfiguracja\s*sieci|ustaw\s*sie[cć])$/i],
  ['reset', /reset.*konfig|resetuj.*konfig|przywróć.*domyśl|restore.*default/i],
  ['help', /^(pomoc|help|co\s+umiesz|co\s+potrafisz|jak\s+zacząć|jak\s+zaczac|start)$/i],
  ['overview', /^(konfigur|config|ustawieni|settings|setup)/i],
];

function handleConfigCommand(query: string): { text: string; prompt: ConfigPromptData } | null {
  const lower = query.toLowerCase().trim();

  let route: string | null = null;
  for (const [key, pattern] of CONFIG_COMMAND_ROUTES) {
    if (pattern.test(lower)) {
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
    const helpActions: ConfigAction[] = [
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
        layout: 'cards' as const,
      },
    };
  }

  return null;
}

export function addScopePrefix(query: string, scope: QueryScope): string {
  const hasPrefix = /^(local|public|tor|vpn|ssh)\$\s/.test(query);
  if (hasPrefix) return query;

  const prefixMap = {
    'local': 'local$',
    'internet': 'public$',
    'tor': 'tor$',
    'vpn': 'vpn$'
  };

  const prefix = prefixMap[scope];
  return prefix ? `${prefix} ${query}` : query;
}

export function categorizeCommand(command: string): CommandHistoryItem['category'] {
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
}

function checkIfAmbiguousQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();

  const ambiguousPatterns = [
    lowerQuery.length < 5,
    /^(pomoc|help|co|jak|dlaczego|test|sprawdz|pokaz|zrob|zrób|wejdź|otwórz|znajdź|szukaj|start|startuj|uruchom|włącz|wyłącz|stop|koniec)$/,
    /^(co masz|jak działa|pokaż mi|wejdź na|otwórz|sprawdź|czy możesz|możesz|jaka jest|ile jest|gdzie jest)$/,
    /^(sieć|kamera|strona|urządzenie|system|aplikacja|program|komputer|internet|wifi|poczta|google|youtube|facebook)$/,
    /^(pokaż|zobacz|wejdź|otwórz|uruchom|włącz|sprawdź|znajdź|szukaj|testuj|odśwież|reload|refresh)$/,
  ];

  return ambiguousPatterns.some(pattern => {
    if (typeof pattern === 'boolean') return pattern;
    if (pattern instanceof RegExp) return pattern.test(lowerQuery);
    return false;
  });
}

function checkIfNetworkQuery(query: string): boolean {
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
}

function containsUrl(query: string): boolean {
  const urlPatterns = [
    /https?:\/\/[^\s]+/i,
    /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
  ];

  return urlPatterns.some(pattern => pattern.test(query));
}

function getAmbiguousQueryText(query: string) {
  return `Nie jestem pewien, co dokładnie chcesz zrobić z zapytaniem: **"${query}"**

Oto kilka możliwości, które mogą Cię interesować:

Wybierz jedną z poniższych opcji, aby kontynuować:`;
}

function getSuggestionsForQuery(query: string) {
  const lowerQuery = query.toLowerCase();
  const suggestions: Array<{ action: string; text: string; description: string; query: string }> = [];

  // File-related suggestions
  if (lowerQuery.includes('pdf') || lowerQuery.includes('plik') || lowerQuery.includes('dokument')) {
    suggestions.push(
      { action: 'find_files', text: '📄 Znajdź pliki PDF', description: 'Przeszukaj wszystkie dokumenty PDF w systemie', query: 'znajdź pliki pdf' },
      { action: 'find_documents', text: '📂 Przeszukaj dokumenty', description: 'Znajdź pliki w folderze Dokumenty i Pulpit', query: 'znajdź dokumenty' },
      { action: 'recent_files', text: '🕐 Najnowsze pliki', description: 'Pokaż ostatnio modyfikowane dokumenty', query: 'znajdź ostatnie dokumenty' }
    );
  }

  // Network-related suggestions
  if (lowerQuery.includes('sieci') || lowerQuery.includes('kamer') || lowerQuery.includes('urządzen')) {
    suggestions.push(
      { action: 'network_scan', text: '🔍 Skanuj sieć w poszukiwaniu kamer', description: 'Znajdź wszystkie kamery IP w Twojej sieci lokalnej', query: 'znajdź kamere w sieci' },
      { action: 'network_global', text: '🌐 Przeszukaj internet globalny', description: 'Wyszukaj publiczne urządzenia w sieci', query: 'skanuj siec globalnie' },
      { action: 'camera_status', text: '📷 Sprawdź status kamer', description: 'Zobacz które kamery są online', query: 'sprawdz status kamer' }
    );
  }

  // Browse-related suggestions
  if (lowerQuery.includes('stron') || lowerQuery.includes('www') || lowerQuery.includes('http')) {
    suggestions.push(
      { action: 'browse_url', text: '🌍 Przeglądaj stronę internetową', description: 'Otwórz i przeczytaj zawartość strony', query: 'przeglądaj stronę' },
      { action: 'search_web', text: '🔎 Wyszukaj w internecie', description: 'Znajdź informacje w wyszukiwarce', query: 'wyszukaj w internecie' }
    );
  }

  // General help suggestions
  suggestions.push(
    { action: 'help', text: '❓ Pokaż pomoc', description: 'Zobacz dostępne komendy i funkcje', query: 'pomoc' },
    { action: 'chat', text: '💬 Porozmawiaj ze mną', description: 'Zadaj pytanie i porozmawiaj z asystentem', query: 'jak mogę Ci pomóc?' }
  );

  return suggestions.slice(0, 5);
}

function getNetworkSelectionText() {
  return `Skanuję kamery w sieci:

Skanowanie urządzeń w sieci, takich jak kamery IP, jest standardową procedurą podczas audytów bezpieczeństwa lub konfiguracji domowego monitoringu. Pozwala to upewnić się, że wszystkie urządzenia są widoczne i odpowiednio zabezpieczone.

**Wybierz zakres sieci, który chcesz przeskanować:**`;
}

function parseCameraResults(result: string): CameraPreviewProps['camera'][] {
  const cameras: CameraPreviewProps['camera'][] = [];
  const lines = result.split('\n');
  let currentCamera: Partial<CameraPreviewProps['camera']> | null = null;

  for (const line of lines) {
    if (line.includes('Kamera') || line.includes('kamera')) {
      if (currentCamera) {
        cameras.push(currentCamera as CameraPreviewProps['camera']);
      }

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

  if (currentCamera) {
    cameras.push(currentCamera as CameraPreviewProps['camera']);
  }

  return cameras;
}

const RECOVERABLE_ERROR_PATTERNS = [
  /\bcommand\b.*\bnot found\b/i,
  /\bno handler registered\b/i,
  /\bhandler\b.*\bnot found\b/i,
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\betimedout\b/i,
  /\beconnrefused\b/i,
  /\benetunreach\b/i,
  /\bnetwork is unreachable\b/i,
  /\bpermission denied\b/i,
  /\beacces\b/i,
  /\bffmpeg\b.*\bnot found\b/i,
  /\bno such file or directory\b/i,
];

function looksLikeRecoverableError(msg: string): boolean {
  return RECOVERABLE_ERROR_PATTERNS.some(p => p.test(msg));
}

// ─── Hook ────────────────────────────────────────────────────────────

export interface UseChatDispatchDeps {
  eventStore: EventStore;
  ask: (query: string, inputType?: "api" | "voice" | "text", scope?: string) => Promise<any>;
  settings: AudioSettings;
  tts: { isSupported: boolean; speak: (text: string) => void };
  isListening: boolean;
  sttIsRecording: boolean;
  currentScope: QueryScope;
  input: string;
  pendingNetworkQuery: string;
  discoveredCameras: CameraPreviewProps['camera'][];
  nextMessageId: () => number;
  addToCommandHistory: (query: string, result?: string, category?: CommandHistoryItem['category'], success?: boolean) => void;
  // State setters
  setInput: (v: string) => void;
  setShowCommandHistory: (v: boolean) => void;
  setExpandedLive: (v: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string } | null) => void;
  setSelectedNetwork: (v: NetworkConfig | null) => void;
  setShowNetworkSelector: (v: boolean) => void;
  setPendingNetworkQuery: (v: string) => void;
  setSelectedCamera: (v: CameraPreviewProps['camera'] | null) => void;
}

export function useChatDispatch(deps: UseChatDispatchDeps) {
  const {
    eventStore,
    ask,
    settings,
    tts,
    isListening,
    sttIsRecording,
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
  } = deps;

  const handleSubmit = useCallback(async (text?: string) => {
    const originalQuery = (text || input).trim();
    if (!originalQuery) {
      dispatchLogger.debug("Ignoring empty submit");
      return;
    }

    // Add scope prefix to the query
    const query = addScopePrefix(originalQuery, currentScope);

    // Hide command history when user submits
    setShowCommandHistory(false);

    setInput("");
    dispatchLogger.info("Handling submit", { queryLength: query.length });

    // Emit user message directly to store (without prefix for display)
    eventStore.append({
      type: "message_added",
      payload: { id: nextMessageId(), role: "user", text: originalQuery },
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
      const isVoiceInput = isListening || sttIsRecording;
      const result = await ask(query, isVoiceInput ? "voice" : "text", currentScope);

      // Remove thinking message once we have a response
      eventStore.append({
        type: "message_updated",
        payload: { id: thinkingId, updates: { type: "content", text: "", thinkingInfo: undefined } },
      });

      dispatchLogger.info("Plugin system result", {
        status: result.status,
        contentBlocks: result.content.length,
        executionTime: result.metadata.duration_ms,
        scope: currentScope,
        pluginId: result.pluginId,
        isVoiceInput,
      });

      // For voice input that falls back to chat plugin, show action suggestions instead of LLM hallucination
      if (result.status === 'success' && isVoiceInput && result.pluginId === 'chat') {
        dispatchLogger.info("Voice input fell back to chat plugin, generating action suggestions", { query });
        try {
          const { generateFallback } = await import('../core/fallbackHandler');
          const fallback = await generateFallback({
            query,
            detectedIntent: 'voice:unknown',
            scope: currentScope,
          });

          eventStore.append({
            type: "message_added",
            payload: {
              id: nextMessageId(),
              role: "assistant",
              text: `🎤 Transkrypcja: "${query}"\n\n${fallback.text}`,
              type: "config_prompt",
              configPrompt: fallback.configPrompt,
            },
          });
          addToCommandHistory(query, fallback.text, 'other', true);
          processRegistry.complete(processId);
          processRegistry.remove(processId);
          return;
        } catch (fallbackError) {
          dispatchLogger.warn("Failed to generate fallback suggestions", { error: fallbackError });
        }
      }

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

        const hasCameraLiveBlock = result.content.some((block: any) => {
          if (block.type !== 'structured') return false;
          try {
            const parsed = JSON.parse(String(block.data ?? '')) as any;
            return parsed?.kind === 'camera_live' && typeof parsed.url === 'string' && typeof parsed.cameraId === 'string';
          } catch {
            return false;
          }
        });

        const contentBlocks = hasCameraLiveBlock
          ? result.content.filter((b: any) => b.type === 'structured')
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
            continue;
          } else if (block.type === 'structured') {
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

        if (looksLikeRecoverableError(errorMessage)) {
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

      if (looksLikeRecoverableError(errorMessage)) {
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

      addToCommandHistory(query, errorMessage, categorizeCommand(query), false);

      processRegistry.fail(processId, errorMessage);
      processRegistry.remove(processId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, currentScope, isListening, sttIsRecording, settings.tts_enabled, tts, eventStore, ask, nextMessageId, addToCommandHistory, setInput, setShowCommandHistory, setExpandedLive]);

  const handleCommandHistorySelect = useCallback((command: string) => {
    dispatchLogger.info('Command selected from history', { command });
    setInput(command);
    setShowCommandHistory(false);

    // Auto-execute the command
    setTimeout(() => {
      handleSubmit(command);
    }, 100);
  }, [handleSubmit, setInput, setShowCommandHistory]);

  const handleSuggestionClick = useCallback((suggestion: any) => {
    dispatchLogger.info('Suggestion clicked', { action: suggestion.action, query: suggestion.query });

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

    setTimeout(() => {
      handleSubmit(suggestion.query);
    }, 500);
  }, [handleSubmit, eventStore, nextMessageId]);

  const handleNetworkOptionClick = useCallback((scope: string, name: string) => {
    dispatchLogger.info('Network option clicked', { scope, name });

    const networkConfig = {
      scope: scope as NetworkScope,
      name,
      description: `Wybrano: ${name}`,
      icon: null,
      features: []
    } as NetworkConfig;

    setSelectedNetwork(networkConfig);
    setShowNetworkSelector(false);

    if (pendingNetworkQuery) {
      setInput(pendingNetworkQuery);
      handleSubmit(pendingNetworkQuery);
      setPendingNetworkQuery("");
    }
  }, [handleSubmit, pendingNetworkQuery, setInput, setSelectedNetwork, setShowNetworkSelector, setPendingNetworkQuery]);

  const sendAmbiguousQuerySuggestions = useCallback(async (userQuery: string) => {
    dispatchLogger.info('Sending suggestions for ambiguous query', { userQuery });

    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "user",
        text: userQuery
      },
    });

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

    (window as any).broxeenSuggestionsId = suggestionsId;
  }, [eventStore, nextMessageId]);

  const sendNetworkSelectionMessage = useCallback(async (userQuery: string) => {
    dispatchLogger.info('Sending network selection message', { userQuery });

    eventStore.append({
      type: "message_added",
      payload: {
        id: nextMessageId(),
        role: "user",
        text: userQuery
      },
    });

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

    (window as any).broxeenNetworkSelectionId = networkSelectionId;
  }, [eventStore, nextMessageId]);

  const handleCameraSelect = useCallback((camera: CameraPreviewProps['camera']) => {
    dispatchLogger.info('Camera selected', { camera: camera.name });
    setSelectedCamera(camera);

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
  }, [eventStore, nextMessageId, setSelectedCamera]);

  const handleCameraAnalysisComplete = useCallback((cameraId: string, analysis: string) => {
    dispatchLogger.info('Camera analysis completed', { cameraId, analysis });

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
  }, [eventStore, nextMessageId, discoveredCameras]);

  const handleCameraStreamStart = useCallback((camera: CameraPreviewProps['camera']) => {
    dispatchLogger.info('Camera stream started', { camera: camera.name });
  }, []);

  return {
    handleSubmit,
    handleCommandHistorySelect,
    handleSuggestionClick,
    handleNetworkOptionClick,
    handleCameraSelect,
    handleCameraAnalysisComplete,
    handleCameraStreamStart,
    sendAmbiguousQuerySuggestions,
    sendNetworkSelectionMessage,
    // Re-export pure helpers for use in Chat.tsx if needed
    categorizeCommand,
    parseCameraResults,
    checkIfAmbiguousQuery,
    checkIfNetworkQuery,
    containsUrl,
  };
}

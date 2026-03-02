import { useState, useRef, useEffect, useMemo } from "react";
import {
  Send,
  Mic,
  MicOff,
  Ear,
  EarOff,
  Globe,
  Search,
  Zap,
  Wifi,
  ChevronDown,
} from "lucide-react";
import { QuickCommandHistory } from "./QuickCommandHistory";
import type { NetworkConfig } from "./NetworkSelector";
import type { AudioSettings } from "../domain/audioSettings";
import { logger } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";

export type QueryScope = 'local' | 'internet' | 'tor' | 'vpn';

interface ScopeOption {
  id: QueryScope;
  name: string;
  icon: React.ReactNode;
  description: string;
}

export interface SttState {
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
}

export type MicPhase = 'idle' | 'recording' | 'listening' | 'transcribing';

export interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (text?: string) => void;
  settings: AudioSettings;
  currentScope: QueryScope;
  onScopeChange: (scope: QueryScope) => void;
  isListening: boolean;
  stt: SttState;
  speechSupported: boolean;
  wakeWordEnabled: boolean;
  onWakeWordToggle: (enabled: boolean) => void;
  micPhase: MicPhase;
  toggleMic: () => void;
  selectedNetwork: NetworkConfig | null;
  hasNonSystemMessages: boolean;
  getRecentQueries: () => string[];
}

const chatLogger = logger.scope("chat:input");

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

const baseAutocompleteSuggestions = [
  'skanuj sieć',
  'znajdź kamery w sieci',
  'przeglądaj ',
  'ssh ',
  'pokaż dyski',
  'szukaj plików ',
  'konfiguracja',
  'konfiguruj ai',
  'konfiguruj sieć',
  'konfiguruj monitoring',
  'pomoc',
  'konfiguruj email',
  'sprawdź pocztę',
  'znajdź pliki na pulpicie',
  'lista procesów',
  'monitoruj ',
  'historia sieci',
  'eksportuj urządzenia',
];

export function ChatInput({
  input,
  onInputChange,
  onSubmit,
  settings,
  currentScope,
  onScopeChange,
  isListening,
  stt,
  speechSupported,
  wakeWordEnabled,
  onWakeWordToggle,
  micPhase,
  toggleMic,
  selectedNetwork,
  hasNonSystemMessages,
  getRecentQueries,
}: ChatInputProps) {
  const [showScopeSelector, setShowScopeSelector] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteActiveIndex, setAutocompleteActiveIndex] = useState(0);
  const [showQuickHistory, setShowQuickHistory] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);

  const autocompleteSuggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!inputFocused) return [];
    if (!q) return [];
    // Disable autocomplete when microphone is active to prevent conflicts
    if (isListening || stt.isRecording || stt.isTranscribing) return [];
    // Also disable when wake word is enabled to avoid interference
    if (wakeWordEnabled) return [];

    const recent = getRecentQueries();
    const candidates = [
      ...recent,
      ...baseAutocompleteSuggestions,
    ];

    const seen = new Set<string>();
    const filtered: string[] = [];
    for (const c of candidates) {
      const lower = c.toLowerCase();
      if (lower === q) continue;
      if (!lower.startsWith(q) && !lower.includes(q)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      filtered.push(c);
      if (filtered.length >= 8) break;
    }
    return filtered;
  }, [input, inputFocused, isListening, stt.isRecording, stt.isTranscribing, wakeWordEnabled, getRecentQueries]);

  useEffect(() => {
    if (!inputFocused) {
      setShowAutocomplete(false);
      return;
    }
    if (autocompleteSuggestions.length > 0) {
      setShowAutocomplete(true);
      setAutocompleteActiveIndex((idx) => {
        if (idx < 0) return -1;
        if (idx >= autocompleteSuggestions.length) return -1;
        return idx;
      });
    } else {
      setShowAutocomplete(false);
    }
  }, [autocompleteSuggestions, inputFocused]);

  // Show quick history when input is focused and empty
  useEffect(() => {
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

  const handleInputFocus = () => {
    setInputFocused(true);
  };

  const handleInputBlur = () => {
    // Small delay to allow click events on autocomplete to fire
    setTimeout(() => {
      setInputFocused(false);
    }, 200);
  };

  const handleAutocompleteSelect = (choice: string) => {
    onInputChange(choice);
    setShowAutocomplete(false);
    setTimeout(() => {
      const inputElement = document.querySelector("input[type='text']") as HTMLInputElement | null;
      if (inputElement) {
        inputElement.focus();
        inputElement.selectionStart = inputElement.selectionEnd = choice.length;
      }
    }, 0);
  };

  const handleQuickHistorySelect = (command: string) => {
    chatLogger.info('Command selected from quick history', { command });
    onInputChange(command);
    setShowQuickHistory(false);
    setInputFocused(true);

    // Focus back to input
    setTimeout(() => {
      const inputElement = document.querySelector("input[type='text']") as HTMLInputElement | null;
      if (inputElement) {
        inputElement.focus();
        inputElement.selectionStart = inputElement.selectionEnd = command.length;
      }
    }, 50);

    // Auto-execute the command after a brief delay
    setTimeout(() => {
      onSubmit(command);
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      const choice = autocompleteSuggestions[Math.max(0, Math.min(autocompleteActiveIndex, autocompleteSuggestions.length - 1))];
      if (choice) {
        onInputChange(choice);
        setAutocompleteActiveIndex(-1);
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

    if (e.key === 'Escape' && showAutocomplete) {
      setShowAutocomplete(false);
      setAutocompleteActiveIndex(-1);
      return;
    }

    if (e.key === 'ArrowDown' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      setAutocompleteActiveIndex((idx) => idx === -1 ? 0 : (idx + 1) % autocompleteSuggestions.length);
      return;
    }

    if (e.key === 'ArrowUp' && showAutocomplete && autocompleteSuggestions.length > 0) {
      e.preventDefault();
      setAutocompleteActiveIndex((idx) => idx <= 0 ? autocompleteSuggestions.length - 1 : idx - 1);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      // If autocomplete is open and user actively selected an item, submit that item.
      if (showAutocomplete && autocompleteSuggestions.length > 0 && autocompleteActiveIndex >= 0) {
        const choice = autocompleteSuggestions[autocompleteActiveIndex];
        if (choice) {
          setShowAutocomplete(false);
          setAutocompleteActiveIndex(-1);
          onInputChange(""); // clear input before submit
          onSubmit(choice);
          return;
        }
      }

      // Otherwise, submit whatever the user typed.
      onSubmit();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      // Only trigger history navigation if autocomplete is NOT showing
      if (!showAutocomplete) {
        const history = inputHistoryRef.current;
        if (history.length > 0) {
          // Move index backwards (older)
          const nextIndex =
            historyIndexRef.current === -1
              ? history.length - 1
              : Math.max(0, historyIndexRef.current - 1);

          historyIndexRef.current = nextIndex;
          onInputChange(history[nextIndex]);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Only trigger history navigation if autocomplete is NOT showing
      if (!showAutocomplete) {
        const history = inputHistoryRef.current;
        if (historyIndexRef.current !== -1) {
          // Move index forwards (newer)
          const nextIndex = historyIndexRef.current + 1;
          if (nextIndex >= history.length) {
            // Reached the end, clear input
            historyIndexRef.current = -1;
            onInputChange("");
          } else {
            historyIndexRef.current = nextIndex;
            onInputChange(history[nextIndex]);
          }
        }
      }
      return;
    }
  };

  // Track input history for arrow key navigation
  useEffect(() => {
    // When input changes and it's not from history navigation, reset history index
    if (historyIndexRef.current === -1 && input.trim()) {
      // Don't add to history here — that's done on submit in Chat.tsx
    }
  }, [input]);

  return (
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
                      onScopeChange(option.id);
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
          {isTauriRuntime() && settings.mic_enabled && stt.isSupported && (
            <button
              onClick={() => onWakeWordToggle(!wakeWordEnabled)}
              className={`rounded-xl p-2.5 transition ${wakeWordEnabled
                ? "bg-green-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              title={wakeWordEnabled ? "Wyłącz nasłuchiwanie 'heyken'" : "Włącz nasłuchiwanie 'heyken' (mów głośno aby aktywować)"}
            >
              {wakeWordEnabled ? <Ear size={20} /> : <EarOff size={20} />}
            </button>
          )}

          {settings.mic_enabled && (
            <button
              onClick={toggleMic}
              className={`rounded-xl p-2.5 transition ${isListening || stt.isRecording
                ? "animate-pulse bg-green-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              title={
                isListening || stt.isRecording
                  ? "Zatrzymaj mikrofon"
                  : speechSupported
                    ? "Włącz mikrofon"
                    : "Włącz mikrofon (STT w chmurze)"
              }
            >
              {isListening || stt.isRecording ? (
                <MicOff size={20} />
              ) : (
                <Mic size={20} />
              )}
            </button>
          )}

          {settings.mic_enabled && (
            <div className="flex items-center">
              <span
                className={`ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${micPhase === 'transcribing'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : micPhase === 'recording' || micPhase === 'listening'
                    ? 'border-green-500/40 bg-green-500/10 text-green-300'
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
                          : 'Mikrofon wyłączony'
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
                        : 'Wyłączony'}
              </span>
            </div>
          )}

          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
              placeholder={
                stt.isRecording
                  ? "🎙️ Nagrywam..."
                  : stt.isTranscribing
                    ? "🔧 Przetwarzam audio..."
                    : "Wpisz adres, zapytanie lub naciśnij przycisk mikrofonu..."
              }
              className="w-full rounded-xl bg-gray-800/80 px-4 py-3 pr-12 text-sm text-white placeholder-gray-500 outline-none ring-1 ring-gray-700/60 transition-all duration-200 focus:ring-2 focus:ring-broxeen-500/70 focus:shadow-[0_0_20px_rgba(14,165,233,0.12)]"
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
              onClick={() => onSubmit()}
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
  );
}

import { type RefObject } from "react";
import {
  Globe,
  Search,
  Zap,
  Loader2,
  Copy,
  Bot,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { ChatMessage } from "../domain/chatEvents";
import { ChatConfigPrompt } from "./ChatConfigPrompt";
import { CameraPreview, type CameraPreviewProps } from "./CameraPreview";
import { CameraLiveInline } from "./CameraLiveInline";
import { ActionSuggestions } from "./ActionSuggestions";
import { QuickCommands } from "./QuickCommands";
import { CommandHistory } from "./CommandHistory";
import { QuickActionButtons } from "./QuickActionButtons";
import { MessageQuickActions } from "./MessageQuickActions";
import { MessageResultCard } from "./MessageResultCard";
import { ThinkingMessage } from "./ThinkingMessage";
import TtsControls from "./TtsControls";

// ── Shared markdown component config ──────────────────────

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

// ── Reusable markdown renderers ───────────────────────────

const markdownComponents = (opts: {
  onSetInput?: (text: string) => void;
}) => ({
  p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: any) => <strong className="font-bold text-white">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  code: ({ className, children }: any) => {
    const isInline = !className?.includes('language-');
    const codeText = String(children).replace(/\n$/, '');

    return isInline ? (
      <code
        className="bg-gray-700 px-1 py-0.5 rounded text-xs font-mono cursor-pointer hover:bg-gray-600 transition-colors"
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          opts.onSetInput?.(codeText);
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
      </code>
    ) : (
      <code className="block bg-gray-700 p-2 rounded text-xs font-mono overflow-x-auto">{children}</code>
    );
  },
  ul: ({ children }: any) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }: any) => <li className="text-gray-200">{children}</li>,
  a: ({ href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-4 border-gray-600 pl-4 italic text-gray-300 my-2">
      {children}
    </blockquote>
  ),
});

// ── Suggested-actions text splitter ───────────────────────

const SUGGESTION_MARKERS = [
  '💡 **Sugerowane akcje:**',
  '💡 **Sugerowane akcje**:',
  'Sugerowane akcje:',
  'Sugerowane akcje',
];

function stripSuggestionMarker(text: string): string {
  for (const candidate of SUGGESTION_MARKERS) {
    const idx = text.indexOf(candidate);
    if (idx !== -1) return text.slice(0, idx).trimEnd();
  }
  return text;
}

function extractSuggestionSection(text: string): string | null {
  for (const candidate of SUGGESTION_MARKERS) {
    const idx = text.indexOf(candidate);
    if (idx !== -1) {
      return text.slice(idx + candidate.length)
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n');
    }
  }
  return null;
}

// ── Props ─────────────────────────────────────────────────

export interface TtsState {
  isSpeaking: boolean;
  isPaused: boolean;
  progress: number;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

export interface ChatMessageListProps {
  messages: readonly ChatMessage[];
  showWelcomeScreen: boolean;
  showCommandHistory: boolean;
  hasNonSystemMessages: boolean;
  selectedCamera: CameraPreviewProps['camera'] | null;
  tts: TtsState;
  settingsTtsEnabled: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;

  // Handlers
  onSubmit: (text: string) => void;
  onSetInput: (text: string) => void;
  onExpandImage: (data: { data: string; mimeType?: string }) => void;
  onExpandLive: (payload: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string }) => void;
  onCommandHistorySelect: (command: string) => void;
  onSuggestionClick: (suggestion: any) => void;
  onNetworkOptionClick: (scope: string, name: string) => void;
  onCameraSelect: (camera: CameraPreviewProps['camera']) => void;
  onCameraAnalysisComplete: (cameraId: string, analysis: string) => void;
  onCopyMessageContext: (msg: ChatMessage) => void;
  onSuggestionLearning: (query: string, category: string, success: boolean) => void;
  onShowCommandHistory: (show: boolean) => void;

  // Welcome screen context
  getRecentQueries: () => string[];
  getCurrentContext: () => any;
}

// ── Component ─────────────────────────────────────────────

export function ChatMessageList({
  messages,
  showWelcomeScreen,
  showCommandHistory,
  hasNonSystemMessages,
  selectedCamera,
  tts,
  settingsTtsEnabled,
  messagesEndRef,
  onSubmit,
  onSetInput,
  onExpandImage,
  onExpandLive,
  onCommandHistorySelect,
  onSuggestionClick,
  onNetworkOptionClick,
  onCameraSelect,
  onCameraAnalysisComplete,
  onCopyMessageContext,
  onSuggestionLearning,
  onShowCommandHistory,
  getRecentQueries,
  getCurrentContext,
}: ChatMessageListProps) {

  const mdComponents = markdownComponents({ onSetInput });
  // Camera analysis uses a simpler markdown renderer (no code-click)
  const mdComponentsSimple = markdownComponents({});

  return (
    <div className="space-y-4">
      {/* Command History - show when no messages */}
      {!hasNonSystemMessages && showCommandHistory && (
        <CommandHistory
          onSelect={onCommandHistorySelect}
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
                      onSubmit(card.query);
                    } else if (card.prefill) {
                      onSetInput(card.prefill);
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
                onClick={() => onShowCommandHistory(true)}
                className="px-3 py-1.5 bg-gray-800 text-gray-400 text-xs rounded-lg hover:bg-gray-700 hover:text-gray-200 transition-colors"
              >
                📜 Historia komend
              </button>
            </div>
          </div>

          {/* Action Suggestions */}
          <ActionSuggestions
            onActionSelect={(query) => {
              onSetInput(query);
              onSubmit(query);
            }}
            recentQueries={getRecentQueries()}
            isVisible={true}
            currentContext={getCurrentContext()}
            onLearn={onSuggestionLearning}
          />

          {/* Quick Commands */}
          <div className="mt-4">
            <QuickCommands
              onCommandSelect={(query) => {
                onSetInput(query);
                onSubmit(query);
              }}
              recentCommands={getRecentQueries()}
            />
          </div>
        </>
      )}

      {messages.map((msg, index) => {
        const isSystem = msg.role === "system";
        const prevIsSystem = index > 0 && messages[index - 1].role === "system";
        const nextIsSystem = index < messages.length - 1 && messages[index + 1].role === "system";

        return (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user"
              ? "justify-end slide-in-right"
              : isSystem
                ? `justify-start ${prevIsSystem ? '!mt-[2px]' : ''}`
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
              className={`${msg.role === "user"
                ? "rounded-2xl px-4 py-3 max-w-[85%] bg-gradient-to-br from-broxeen-500 to-broxeen-700 text-white cursor-pointer transition-all hover:from-broxeen-400 hover:to-broxeen-600 shadow-lg shadow-broxeen-500/10"
                : isSystem
                  ? `max-w-[95%] border-l-2 text-xs py-1.5 px-3 ${prevIsSystem ? 'rounded-t-sm' : 'rounded-t-lg'} ${nextIsSystem ? 'rounded-b-sm' : 'rounded-b-lg'} ${msg.text.includes('Błąd') || msg.text.includes('Error') ? 'border-amber-500/60 bg-amber-950/20 text-amber-300/80' : 'border-blue-500/40 bg-blue-950/20 text-gray-400'}`
                  : "rounded-2xl px-4 py-3 max-w-[85%] bg-gray-800/60 backdrop-blur-sm border border-gray-700/40 text-gray-100 shadow-md"
                }`}
              onClick={
                msg.role === "user"
                  ? () => {
                    onSetInput(msg.text);
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
                      onClick={() => msg.screenshotBase64 && onExpandImage({ data: msg.screenshotBase64, mimeType: 'image/png' })}
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
                      onClick={() => onExpandImage({ data: msg.text, mimeType: msg.mimeType || 'image/jpeg' })}
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
                      onClickImage={(img) => onExpandImage({ data: img.base64, mimeType: img.mimeType })}
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
                  ) : msg.type === 'thinking' && !msg.thinkingInfo ? null : msg.type === 'image' || msg.type === 'camera_live' ? null : isSystem ? (
                    <div className="text-xs leading-relaxed">
                      {msg.text}
                    </div>
                  ) : (
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
                              ...mdComponents,
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
                                      onExpandImage({ data: m[2], mimeType: m[1] });
                                    }}
                                  />
                                );
                              },
                            }}
                          >
                            {stripSuggestionMarker(msg.text)}
                          </ReactMarkdown>
                        </div>
                        <QuickActionButtons
                          message={msg}
                          onActionClick={(action, url) => {
                            if (action === 'contact' && url.startsWith('mailto:')) {
                              window.location.href = url;
                            } else if (action === 'phone' && url.startsWith('tel:')) {
                              window.location.href = url;
                            } else {
                              window.open(url, '_blank');
                            }
                          }}
                        />
                      </MessageResultCard>
                    </div>
                  )}

                  {/* Inline Action Hints */}
                  {msg.role === "assistant" && !msg.loading && (() => {
                    const section = extractSuggestionSection(msg.text);
                    if (!section) return null;

                    const hintPattern = /^-\s*"([^"]+)"(?:\s*[—–-]\s*(.+))?$/gm;
                    const hints: Array<{ query: string; label: string; isPrefill: boolean }> = [];
                    const seen = new Set<string>();
                    let m: RegExpExecArray | null;

                    while ((m = hintPattern.exec(section)) !== null) {
                      const query = m[1].trim();
                      const label = (m[2]?.trim() || query).trim();
                      if (!query || !label) continue;
                      if (query.length > 200) continue;
                      if (seen.has(query)) continue;
                      seen.add(query);

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
                                onSetInput(hint.query);
                                const inputElement = document.querySelector('textarea') as HTMLTextAreaElement;
                                if (inputElement) {
                                  inputElement.focus();
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
                                onSubmit(hint.query);
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
                          onClick={() => onNetworkOptionClick(option.scope, option.name)}
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
                          onClick={() => onSuggestionClick(suggestion)}
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
                      onPrefill={(text) => onSetInput(text)}
                      onExecute={(query) => onSubmit(query)}
                    />
                  )}

                  {/* Camera List */}
                  {msg.type === "camera_list" && msg.cameras && (
                    <div className="mt-4 space-y-4" data-testid="camera-list">
                      {msg.cameras.map((camera) => (
                        <CameraPreview
                          key={camera.id}
                          camera={{
                            ...camera,
                            ip: camera.address,
                            type: 'rtsp',
                            status: camera.status as 'online' | 'offline'
                          }}
                          onSelect={onCameraSelect}
                          onAnalysisComplete={onCameraAnalysisComplete}
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
                              components={mdComponentsSimple}
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
                        onSelect={onCameraSelect}
                        onAnalysisComplete={onCameraAnalysisComplete}
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
                            onSuggestionClick(s);
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
                      onExecute={(query) => onSubmit(query)}
                      onPrefill={(text) => onSetInput(text)}
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
                      onPause={tts.pause}
                      onResume={tts.resume}
                      onStop={tts.stop}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopyMessageContext(msg);
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
        );
      })}
      <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
    </div>
  );
}

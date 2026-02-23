/**
 * ChatConfigPrompt — Renders interactive configuration buttons inside chat messages.
 * Supports: clickable options, prefill input, direct config changes, action buttons.
 */

import { Settings, ChevronRight, Check, X } from 'lucide-react';
import { configStore } from '../config/configStore';
import { CONFIG_FIELD_META, type ConfigFieldMeta } from '../config/appConfig';
import { preferenceLearning } from '../core/preferenceLearning';
import { useState } from 'react';

// ── Types ───────────────────────────────────────────────────

export interface ConfigAction {
  /** Unique action id */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Icon emoji */
  icon?: string;
  /** Action type */
  type: 'prefill' | 'set_config' | 'execute' | 'link';
  /** For prefill: text to put in chat input */
  prefillText?: string;
  /** For set_config: config path + value */
  configPath?: string;
  configValue?: unknown;
  /** For execute: query to run */
  executeQuery?: string;
  /** For link: URL to open */
  linkUrl?: string;
  /** Visual style */
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
}

export interface ConfigPromptData {
  /** Title of the config prompt */
  title: string;
  /** Description text */
  description?: string;
  /** List of actions */
  actions: ConfigAction[];
  /** Config fields to show as inline editors */
  editableFields?: string[];
  /** Layout: buttons or cards */
  layout?: 'buttons' | 'cards' | 'inline';
}

// ── Props ───────────────────────────────────────────────────

interface ChatConfigPromptProps {
  data: ConfigPromptData;
  onPrefill: (text: string) => void;
  onExecute: (query: string) => void;
  className?: string;
}

// ── Component ───────────────────────────────────────────────

export function ChatConfigPrompt({ data, onPrefill, onExecute, className = '' }: ChatConfigPromptProps) {
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const [clickedActions, setClickedActions] = useState<Set<string>>(new Set());
  const [editValues, setEditValues] = useState<Record<string, string>>({});

  const handleAction = (action: ConfigAction) => {
    // Track user choice for preference learning
    preferenceLearning.recordChoice({
      intent: action.id,
      executeQuery: action.executeQuery || action.prefillText,
      label: action.label,
    });

    // Trigger click animation
    setClickedActions(prev => new Set(prev).add(action.id));
    setTimeout(() => {
      setClickedActions(prev => { const n = new Set(prev); n.delete(action.id); return n; });
      setCompletedActions(prev => new Set(prev).add(action.id));
    }, 600);

    switch (action.type) {
      case 'prefill':
        if (action.prefillText) {
          onPrefill(action.prefillText);
        }
        break;

      case 'set_config':
        if (action.configPath !== undefined && action.configValue !== undefined) {
          configStore.set(action.configPath, action.configValue);
        }
        break;

      case 'execute':
        if (action.executeQuery) {
          onExecute(action.executeQuery);
        }
        break;

      case 'link':
        if (action.linkUrl) {
          window.open(action.linkUrl, '_blank', 'noopener,noreferrer');
        }
        break;
    }
  };

  const handleFieldSave = (fieldKey: string) => {
    const value = editValues[fieldKey];
    if (value !== undefined) {
      const meta = CONFIG_FIELD_META.find(f => f.key === fieldKey);
      let parsedValue: unknown = value;
      if (meta?.type === 'number') {
        parsedValue = Number(value);
      } else if (meta?.type === 'number[]') {
        parsedValue = value.split(',').map(v => Number(v.trim())).filter(n => !isNaN(n));
      } else if (meta?.type === 'string[]') {
        parsedValue = value.split(',').map(v => v.trim()).filter(Boolean);
      }
      configStore.set(fieldKey, parsedValue);
      setCompletedActions(prev => new Set(prev).add(fieldKey));
    }
  };

  const getVariantClasses = (variant: ConfigAction['variant'] = 'secondary') => {
    switch (variant) {
      case 'primary':
        return 'bg-broxeen-600/20 border-broxeen-600/30 text-broxeen-300 hover:bg-broxeen-600/30';
      case 'success':
        return 'bg-green-600/20 border-green-600/30 text-green-300 hover:bg-green-600/30';
      case 'warning':
        return 'bg-amber-600/20 border-amber-600/30 text-amber-300 hover:bg-amber-600/30';
      case 'danger':
        return 'bg-red-600/20 border-red-600/30 text-red-300 hover:bg-red-600/30';
      default:
        return 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600';
    }
  };

  const layout = data.layout || 'buttons';

  return (
    <div className={`mt-3 ${className}`} data-testid="config-prompt">
      {/* Editable fields */}
      {data.editableFields && data.editableFields.length > 0 && (
        <div className="mb-3 space-y-2">
          {data.editableFields.map(fieldKey => {
            const meta = CONFIG_FIELD_META.find(f => f.key === fieldKey);
            if (!meta) return null;
            const currentValue = configStore.get<unknown>(fieldKey);
            const isCompleted = completedActions.has(fieldKey);

            return (
              <div key={fieldKey} className="flex items-center gap-2 rounded-lg bg-gray-700/50 p-2">
                <Settings size={14} className="text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 mb-0.5">{meta.label}</div>
                  {meta.options ? (
                    <select
                      value={editValues[fieldKey] ?? String(currentValue ?? '')}
                      onChange={e => setEditValues(prev => ({ ...prev, [fieldKey]: e.target.value }))}
                      className="w-full bg-gray-800 text-sm text-white rounded px-2 py-1 border border-gray-600 outline-none focus:border-broxeen-500"
                      disabled={isCompleted}
                    >
                      <option value="">— wybierz —</option>
                      {meta.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={meta.type === 'password' ? 'password' : meta.type === 'number' ? 'number' : 'text'}
                      value={editValues[fieldKey] ?? String(currentValue ?? '')}
                      onChange={e => setEditValues(prev => ({ ...prev, [fieldKey]: e.target.value }))}
                      placeholder={meta.placeholder || meta.description}
                      className="w-full bg-gray-800 text-sm text-white rounded px-2 py-1 border border-gray-600 outline-none focus:border-broxeen-500"
                      disabled={isCompleted}
                    />
                  )}
                </div>
                {isCompleted ? (
                  <Check size={16} className="text-green-400 shrink-0" />
                ) : (
                  <button
                    onClick={() => handleFieldSave(fieldKey)}
                    className="shrink-0 rounded bg-broxeen-600 px-2 py-1 text-xs text-white hover:bg-broxeen-500 transition"
                  >
                    Zapisz
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      {layout === 'buttons' && (
        <div className="flex flex-wrap gap-2">
          {data.actions.map(action => {
            const isCompleted = completedActions.has(action.id);
            const isClicked = clickedActions.has(action.id);
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={isCompleted || isClicked}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-300 ${
                  isClicked
                    ? 'bg-green-500/30 border-green-500/50 text-green-200 scale-95 animate-pulse'
                    : isCompleted
                    ? 'bg-green-600/20 border-green-600/30 text-green-300 opacity-60 cursor-default'
                    : getVariantClasses(action.variant)
                }`}
                title={action.description || action.label}
                data-testid={`config-action-${action.id}`}
              >
                {isClicked ? (
                  <Check size={12} className="animate-bounce" />
                ) : isCompleted ? (
                  <Check size={12} />
                ) : action.icon ? (
                  <span>{action.icon}</span>
                ) : (
                  <ChevronRight size={12} />
                )}
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Card layout */}
      {layout === 'cards' && (
        <div className="space-y-2">
          {data.actions.map(action => {
            const isCompleted = completedActions.has(action.id);
            const isClicked = clickedActions.has(action.id);
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={isCompleted || isClicked}
                className={`w-full text-left p-3 rounded-lg border transition-all duration-300 group ${
                  isClicked
                    ? 'bg-green-500/20 border-green-500/40 scale-[0.98] ring-1 ring-green-500/30'
                    : isCompleted
                    ? 'bg-green-600/10 border-green-600/20 opacity-60 cursor-default'
                    : 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:border-gray-500'
                }`}
                data-testid={`config-card-${action.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {action.icon && <span className={`text-lg transition-transform duration-300 ${isClicked ? 'scale-125' : ''}`}>{action.icon}</span>}
                    <div>
                      <div className={`font-medium text-sm transition-colors duration-300 ${
                        isClicked ? 'text-green-300' : isCompleted ? 'text-green-300' : 'text-gray-200 group-hover:text-broxeen-400'
                      }`}>
                        {action.label}
                      </div>
                      {action.description && (
                        <div className={`text-xs mt-0.5 transition-colors duration-300 ${isClicked ? 'text-green-400/70' : 'text-gray-400'}`}>{action.description}</div>
                      )}
                    </div>
                  </div>
                  {isClicked ? (
                    <Check size={16} className="text-green-400 animate-bounce" />
                  ) : isCompleted ? (
                    <Check size={16} className="text-green-400" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-400 group-hover:text-broxeen-400" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Inline layout (single row compact) */}
      {layout === 'inline' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {data.actions.map(action => {
            const isCompleted = completedActions.has(action.id);
            const isClicked = clickedActions.has(action.id);
            return (
              <button
                key={action.id}
                onClick={() => handleAction(action)}
                disabled={isCompleted || isClicked}
                className={`rounded-md px-2.5 py-1 text-xs transition-all duration-300 ${
                  isClicked
                    ? 'bg-green-500/30 text-green-200 scale-95'
                    : isCompleted
                    ? 'bg-green-600/20 text-green-300 opacity-60 cursor-default'
                    : 'bg-gray-700/80 text-gray-300 hover:bg-gray-600 hover:text-white'
                }`}
              >
                {isClicked ? (
                  <><Check size={10} className="inline mr-1 animate-bounce" />{action.label}</>
                ) : (
                  <>{action.icon && <span className="mr-1">{action.icon}</span>}{action.label}</>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers for building ConfigPromptData ────────────────────

/** Build a setup prompt for missing API key */
export function buildApiKeyPrompt(): ConfigPromptData {
  return {
    title: 'Konfiguracja API',
    description: 'Aby korzystać z AI, podaj klucz API OpenRouter.',
    editableFields: ['llm.apiKey'],
    actions: [
      {
        id: 'get-key',
        label: 'Pobierz klucz API',
        icon: '🔑',
        type: 'link',
        linkUrl: 'https://openrouter.ai/keys',
        variant: 'primary',
      },
      {
        id: 'skip-llm',
        label: 'Pomiń (bez AI)',
        icon: '⏭️',
        type: 'execute',
        executeQuery: 'pomoc',
        variant: 'secondary',
      },
    ],
    layout: 'buttons',
  };
}

/** Build a network config prompt */
export function buildNetworkConfigPrompt(detectedSubnet?: string): ConfigPromptData {
  const actions: ConfigAction[] = [];

  if (detectedSubnet) {
    actions.push({
      id: `set-subnet-${detectedSubnet}`,
      label: `Użyj ${detectedSubnet}.0/24`,
      icon: '🌐',
      type: 'set_config',
      configPath: 'network.defaultSubnet',
      configValue: detectedSubnet,
      variant: 'primary',
      description: 'Wykryta podsieć lokalna',
    });
  }

  actions.push(
    {
      id: 'scan-now',
      label: 'Skanuj teraz',
      icon: '🔍',
      type: 'execute',
      executeQuery: detectedSubnet ? `skanuj ${detectedSubnet}` : 'skanuj sieć',
      variant: 'success',
    },
    {
      id: 'custom-subnet',
      label: 'Inna podsieć...',
      icon: '✏️',
      type: 'prefill',
      prefillText: 'skanuj 192.168.',
      variant: 'secondary',
    },
  );

  return {
    title: 'Konfiguracja sieci',
    description: detectedSubnet
      ? `Wykryto podsieć: **${detectedSubnet}.0/24**`
      : 'Nie wykryto podsieci. Podaj ręcznie lub uruchom skanowanie.',
    actions,
    layout: 'buttons',
  };
}

/** Build a model selection prompt */
export function buildModelSelectionPrompt(): ConfigPromptData {
  return {
    title: 'Wybierz model AI',
    description: 'Wybierz model do rozmów i analizy:',
    editableFields: ['llm.model'],
    actions: [
      {
        id: 'model-gemini-flash',
        label: 'Gemini 3 Flash',
        icon: '⚡',
        description: 'Szybki, dobry do większości zadań',
        type: 'set_config',
        configPath: 'llm.model',
        configValue: 'google/gemini-3-flash-preview',
        variant: 'primary',
      },
      {
        id: 'model-gpt4o-mini',
        label: 'GPT-4o Mini',
        icon: '🤖',
        description: 'OpenAI, dobra jakość, niski koszt',
        type: 'set_config',
        configPath: 'llm.model',
        configValue: 'openai/gpt-4o-mini',
        variant: 'secondary',
      },
      {
        id: 'model-claude',
        label: 'Claude 3.5 Sonnet',
        icon: '🎭',
        description: 'Anthropic, najlepsza jakość',
        type: 'set_config',
        configPath: 'llm.model',
        configValue: 'anthropic/claude-3.5-sonnet',
        variant: 'secondary',
      },
    ],
    layout: 'cards',
  };
}

/** Build a SSH host prompt */
export function buildSshHostPrompt(hosts: string[]): ConfigPromptData {
  return {
    title: 'Połącz z hostem SSH',
    description: hosts.length > 0 ? 'Znane hosty:' : 'Podaj adres hosta SSH:',
    actions: [
      ...hosts.slice(0, 5).map(host => ({
        id: `ssh-${host}`,
        label: host,
        icon: '📡',
        type: 'prefill' as const,
        prefillText: `ssh ${host} uptime`,
        variant: 'primary' as const,
        description: `Połącz z ${host}`,
      })),
      {
        id: 'ssh-custom',
        label: 'Inny host...',
        icon: '✏️',
        type: 'prefill',
        prefillText: 'ssh ',
        variant: 'secondary',
      },
    ],
    layout: hosts.length > 3 ? 'cards' : 'buttons',
  };
}

/** Build a camera action prompt */
export function buildCameraActionPrompt(cameraIp: string, cameraName?: string): ConfigPromptData {
  return {
    title: cameraName || `Kamera ${cameraIp}`,
    actions: [
      {
        id: `monitor-${cameraIp}`,
        label: 'Monitoruj',
        icon: '👁️',
        type: 'execute',
        executeQuery: `monitoruj ${cameraIp}`,
        variant: 'primary',
      },
      {
        id: `snapshot-${cameraIp}`,
        label: 'Zrzut ekranu',
        icon: '📸',
        type: 'execute',
        executeQuery: `snapshot ${cameraIp}`,
        variant: 'secondary',
      },
      {
        id: `ports-${cameraIp}`,
        label: 'Skanuj porty',
        icon: '🔍',
        type: 'execute',
        executeQuery: `skanuj porty ${cameraIp}`,
        variant: 'secondary',
      },
      {
        id: `ping-${cameraIp}`,
        label: 'Ping',
        icon: '📡',
        type: 'execute',
        executeQuery: `ping ${cameraIp}`,
        variant: 'secondary',
      },
    ],
    layout: 'buttons',
  };
}

/** Build general config overview prompt */
export function buildConfigOverviewPrompt(): ConfigPromptData {
  const status = configStore.getConfigStatus();
  return {
    title: 'Konfiguracja Broxeen',
    description: `AI: ${status.llmConfigured ? '✅' : '❌'} | STT: ${status.sttConfigured ? '✅' : '❌'} | Sieć: ${status.networkSubnet} | Język: ${status.locale}`,
    actions: [
      {
        id: 'config-llm',
        label: 'AI / LLM',
        icon: '🧠',
        type: 'execute',
        executeQuery: 'konfiguruj ai',
        variant: status.llmConfigured ? 'success' : 'warning',
        description: status.llmConfigured ? 'Skonfigurowane' : 'Wymaga klucza API',
      },
      {
        id: 'config-network',
        label: 'Sieć',
        icon: '🌐',
        type: 'execute',
        executeQuery: 'konfiguruj sieć',
        variant: 'secondary',
        description: `Podsieć: ${status.networkSubnet}`,
      },
      {
        id: 'config-ssh',
        label: 'SSH',
        icon: '📡',
        type: 'execute',
        executeQuery: 'ssh hosty',
        variant: 'secondary',
      },
      {
        id: 'config-reset',
        label: 'Resetuj',
        icon: '🔄',
        type: 'execute',
        executeQuery: 'resetuj konfigurację',
        variant: 'danger',
        description: 'Przywróć domyślne ustawienia',
      },
    ],
    layout: 'cards',
  };
}

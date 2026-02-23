/**
 * MessageQuickActions — Renders contextual action buttons at the bottom
 * of assistant messages. Actions are auto-generated based on message content
 * by quickActionResolver.
 */

import { useState } from 'react';
import { ChevronRight, Check, ExternalLink, Edit3 } from 'lucide-react';
import type { ChatMessage } from '../domain/chatEvents';
import { resolveQuickActions } from '../utils/quickActionResolver';
import type { ConfigAction } from './ChatConfigPrompt';

interface MessageQuickActionsProps {
  message: ChatMessage;
  onExecute: (query: string) => void;
  onPrefill: (text: string) => void;
}

export function MessageQuickActions({ message, onExecute, onPrefill }: MessageQuickActionsProps) {
  const [executedIds, setExecutedIds] = useState<Set<string>>(new Set());

  const result = resolveQuickActions(message);
  if (!result || result.actions.length === 0) return null;

  const handleAction = (action: ConfigAction) => {
    switch (action.type) {
      case 'execute':
        if (action.executeQuery) {
          onExecute(action.executeQuery);
          setExecutedIds(prev => new Set(prev).add(action.id));
        }
        break;
      case 'prefill':
        if (action.prefillText) {
          onPrefill(action.prefillText);
        }
        break;
      case 'link':
        if (action.linkUrl) {
          window.open(action.linkUrl, '_blank', 'noopener,noreferrer');
        }
        break;
    }
  };

  const getIcon = (action: ConfigAction, isExecuted: boolean) => {
    if (isExecuted) return <Check size={11} className="text-green-400" />;
    if (action.icon) return <span className="text-xs leading-none">{action.icon}</span>;
    if (action.type === 'prefill') return <Edit3 size={11} />;
    if (action.type === 'link') return <ExternalLink size={11} />;
    return <ChevronRight size={11} />;
  };

  const getVariantClasses = (variant: ConfigAction['variant'] = 'secondary', isExecuted: boolean) => {
    if (isExecuted) return 'bg-green-600/15 border-green-600/25 text-green-400 opacity-70 cursor-default';
    switch (variant) {
      case 'primary':
        return 'bg-broxeen-600/20 border-broxeen-500/30 text-broxeen-300 hover:bg-broxeen-600/30 hover:border-broxeen-500/50';
      case 'success':
        return 'bg-green-600/15 border-green-600/25 text-green-300 hover:bg-green-600/25';
      case 'warning':
        return 'bg-amber-600/15 border-amber-600/25 text-amber-300 hover:bg-amber-600/25';
      default:
        return 'bg-gray-700/60 border-gray-600/40 text-gray-300 hover:bg-gray-600/60 hover:text-white';
    }
  };

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" data-testid="quick-actions">
      <span className="text-[10px] text-gray-500 mr-0.5">→</span>
      {result.actions.map(action => {
        const isExecuted = executedIds.has(action.id);
        return (
          <button
            key={action.id}
            onClick={(e) => {
              e.stopPropagation();
              if (!isExecuted) handleAction(action);
            }}
            disabled={isExecuted}
            className={`
              flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium
              transition-all duration-150 active:scale-95
              ${getVariantClasses(action.variant, isExecuted)}
            `}
            title={action.description || action.label}
          >
            {getIcon(action, isExecuted)}
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}

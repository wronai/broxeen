/**
 * useChatPersistence — subscribes to EventStore events and persists
 * chat messages to SQLite via ChatRepository.
 *
 * Runs as a side-effect inside the React tree where both
 * CqrsContext (EventStore) and AppContext (DatabaseManager) are available.
 */

import { useEffect, useRef } from 'react';
import { ChatRepository } from '../persistence/chatRepository';
import type { DatabaseManager } from '../persistence/databaseManager';
import type { EventStore } from '../domain/eventStore';
import type { ChatMessage } from '../domain/chatEvents';
import { logger } from '../lib/logger';

const persistLogger = logger.scope('persistence:chatHook');

/** Stable conversation ID for the current session */
function getSessionConversationId(): string {
  if (!(window as any).__broxeenConversationId) {
    (window as any).__broxeenConversationId = `conv-${Date.now()}`;
  }
  return (window as any).__broxeenConversationId;
}

export function useChatPersistence(
  eventStore: EventStore | null,
  databaseManager: DatabaseManager | null,
) {
  const repoRef = useRef<ChatRepository | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!eventStore || !databaseManager || !databaseManager.isReady()) {
      return;
    }

    // Lazily create repository
    if (!repoRef.current) {
      try {
        repoRef.current = new ChatRepository(databaseManager.getChatDb());
        persistLogger.info('ChatRepository created for persistence hook');
      } catch (err) {
        persistLogger.warn('Failed to create ChatRepository', err);
        return;
      }
    }

    const repo = repoRef.current;
    const conversationId = getSessionConversationId();

    // Ensure conversation row exists (fire-and-forget)
    if (!conversationIdRef.current) {
      conversationIdRef.current = conversationId;
      repo.ensureConversation(conversationId).catch((err) => {
        persistLogger.warn('ensureConversation failed', err);
      });
    }

    // Subscribe to message_added events
    const unsubAdd = eventStore.on('message_added', (event) => {
      const msg = event.payload as ChatMessage;
      if (!msg || msg.role === 'system') return; // skip system/initial messages

      repo.saveMessage(conversationId, msg).catch((err) => {
        persistLogger.warn('saveMessage failed', err);
      });
    });

    // Subscribe to message_updated events
    const unsubUpdate = eventStore.on('message_updated', (event) => {
      const { id, updates } = event.payload as { id: number; updates: Partial<ChatMessage> };
      if (!id) return;

      // Build a partial message to upsert
      const msg: ChatMessage = {
        id,
        role: updates.role ?? 'assistant',
        text: updates.text ?? '',
        ...updates,
      };

      repo.saveMessage(conversationId, msg).catch((err) => {
        persistLogger.warn('saveMessage (update) failed', err);
      });
    });

    return () => {
      unsubAdd();
      unsubUpdate();
    };
  }, [eventStore, databaseManager]);
}

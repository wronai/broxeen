/**
 * ChatPersistenceBridge — invisible component that bridges
 * CqrsContext (EventStore) with AppContext (DatabaseManager)
 * to persist chat messages to SQLite automatically.
 */

import { useCqrs } from '../contexts/CqrsContext';
import { useChatPersistence } from '../hooks/useChatPersistence';
import type { DatabaseManager } from '../persistence/databaseManager';

interface Props {
  databaseManager: DatabaseManager | null;
}

export function ChatPersistenceBridge({ databaseManager }: Props) {
  const { eventStore } = useCqrs();
  useChatPersistence(eventStore, databaseManager);
  return null;
}

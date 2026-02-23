import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChatPersistence } from './useChatPersistence';
import { EventStore } from '../domain/eventStore';
import { InMemoryDbAdapter, DatabaseManager } from '../persistence/databaseManager';

describe('useChatPersistence', () => {
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = new EventStore();
    // Reset global conversation ID
    delete (window as any).__broxeenConversationId;
  });

  it('does nothing when eventStore is null', () => {
    const { unmount } = renderHook(() => useChatPersistence(null, null));
    // Should not throw
    unmount();
  });

  it('does nothing when databaseManager is null', () => {
    const { unmount } = renderHook(() => useChatPersistence(eventStore, null));
    // Should not throw
    unmount();
  });

  it('does nothing when databaseManager is not ready', () => {
    const dbManager = new DatabaseManager(
      { devicesDbPath: ':memory:', chatDbPath: ':memory:', walMode: false, connectionPoolSize: 1 },
    );
    // Not initialized, so isReady() returns false
    const { unmount } = renderHook(() => useChatPersistence(eventStore, dbManager));
    unmount();
  });

  it('subscribes to message_added events and persists messages', async () => {
    const dbManager = new DatabaseManager(
      { devicesDbPath: ':memory:', chatDbPath: ':memory:', walMode: false, connectionPoolSize: 1 },
    );
    await dbManager.initialize();

    // Spy on the chat db execute
    const chatDb = dbManager.getChatDb();
    const executeSpy = vi.spyOn(chatDb, 'execute');

    renderHook(() => useChatPersistence(eventStore, dbManager));

    // Emit a user message
    eventStore.append({
      type: 'message_added',
      payload: {
        id: 42,
        role: 'user',
        text: 'Hello world',
        timestamp: 1000,
      },
    });

    // Give async persistence a tick
    await new Promise((r) => setTimeout(r, 50));

    // Should have called execute for ensureConversation + saveMessage
    const insertCalls = executeSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT'),
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);

    await dbManager.close();
  });

  it('skips system messages', async () => {
    const dbManager = new DatabaseManager(
      { devicesDbPath: ':memory:', chatDbPath: ':memory:', walMode: false, connectionPoolSize: 1 },
    );
    await dbManager.initialize();

    const chatDb = dbManager.getChatDb();
    const executeSpy = vi.spyOn(chatDb, 'execute');

    renderHook(() => useChatPersistence(eventStore, dbManager));

    // Emit a system message
    eventStore.append({
      type: 'message_added',
      payload: {
        id: 1,
        role: 'system',
        text: 'Welcome',
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have called saveMessage (INSERT OR REPLACE INTO messages)
    const messageSaves = executeSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO messages'),
    );
    expect(messageSaves.length).toBe(0);

    await dbManager.close();
  });

  it('cleans up subscriptions on unmount', async () => {
    const dbManager = new DatabaseManager(
      { devicesDbPath: ':memory:', chatDbPath: ':memory:', walMode: false, connectionPoolSize: 1 },
    );
    await dbManager.initialize();

    const chatDb = dbManager.getChatDb();
    const executeSpy = vi.spyOn(chatDb, 'execute');

    const { unmount } = renderHook(() => useChatPersistence(eventStore, dbManager));
    unmount();

    // Clear spy call count
    executeSpy.mockClear();

    // Emit a message after unmount
    eventStore.append({
      type: 'message_added',
      payload: { id: 99, role: 'user', text: 'After unmount' },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Should NOT have persisted (subscriptions cleaned up)
    const messageSaves = executeSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO messages'),
    );
    expect(messageSaves.length).toBe(0);

    await dbManager.close();
  });
});

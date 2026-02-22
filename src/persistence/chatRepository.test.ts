import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatRepository } from './chatRepository';
import { InMemoryDbAdapter } from './databaseManager';
import type { ChatMessage } from '../domain/chatEvents';

describe('ChatRepository', () => {
  let db: InMemoryDbAdapter;
  let repo: ChatRepository;

  beforeEach(() => {
    db = new InMemoryDbAdapter(':memory:');
    repo = new ChatRepository(db);
  });

  it('ensureConversation calls execute with correct SQL', async () => {
    const spy = vi.spyOn(db, 'execute');
    const id = await repo.ensureConversation('conv-1');
    expect(id).toBe('conv-1');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO conversations'),
      expect.arrayContaining(['conv-1']),
    );
  });

  it('saveMessage calls execute with message data', async () => {
    const spy = vi.spyOn(db, 'execute');
    const msg: ChatMessage = {
      id: 1,
      role: 'user',
      text: 'Hello',
      timestamp: 1700000000000,
    };

    await repo.saveMessage('conv-1', msg);
    // Should have two calls: INSERT INTO messages + UPDATE conversations
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO messages'),
      expect.arrayContaining(['1', 'conv-1', 'user', 'Hello']),
    );
  });

  it('saveMessages persists multiple messages', async () => {
    const spy = vi.spyOn(db, 'execute');
    const messages: ChatMessage[] = [
      { id: 1, role: 'user', text: 'Hello' },
      { id: 2, role: 'assistant', text: 'Hi there' },
    ];
    await repo.saveMessages('conv-1', messages);
    // 2 messages × 2 calls each (insert + update)
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('loadMessages returns empty array from in-memory adapter', async () => {
    const messages = await repo.loadMessages('conv-1');
    expect(messages).toEqual([]);
  });

  it('loadMessages maps rows to ChatMessage when data exists', async () => {
    vi.spyOn(db, 'query').mockResolvedValueOnce([
      {
        id: '1',
        role: 'user',
        content: 'test message',
        timestamp: 1700000000000,
        metadata: JSON.stringify({ type: 'content', url: 'https://example.com' }),
      },
    ] as any);

    const messages = await repo.loadMessages('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: 1,
      role: 'user',
      text: 'test message',
      timestamp: 1700000000000,
      type: 'content',
      url: 'https://example.com',
    });
  });

  it('listConversations returns empty from in-memory', async () => {
    const convs = await repo.listConversations();
    expect(convs).toEqual([]);
  });

  it('countMessages returns 0 from in-memory', async () => {
    const count = await repo.countMessages('conv-1');
    expect(count).toBe(0);
  });

  it('countMessages returns count when data exists', async () => {
    vi.spyOn(db, 'queryOne').mockResolvedValueOnce({ cnt: 42 } as any);
    const count = await repo.countMessages('conv-1');
    expect(count).toBe(42);
  });

  it('handles errors gracefully without throwing', async () => {
    vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('DB error'));
    // Should not throw, just warn
    await expect(repo.saveMessage('conv-1', { id: 1, role: 'user', text: 'fail' })).resolves.toBeUndefined();
  });
});

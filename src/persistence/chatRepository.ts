/**
 * Chat Repository — persists conversations and messages to SQLite via DbAdapter.
 * Works in Tauri (real SQLite) and browser (InMemoryDbAdapter / no-op).
 */

import type { DbAdapter } from './databaseManager';
import type { ChatMessage } from '../domain/chatEvents';
import { logger } from '../lib/logger';

const repoLogger = logger.scope('persistence:chat');

export class ChatRepository {
  constructor(private db: DbAdapter) {}

  /** Create or resume a conversation. Returns conversation ID. */
  async ensureConversation(conversationId: string): Promise<string> {
    const now = Date.now();
    try {
      await this.db.execute(
        `INSERT INTO conversations (id, started_at, last_activity_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_activity_at = excluded.last_activity_at`,
        [conversationId, now, now],
      );
    } catch (err) {
      repoLogger.warn('ensureConversation failed (in-memory mode?)', err);
    }
    return conversationId;
  }

  /** Persist a single ChatMessage. */
  async saveMessage(conversationId: string, msg: ChatMessage): Promise<void> {
    const role = msg.role ?? 'user';
    const content = msg.text ?? '';
    const ts = msg.timestamp ?? Date.now();
    const metadata = JSON.stringify({
      type: msg.type,
      url: msg.url,
      resolveType: msg.resolveType,
      pageTitle: msg.pageTitle,
    });

    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [String(msg.id), conversationId, role, content, ts, metadata],
      );
      // Touch conversation activity
      await this.db.execute(
        `UPDATE conversations SET last_activity_at = ? WHERE id = ?`,
        [ts, conversationId],
      );
    } catch (err) {
      repoLogger.warn('saveMessage failed', err);
    }
  }

  /** Persist an array of messages (bulk). */
  async saveMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
    for (const msg of messages) {
      await this.saveMessage(conversationId, msg);
    }
  }

  /** Load messages for a conversation (most recent N). */
  async loadMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
    try {
      const rows = await this.db.query<{
        id: string;
        role: string;
        content: string;
        timestamp: number;
        metadata: string;
      }>(
        `SELECT id, role, content, timestamp, metadata FROM messages
         WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?`,
        [conversationId, limit],
      );
      return rows.map((r) => {
        const meta = r.metadata ? JSON.parse(r.metadata) : {};
        return {
          id: Number(r.id),
          role: r.role as ChatMessage['role'],
          text: r.content,
          timestamp: r.timestamp,
          type: meta.type,
          url: meta.url,
          resolveType: meta.resolveType,
          pageTitle: meta.pageTitle,
        } as ChatMessage;
      });
    } catch (err) {
      repoLogger.warn('loadMessages failed', err);
      return [];
    }
  }

  /** List recent conversations. */
  async listConversations(limit = 20): Promise<Array<{ id: string; startedAt: number; lastActivityAt: number }>> {
    try {
      return await this.db.query(
        `SELECT id, started_at as startedAt, last_activity_at as lastActivityAt
         FROM conversations ORDER BY last_activity_at DESC LIMIT ?`,
        [limit],
      );
    } catch {
      return [];
    }
  }

  /** Count messages in a conversation. */
  async countMessages(conversationId: string): Promise<number> {
    try {
      const row = await this.db.queryOne<{ cnt: number }>(
        `SELECT count(*) as cnt FROM messages WHERE conversation_id = ?`,
        [conversationId],
      );
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }
}

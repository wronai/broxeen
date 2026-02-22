/**
 * @module persistence/chatRepository
 * @description Repository for conversations, messages and watch rules.
 *
 * Replaces in-memory EventStore for persistence while keeping
 * EventStore for in-session reactivity (dual-write pattern).
 */

import type { DbAdapter } from "./database";

// ─── Domain Types ───────────────────────────────────────────

export interface Conversation {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  id?: number;
  conversationId: string;
  role: "user" | "assistant" | "system";
  type: "text" | "content" | "image" | "error" | "notification";
  content: string;
  title?: string;
  sourcePlugin?: string;
  sourceUrl?: string;
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface WatchRule {
  id?: number;
  endpointId: string;
  intent: string;
  queryText?: string;
  pluginId: string;
  pollIntervalMs: number;
  watchUntil: number;
  isActive: boolean;
  createdAt: number;
  lastPollAt?: number;
  metadata: Record<string, unknown>;
}

// ─── Repository ─────────────────────────────────────────────

export class ChatRepository {
  constructor(private readonly db: DbAdapter) {}

  // ── Conversations ───────────────────────────────────────

  createConversation(conv: Conversation): void {
    this.db.execute(
      `INSERT INTO conversations (id, title, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [conv.id, conv.title ?? null, conv.createdAt, conv.updatedAt, JSON.stringify(conv.metadata)],
    );
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.queryOne<any>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
    return row ? this.mapConversation(row) : null;
  }

  getRecentConversations(limit = 20): Conversation[] {
    return this.db
      .query<any>(
        "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?",
        [limit],
      )
      .map(this.mapConversation);
  }

  updateConversationTimestamp(id: string): void {
    this.db.execute(
      "UPDATE conversations SET updated_at = ? WHERE id = ?",
      [Date.now(), id],
    );
  }

  // ── Messages ────────────────────────────────────────────

  addMessage(message: ChatMessage): number {
    this.db.execute(
      `INSERT INTO messages (conversation_id, role, type, content, title, source_plugin, source_url, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.conversationId,
        message.role,
        message.type,
        message.content,
        message.title ?? null,
        message.sourcePlugin ?? null,
        message.sourceUrl ?? null,
        message.createdAt,
        JSON.stringify(message.metadata),
      ],
    );
    const row = this.db.queryOne<any>("SELECT last_insert_rowid() as id");
    return row?.id ?? 0;
  }

  getMessages(conversationId: string, limit = 100): ChatMessage[] {
    return this.db
      .query<any>(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC LIMIT ?`,
        [conversationId, limit],
      )
      .map(this.mapMessage);
  }

  getLastMessage(conversationId: string): ChatMessage | null {
    const row = this.db.queryOne<any>(
      `SELECT * FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [conversationId],
    );
    return row ? this.mapMessage(row) : null;
  }

  /** Search messages across all conversations */
  searchMessages(query: string, limit = 50): ChatMessage[] {
    return this.db
      .query<any>(
        `SELECT * FROM messages
         WHERE content LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
        [`%${query}%`, limit],
      )
      .map(this.mapMessage);
  }

  /** Get recent queries by user (for auto-watch detection) */
  getRecentUserQueries(sinceMs: number, conversationId?: string): ChatMessage[] {
    const since = Date.now() - sinceMs;
    if (conversationId) {
      return this.db
        .query<any>(
          `SELECT * FROM messages
           WHERE role = 'user' AND created_at > ? AND conversation_id = ?
           ORDER BY created_at DESC`,
          [since, conversationId],
        )
        .map(this.mapMessage);
    }
    return this.db
      .query<any>(
        `SELECT * FROM messages
         WHERE role = 'user' AND created_at > ?
         ORDER BY created_at DESC`,
        [since],
      )
      .map(this.mapMessage);
  }

  // ── Watch Rules ─────────────────────────────────────────

  addWatchRule(rule: WatchRule): number {
    this.db.execute(
      `INSERT INTO watch_rules (endpoint_id, intent, query_text, plugin_id, poll_interval_ms, watch_until, is_active, created_at, last_poll_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rule.endpointId,
        rule.intent,
        rule.queryText ?? null,
        rule.pluginId,
        rule.pollIntervalMs,
        rule.watchUntil,
        rule.isActive ? 1 : 0,
        rule.createdAt,
        rule.lastPollAt ?? null,
        JSON.stringify(rule.metadata),
      ],
    );
    const row = this.db.queryOne<any>("SELECT last_insert_rowid() as id");
    return row?.id ?? 0;
  }

  getActiveWatchRules(): WatchRule[] {
    const now = Date.now();
    return this.db
      .query<any>(
        `SELECT * FROM watch_rules
         WHERE is_active = 1 AND watch_until > ?
         ORDER BY created_at`,
        [now],
      )
      .map(this.mapWatchRule);
  }

  getWatchRuleForEndpoint(endpointId: string): WatchRule | null {
    const now = Date.now();
    const row = this.db.queryOne<any>(
      `SELECT * FROM watch_rules
       WHERE endpoint_id = ? AND is_active = 1 AND watch_until > ?
       ORDER BY created_at DESC LIMIT 1`,
      [endpointId, now],
    );
    return row ? this.mapWatchRule(row) : null;
  }

  updateWatchPollTime(ruleId: number): void {
    this.db.execute(
      "UPDATE watch_rules SET last_poll_at = ? WHERE id = ?",
      [Date.now(), ruleId],
    );
  }

  deactivateWatchRule(ruleId: number): void {
    this.db.execute(
      "UPDATE watch_rules SET is_active = 0 WHERE id = ?",
      [ruleId],
    );
  }

  /** Expire all rules past their watch_until time */
  expireWatchRules(): number {
    const now = Date.now();
    this.db.execute(
      "UPDATE watch_rules SET is_active = 0 WHERE is_active = 1 AND watch_until <= ?",
      [now],
    );
    return 0;
  }

  // ── Row Mappers ─────────────────────────────────────────

  private mapConversation(row: any): Conversation {
    return {
      id: row.id,
      title: row.title ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private mapMessage(row: any): ChatMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      type: row.type,
      content: row.content,
      title: row.title ?? undefined,
      sourcePlugin: row.source_plugin ?? undefined,
      sourceUrl: row.source_url ?? undefined,
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private mapWatchRule(row: any): WatchRule {
    return {
      id: row.id,
      endpointId: row.endpoint_id,
      intent: row.intent,
      queryText: row.query_text ?? undefined,
      pluginId: row.plugin_id,
      pollIntervalMs: row.poll_interval_ms,
      watchUntil: row.watch_until,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastPollAt: row.last_poll_at ?? undefined,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }
}

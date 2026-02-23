/**
 * History Repository — persists command history and network history to SQLite.
 * Replaces localStorage-based history in Chat.tsx.
 */

import type { DbAdapter } from './databaseManager';
import { logger } from '../lib/logger';

const repoLogger = logger.scope('persistence:history');

export interface CommandHistoryRow {
  id: string;
  command: string;
  result: string | null;
  category: string;
  success: boolean;
  timestamp: number;
}

export interface NetworkHistoryRow {
  id: string;
  address: string;
  name: string;
  scope: string;
  description: string | null;
  last_used: number;
  usage_count: number;
}

export class HistoryRepository {
  constructor(private db: DbAdapter) {}

  // ── Command History ──────────────────────────────────────────

  async saveCommand(entry: {
    id: string;
    command: string;
    result?: string;
    category?: string;
    success?: boolean;
    timestamp: number;
  }): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO command_history (id, command, result, category, success, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           result = excluded.result,
           category = excluded.category,
           success = excluded.success,
           timestamp = excluded.timestamp`,
        [
          entry.id,
          entry.command,
          entry.result ?? null,
          entry.category ?? 'other',
          entry.success !== false ? 1 : 0,
          entry.timestamp,
        ],
      );
    } catch (err) {
      repoLogger.warn('saveCommand failed', err);
    }
  }

  async upsertCommand(command: string, result?: string, category = 'other', success = true): Promise<void> {
    const now = Date.now();
    try {
      // Check if command already exists
      const existing = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM command_history WHERE command = ?',
        [command],
      );

      if (existing) {
        await this.db.execute(
          `UPDATE command_history SET result = ?, category = ?, success = ?, timestamp = ? WHERE id = ?`,
          [result ?? null, category, success ? 1 : 0, now, existing.id],
        );
      } else {
        await this.db.execute(
          `INSERT INTO command_history (id, command, result, category, success, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [String(now), command, result ?? null, category, success ? 1 : 0, now],
        );
      }
    } catch (err) {
      repoLogger.warn('upsertCommand failed', err);
    }
  }

  async listCommands(limit = 50): Promise<CommandHistoryRow[]> {
    try {
      const rows = await this.db.query<{
        id: string;
        command: string;
        result: string | null;
        category: string;
        success: number;
        timestamp: number;
      }>(
        'SELECT id, command, result, category, success, timestamp FROM command_history ORDER BY timestamp DESC LIMIT ?',
        [limit],
      );
      return rows.map((r) => ({
        ...r,
        success: r.success === 1,
      }));
    } catch {
      return [];
    }
  }

  // ── Network History ──────────────────────────────────────────

  async saveNetworkEntry(entry: {
    address: string;
    name: string;
    scope: string;
    description?: string;
  }): Promise<void> {
    const now = Date.now();
    try {
      const existing = await this.db.queryOne<{ id: string; usage_count: number }>(
        'SELECT id, usage_count FROM network_history WHERE address = ?',
        [entry.address],
      );

      if (existing) {
        await this.db.execute(
          `UPDATE network_history SET name = ?, scope = ?, description = ?, last_used = ?, usage_count = ? WHERE id = ?`,
          [entry.name, entry.scope, entry.description ?? null, now, existing.usage_count + 1, existing.id],
        );
      } else {
        await this.db.execute(
          `INSERT INTO network_history (id, address, name, scope, description, last_used, usage_count)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [String(now), entry.address, entry.name, entry.scope, entry.description ?? null, now],
        );
      }
    } catch (err) {
      repoLogger.warn('saveNetworkEntry failed', err);
    }
  }

  async listNetworkHistory(limit = 10): Promise<NetworkHistoryRow[]> {
    try {
      return await this.db.query<NetworkHistoryRow>(
        'SELECT id, address, name, scope, description, last_used, usage_count FROM network_history ORDER BY last_used DESC LIMIT ?',
        [limit],
      );
    } catch {
      return [];
    }
  }

  async getNetworkEntryByAddress(address: string): Promise<NetworkHistoryRow | null> {
    try {
      return await this.db.queryOne<NetworkHistoryRow>(
        'SELECT id, address, name, scope, description, last_used, usage_count FROM network_history WHERE address = ?',
        [address],
      );
    } catch {
      return null;
    }
  }
}

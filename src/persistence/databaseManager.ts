/**
 * Database Manager - handles SQLite connections, migrations, and connection pooling
 * Provides unified access to devices.db and chat.db with adapter pattern
 *
 * Architecture:
 *   Tauri mode  → TauriDbAdapter → invoke('db_execute'/'db_query'/'db_close') → Rust rusqlite
 *   Browser/test → InMemoryDbAdapter (no-op, returns empty results)
 */

import { devicesDbMigrations, chatDbMigrations } from './migrations';
import type { DatabaseConfig, Migration } from './types';
import { logger } from '../lib/logger';

const dbLogger = logger.scope('persistence:db');

// Database Adapter Interface (DIP)
export interface DbAdapter {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  close(): Promise<void>;
  readonly dbPath: string;
  readonly isOpen: boolean;
}

// Tauri SQLite Adapter — calls Rust db_execute/db_query/db_close via invoke
export class TauriDbAdapter implements DbAdapter {
  private _isOpen = true;
  readonly dbPath: string;
  private tauriInvoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  constructor(dbPath: string, tauriInvoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
    this.dbPath = dbPath;
    this.tauriInvoke = tauriInvoke;
    dbLogger.info('TauriDbAdapter created', { dbPath });
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    await this.tauriInvoke('db_execute', { db: this.dbPath, sql, params });
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.tauriInvoke('db_query', { db: this.dbPath, sql, params });
    return (rows as T[]) ?? [];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async close(): Promise<void> {
    this._isOpen = false;
    await this.tauriInvoke('db_close', { db: this.dbPath });
    dbLogger.info('TauriDbAdapter closed', { dbPath: this.dbPath });
  }
}

// In-Memory Adapter (for browser/testing — no real SQLite)
export class InMemoryDbAdapter implements DbAdapter {
  private _isOpen = true;
  readonly dbPath: string;
  private store = new Map<string, Record<string, unknown>[]>();

  constructor(dbPath = ':memory:') {
    this.dbPath = dbPath;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  async execute(_sql: string, _params: unknown[] = []): Promise<void> {
    // No-op for in-memory
  }

  async query<T = Record<string, unknown>>(_sql: string, _params: unknown[] = []): Promise<T[]> {
    return [] as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async close(): Promise<void> {
    this._isOpen = false;
    this.store.clear();
  }
}

export class DatabaseManager {
  private devicesDb: DbAdapter | null = null;
  private chatDb: DbAdapter | null = null;
  private config: DatabaseConfig;
  private tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  private isInitialized = false;

  constructor(
    config: DatabaseConfig,
    tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.config = config;
    this.tauriInvoke = tauriInvoke;
  }

  /**
   * Initialize both databases with migrations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    dbLogger.info('Initializing databases...', {
      devicesDb: this.config.devicesDbPath,
      chatDb: this.config.chatDbPath,
      mode: this.tauriInvoke ? 'tauri' : 'in-memory',
    });

    try {
      if (this.tauriInvoke) {
        this.devicesDb = new TauriDbAdapter(this.config.devicesDbPath, this.tauriInvoke);
        this.chatDb = new TauriDbAdapter(this.config.chatDbPath, this.tauriInvoke);
      } else {
        this.devicesDb = new InMemoryDbAdapter(this.config.devicesDbPath);
        this.chatDb = new InMemoryDbAdapter(this.config.chatDbPath);
      }

      // Run migrations
      await this.runMigrations(this.devicesDb, devicesDbMigrations, 'devices');
      await this.runMigrations(this.chatDb, chatDbMigrations, 'chat');

      this.isInitialized = true;
      dbLogger.info('Databases initialized successfully');
    } catch (error) {
      dbLogger.error('Failed to initialize databases', error);
      await this.close();
      throw error;
    }
  }

  getDevicesDb(): DbAdapter {
    if (!this.devicesDb) throw new Error('Devices database not initialized');
    return this.devicesDb;
  }

  getChatDb(): DbAdapter {
    if (!this.chatDb) throw new Error('Chat database not initialized');
    return this.chatDb;
  }

  private async runMigrations(db: DbAdapter, migrations: Migration[], dbName: string): Promise<void> {
    // Create migrations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    const applied = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    const appliedSet = new Set(applied.map(v => v.version));

    for (const migration of migrations) {
      if (!appliedSet.has(migration.version)) {
        dbLogger.info(`Running migration ${migration.version} for ${dbName}: ${migration.description}`);
        try {
          // Migrations use exec() which maps to execute()
          migration.up({ exec: (sql: string) => { db.execute(sql); } });

          await db.execute(
            'INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)',
            [migration.version, migration.description, Date.now()],
          );
          dbLogger.info(`Migration ${migration.version} applied for ${dbName}`);
        } catch (error) {
          dbLogger.error(`Migration ${migration.version} failed for ${dbName}`, error);
          throw error;
        }
      }
    }
  }

  async transaction<T>(callback: (devicesDb: DbAdapter, chatDb: DbAdapter) => Promise<T>): Promise<T> {
    if (!this.devicesDb || !this.chatDb) throw new Error('Databases not initialized');
    return callback(this.devicesDb, this.chatDb);
  }

  async getStats(): Promise<{
    devices: { tableCount: number };
    chat: { tableCount: number };
  }> {
    if (!this.devicesDb || !this.chatDb) throw new Error('Databases not initialized');

    const countTables = async (db: DbAdapter) => {
      try {
        const rows = await db.query<{ cnt: number }>("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        return { tableCount: rows[0]?.cnt ?? 0 };
      } catch {
        return { tableCount: 0 };
      }
    };

    return {
      devices: await countTables(this.devicesDb),
      chat: await countTables(this.chatDb),
    };
  }

  async close(): Promise<void> {
    dbLogger.info('Closing database connections...');
    if (this.devicesDb) { await this.devicesDb.close(); this.devicesDb = null; }
    if (this.chatDb) { await this.chatDb.close(); this.chatDb = null; }
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized && this.devicesDb !== null && this.chatDb !== null;
  }
}

/**
 * Database Manager - handles SQLite connections, migrations, and connection pooling
 * Provides unified access to devices.db and chat.db with adapter pattern
 */

import Database from 'better-sqlite3';
import { devicesDbMigrations, chatDbMigrations } from './migrations';
import type { DatabaseConfig, Migration } from './types';

// Database Adapter Interface (DIP)
export interface DbAdapter {
  execute(sql: string, params?: unknown[]): void;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  prepare(sql: string): Database.Statement;
  close(): void;
  readonly isOpen: boolean;
}

// SQLite Adapter (better-sqlite3)
export class SQLiteAdapter implements DbAdapter {
  private db: Database.Database;
  private _isOpen = true;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  execute(sql: string, params: unknown[] = []): void {
    this.db.exec(sql);
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    return this.db.prepare(sql).get(...params) as T | null;
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  close(): void {
    this._isOpen = false;
    this.db.close();
  }
}

// In-Memory Adapter (for browser/testing)
export class InMemoryDbAdapter implements DbAdapter {
  private tables = new Map<string, unknown[]>();
  private _isOpen = true;
  private autoId = 0;

  get isOpen(): boolean {
    return this._isOpen;
  }

  execute(sql: string, _params: unknown[] = []): void {
    // Minimal SQL parser for CREATE TABLE and PRAGMA
    if (sql.includes("PRAGMA") || sql.includes("CREATE")) return;
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return [] as T[];
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results[0] ?? null;
  }

  prepare(sql: string): Database.Statement {
    // Mock implementation for in-memory adapter
    return {
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
      all: () => [],
      get: () => null,
    } as unknown as Database.Statement;
  }

  close(): void {
    this._isOpen = false;
    this.tables.clear();
  }
}

export class DatabaseManager {
  private devicesDb: DbAdapter | null = null;
  private chatDb: DbAdapter | null = null;
  private config: DatabaseConfig;
  private isInitialized = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize both databases with migrations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('🗄️ Initializing databases...');

    try {
      // Initialize devices database
      if (this.config.connectionPoolSize > 0) {
        // Use better-sqlite3 for production
        this.devicesDb = new SQLiteAdapter(this.config.devicesDbPath);
      } else {
        // Use in-memory for testing
        this.devicesDb = new InMemoryDbAdapter();
      }

      // Run migrations for devices database
      await this.runMigrations(this.devicesDb, devicesDbMigrations, 'devices');

      // Initialize chat database
      if (this.config.connectionPoolSize > 0) {
        this.chatDb = new SQLiteAdapter(this.config.chatDbPath);
      } else {
        this.chatDb = new InMemoryDbAdapter();
      }

      // Run migrations for chat database
      await this.runMigrations(this.chatDb, chatDbMigrations, 'chat');

      this.isInitialized = true;
      console.log('✅ Databases initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize databases:', error);
      await this.close();
      throw error;
    }
  }

  /**
   * Get devices database instance
   */
  getDevicesDb(): DbAdapter {
    if (!this.devicesDb) {
      throw new Error('Devices database not initialized');
    }
    return this.devicesDb;
  }

  /**
   * Get chat database instance
   */
  getChatDb(): DbAdapter {
    if (!this.chatDb) {
      throw new Error('Chat database not initialized');
    }
    return this.chatDb;
  }

  /**
   * Run migrations for a database
   */
  private async runMigrations(db: DbAdapter, migrations: Migration[], dbName: string): Promise<void> {
    // Create migrations table
    db.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    // Get applied migrations
    const appliedVersions = db.query('SELECT version FROM schema_migrations ORDER BY version').map((v: any) => v.version);
    const appliedVersionSet = new Set(appliedVersions);

    // Run pending migrations
    for (const migration of migrations) {
      if (!appliedVersionSet.has(migration.version)) {
        console.log(`🔄 Running migration ${migration.version} for ${dbName}: ${migration.description}`);
        
        try {
          migration.up(db as any);
          
          // Record migration
          db.execute(`
            INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)
          `, [migration.version, migration.description, Date.now()]);
          
          console.log(`✅ Migration ${migration.version} applied successfully`);
        } catch (error) {
          console.error(`❌ Migration ${migration.version} failed:`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Execute a transaction across both databases
   */
  async transaction<T>(callback: (devicesDb: DbAdapter, chatDb: DbAdapter) => T): Promise<T> {
    if (!this.devicesDb || !this.chatDb) {
      throw new Error('Databases not initialized');
    }

    // For simplicity, we'll run the callback with both databases
    // In a production environment, you might want more sophisticated cross-database transaction handling
    return callback(this.devicesDb, this.chatDb);
  }

  /**
   * Get database statistics
   */
  getStats(): {
    devices: { tables: Record<string, number> };
    chat: { tables: Record<string, number> };
  } {
    if (!this.devicesDb || !this.chatDb) {
      throw new Error('Databases not initialized');
    }

    const getTableStats = (db: DbAdapter) => {
      // Simplified - in production you'd query actual table stats
      return {
        tables: {
          devices: 0,
          device_services: 0,
          content_snapshots: 0,
          change_history: 0,
          conversations: 0,
          messages: 0,
          watch_rules: 0
        }
      };
    };

    return {
      devices: getTableStats(this.devicesDb),
      chat: getTableStats(this.chatDb)
    };
  }

  /**
   * Close all database connections
   */
  async close(): Promise<void> {
    console.log('🔒 Closing database connections...');
    
    if (this.devicesDb) {
      this.devicesDb.close();
      this.devicesDb = null;
    }
    
    if (this.chatDb) {
      this.chatDb.close();
      this.chatDb = null;
    }
    
    this.isInitialized = false;
    console.log('✅ Database connections closed');
  }

  /**
   * Check if databases are initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.devicesDb !== null && this.chatDb !== null;
  }
}

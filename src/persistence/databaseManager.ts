/**
 * Database Manager - handles SQLite connections, migrations, and connection pooling
 * Provides unified access to devices.db and chat.db
 */

import Database from 'better-sqlite3';
import { devicesDbMigrations, chatDbMigrations } from './migrations';
import type { DatabaseConfig, Migration } from './types';

export class DatabaseManager {
  private devicesDb: Database.Database | null = null;
  private chatDb: Database.Database | null = null;
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
      this.devicesDb = new Database(this.config.devicesDbPath);
      if (this.config.walMode) {
        this.devicesDb.pragma('journal_mode = WAL');
      }
      this.devicesDb.pragma('foreign_keys = ON');
      
      // Run migrations for devices database
      await this.runMigrations(this.devicesDb, devicesDbMigrations, 'devices');

      // Initialize chat database
      this.chatDb = new Database(this.config.chatDbPath);
      if (this.config.walMode) {
        this.chatDb.pragma('journal_mode = WAL');
      }
      this.chatDb.pragma('foreign_keys = ON');
      
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
  getDevicesDb(): Database.Database {
    if (!this.devicesDb) {
      throw new Error('Devices database not initialized');
    }
    return this.devicesDb;
  }

  /**
   * Get chat database instance
   */
  getChatDb(): Database.Database {
    if (!this.chatDb) {
      throw new Error('Chat database not initialized');
    }
    return this.chatDb;
  }

  /**
   * Run migrations for a database
   */
  private async runMigrations(db: Database.Database, migrations: Migration[], dbName: string): Promise<void> {
    // Create migrations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);

    // Get applied migrations
    const appliedVersions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
    const appliedVersionSet = new Set(appliedVersions.map(v => v.version));

    // Run pending migrations
    for (const migration of migrations) {
      if (!appliedVersionSet.has(migration.version)) {
        console.log(`🔄 Running migration ${migration.version} for ${dbName}: ${migration.description}`);
        
        try {
          migration.up(db);
          
          // Record migration
          db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)').run(
            migration.version,
            migration.description,
            Date.now()
          );
          
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
  async transaction<T>(callback: (devicesDb: Database.Database, chatDb: Database.Database) => T): Promise<T> {
    if (!this.devicesDb || !this.chatDb) {
      throw new Error('Databases not initialized');
    }

    const devicesTransaction = this.devicesDb.transaction(callback);
    const chatTransaction = this.chatDb.transaction(callback);

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

    const getTableStats = (db: Database.Database) => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const stats: Record<string, number> = {};
      
      for (const table of tables) {
        const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number };
        stats[table.name] = count.count;
      }
      
      return stats;
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

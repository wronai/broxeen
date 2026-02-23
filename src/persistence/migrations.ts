/**
 * Database migrations for Broxeen v2.1
 * Defines schema evolution for devices.db and chat.db
 */

import type { Migration } from './types';

export const devicesDbMigrations: Migration[] = [
  {
    version: 1,
    description: 'Create initial devices schema',
    up: (db) => {
      // Devices table
      db.exec(`
        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          ip TEXT NOT NULL UNIQUE,
          hostname TEXT,
          mac TEXT,
          vendor TEXT,
          last_seen INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      // Device services table
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_services (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('http', 'rtsp', 'mqtt', 'ssh', 'api')),
          port INTEGER NOT NULL,
          path TEXT,
          status TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('online', 'offline', 'unknown')),
          last_checked INTEGER NOT NULL,
          metadata TEXT, -- JSON
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        )
      `);

      // Content snapshots table
      db.exec(`
        CREATE TABLE IF NOT EXISTS content_snapshots (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          service_id TEXT NOT NULL,
          content TEXT NOT NULL,
          content_type TEXT NOT NULL,
          hash TEXT NOT NULL,
          size INTEGER NOT NULL,
          captured_at INTEGER NOT NULL,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
          FOREIGN KEY (service_id) REFERENCES device_services(id) ON DELETE CASCADE
        )
      `);

      // Change history table
      db.exec(`
        CREATE TABLE IF NOT EXISTS change_history (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          service_id TEXT NOT NULL,
          previous_snapshot_id TEXT NOT NULL,
          current_snapshot_id TEXT NOT NULL,
          change_type TEXT NOT NULL CHECK (change_type IN ('content', 'status', 'metadata')),
          change_score REAL NOT NULL,
          detected_at INTEGER NOT NULL,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
          FOREIGN KEY (service_id) REFERENCES device_services(id) ON DELETE CASCADE,
          FOREIGN KEY (previous_snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE,
          FOREIGN KEY (current_snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
        )
      `);

      // Indexes for performance
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
        CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
        CREATE INDEX IF NOT EXISTS idx_device_services_device_id ON device_services(device_id);
        CREATE INDEX IF NOT EXISTS idx_device_services_type_port ON device_services(type, port);
        CREATE INDEX IF NOT EXISTS idx_content_snapshots_device_service ON content_snapshots(device_id, service_id);
        CREATE INDEX IF NOT EXISTS idx_content_snapshots_captured_at ON content_snapshots(captured_at);
        CREATE INDEX IF NOT EXISTS idx_change_history_device_id ON change_history(device_id);
        CREATE INDEX IF NOT EXISTS idx_change_history_detected_at ON change_history(detected_at);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS change_history;
        DROP TABLE IF EXISTS content_snapshots;
        DROP TABLE IF EXISTS device_services;
        DROP TABLE IF EXISTS devices;
      `);
    }
  }
  ,
  {
    version: 2,
    description: 'Add scan_history table for network scan analytics',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scan_history (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          scope TEXT NOT NULL,
          subnet TEXT NOT NULL,
          device_count INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL,
          success INTEGER NOT NULL DEFAULT 1,
          error TEXT,
          metadata TEXT -- JSON
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_scan_history_timestamp ON scan_history(timestamp);
        CREATE INDEX IF NOT EXISTS idx_scan_history_subnet ON scan_history(subnet);
        CREATE INDEX IF NOT EXISTS idx_scan_history_scope ON scan_history(scope);
        CREATE INDEX IF NOT EXISTS idx_scan_history_success ON scan_history(success);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS scan_history;
      `);
    }
  }
];

export const chatDbMigrations: Migration[] = [
  {
    version: 1,
    description: 'Create initial chat schema',
    up: (db) => {

      // Conversations table
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          started_at INTEGER NOT NULL,
          last_activity_at INTEGER NOT NULL,
          metadata TEXT -- JSON
        )
      `);

      // Messages table
      db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          metadata TEXT, -- JSON
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);

      // Watch rules table
      db.exec(`
        CREATE TABLE IF NOT EXISTS watch_rules (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('device', 'service')),
          intent TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          poll_interval_ms INTEGER NOT NULL,
          change_threshold REAL NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          last_polled INTEGER,
          last_change_detected INTEGER,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);

      // Indexes for performance
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_conversations_started_at ON conversations(started_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations(last_activity_at);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_watch_rules_conversation_id ON watch_rules(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_watch_rules_target_id ON watch_rules(target_id);
        CREATE INDEX IF NOT EXISTS idx_watch_rules_expires_at ON watch_rules(expires_at);
        CREATE INDEX IF NOT EXISTS idx_watch_rules_is_active ON watch_rules(is_active);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS watch_rules;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversations;
      `);
    }
  },
  {
    version: 2,
    description: 'Add command_history and network_history tables',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS command_history (
          id TEXT PRIMARY KEY,
          command TEXT NOT NULL,
          result TEXT,
          category TEXT NOT NULL DEFAULT 'other',
          success INTEGER NOT NULL DEFAULT 1,
          timestamp INTEGER NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS network_history (
          id TEXT PRIMARY KEY,
          address TEXT NOT NULL,
          name TEXT NOT NULL,
          scope TEXT NOT NULL,
          description TEXT,
          last_used INTEGER NOT NULL,
          usage_count INTEGER NOT NULL DEFAULT 1
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_history_timestamp ON command_history(timestamp);
        CREATE INDEX IF NOT EXISTS idx_command_history_category ON command_history(category);
        CREATE INDEX IF NOT EXISTS idx_network_history_last_used ON network_history(last_used);
        CREATE INDEX IF NOT EXISTS idx_network_history_address ON network_history(address);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS network_history;
        DROP TABLE IF EXISTS command_history;
      `);
    }
  }
];

export const devicesDbMigrationV3: Migration[] = [
  {
    version: 3,
    description: 'Add configured_devices table for persistent device configurations',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS configured_devices (
          id TEXT PRIMARY KEY,
          device_id TEXT,
          label TEXT NOT NULL,
          ip TEXT NOT NULL,
          device_type TEXT NOT NULL DEFAULT 'camera'
            CHECK (device_type IN ('camera', 'server', 'sensor', 'other')),
          rtsp_url TEXT,
          http_url TEXT,
          username TEXT,
          password TEXT,
          stream_path TEXT,
          monitor_enabled INTEGER NOT NULL DEFAULT 1,
          monitor_interval_ms INTEGER NOT NULL DEFAULT 3000,
          last_snapshot_at INTEGER,
          notes TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_configured_devices_ip ON configured_devices(ip);
        CREATE INDEX IF NOT EXISTS idx_configured_devices_type ON configured_devices(device_type);
        CREATE INDEX IF NOT EXISTS idx_configured_devices_monitor ON configured_devices(monitor_enabled);
      `);
    },
    down: (db) => {
      db.exec(`DROP TABLE IF EXISTS configured_devices`);
    }
  }
];

export const devicesDbMigrationV4: Migration[] = [
  {
    version: 4,
    description: 'Add monitor_change_threshold to configured_devices',
    up: (db) => {
      db.exec(`
        ALTER TABLE configured_devices ADD COLUMN monitor_change_threshold REAL NOT NULL DEFAULT 0.15;
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_configured_devices_change_threshold ON configured_devices(monitor_change_threshold);
      `);
    },
    down: (db) => {
      // SQLite doesn't support DROP COLUMN; no-op.
    },
  },
];

// Append v3 migrations to devices DB migrations
devicesDbMigrations.push(...devicesDbMigrationV3);
devicesDbMigrations.push(...devicesDbMigrationV4);

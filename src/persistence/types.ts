/**
 * Persistence layer types for Broxeen v2.1
 * Defines database schemas and data structures
 */

export interface Device {
  id: string;
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceService {
  id: string;
  deviceId: string;
  type: 'http' | 'rtsp' | 'mqtt' | 'ssh' | 'api';
  port: number;
  path?: string;
  status: 'online' | 'offline' | 'unknown';
  lastChecked: Date;
  metadata?: Record<string, unknown>;
}

export interface ContentSnapshot {
  id: string;
  deviceId: string;
  serviceId: string;
  content: string;
  contentType: string;
  hash: string;
  size: number;
  capturedAt: Date;
}

export interface ChangeHistory {
  id: string;
  deviceId: string;
  serviceId: string;
  previousSnapshotId: string;
  currentSnapshotId: string;
  changeType: 'content' | 'status' | 'metadata';
  changeScore: number;
  detectedAt: Date;
}

export interface Conversation {
  id: string;
  startedAt: Date;
  lastActivityAt: Date;
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface WatchRule {
  id: string;
  conversationId: string;
  targetId: string; // device or service ID
  targetType: 'device' | 'service';
  intent: string;
  startedAt: Date;
  expiresAt: Date;
  pollIntervalMs: number;
  changeThreshold: number;
  isActive: boolean;
  lastPolled?: Date;
  lastChangeDetected?: Date;
}

export interface DatabaseConfig {
  devicesDbPath: string;
  chatDbPath: string;
  walMode: boolean;
  connectionPoolSize: number;
}

export interface Migration {
  version: number;
  description: string;
  up: (db: import('better-sqlite3').Database) => void;
  down: (db: import('better-sqlite3').Database) => void;
}

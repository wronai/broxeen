/**
 * Reactive layer types for Broxeen v2.1
 * Defines watch management and change detection interfaces
 */

export interface WatchRule {
  id: string;
  conversationId: string;
  targetId: string;
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

export interface ChangeDetectedEvent {
  id: string;
  watchRuleId: string;
  targetId: string;
  targetType: 'device' | 'service';
  changeType: 'content' | 'status' | 'metadata';
  changeScore: number;
  previousContent?: string;
  currentContent?: string;
  detectedAt: Date;
  summary: string;
}

export interface WatchConfig {
  defaultDurationMs: number;
  defaultPollIntervalMs: number;
  defaultChangeThreshold: number;
  maxConcurrentWatches: number;
  cleanupIntervalMs: number;
}

export interface ChangeDetectionResult {
  hasChanged: boolean;
  changeScore: number;
  changeType: 'content' | 'status' | 'metadata';
  previousSnapshot?: string;
  currentSnapshot?: string;
  summary: string;
}

export interface WatchManagerEvent {
  type: 'watch_started' | 'watch_expired' | 'watch_cancelled' | 'change_detected';
  timestamp: Date;
  data: any;
}

export interface PollingStats {
  totalPolls: number;
  successfulPolls: number;
  failedPolls: number;
  changesDetected: number;
  averagePollTime: number;
  lastPollTime: Date;
}

/**
 * Watch Manager - manages watch rules and automatic monitoring
 * Handles time windows, polling, and change notifications
 */

import type { 
  WatchRule, 
  ChangeDetectedEvent, 
  WatchConfig, 
  WatchManagerEvent,
  PollingStats 
} from './types';
import { ChangeDetector } from './changeDetector';
import { DatabaseManager } from '../persistence/databaseManager';
import type { WatchRule as DbWatchRule } from '../persistence/types';

export class WatchManager {
  private config: WatchConfig;
  private dbManager: DatabaseManager;
  private changeDetector: ChangeDetector;
  private eventListeners: ((event: WatchManagerEvent) => void)[] = [];
  private pollingIntervals = new Map<string, NodeJS.Timeout>();
  private isRunning = false;
  private stats: PollingStats = {
    totalPolls: 0,
    successfulPolls: 0,
    failedPolls: 0,
    changesDetected: 0,
    averagePollTime: 0,
    lastPollTime: new Date()
  };

  constructor(config: WatchConfig, dbManager: DatabaseManager) {
    this.config = config;
    this.dbManager = dbManager;
    this.changeDetector = new ChangeDetector(dbManager);
  }

  /**
   * Start the watch manager
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    console.log('⏰ Starting Watch Manager...');
    this.isRunning = true;

    // Load existing active watch rules
    await this.loadActiveWatches();

    // Start cleanup interval
    this.startCleanupInterval();

    console.log(`✅ Watch Manager started with ${this.pollingIntervals.size} active watches`);
  }

  /**
   * Stop the watch manager
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('⏹️ Stopping Watch Manager...');
    this.isRunning = false;

    // Clear all polling intervals
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();

    console.log('✅ Watch Manager stopped');
  }

  /**
   * Create a new watch rule
   */
  async createWatchRule(params: {
    conversationId: string;
    targetId: string;
    targetType: 'device' | 'service';
    intent: string;
    durationMs?: number;
    pollIntervalMs?: number;
    changeThreshold?: number;
  }): Promise<WatchRule> {
    const now = new Date();
    const watchRule: DbWatchRule = {
      id: crypto.randomUUID(),
      conversationId: params.conversationId,
      targetId: params.targetId,
      targetType: params.targetType,
      intent: params.intent,
      startedAt: now,
      expiresAt: new Date(now.getTime() + (params.durationMs || this.config.defaultDurationMs)),
      pollIntervalMs: params.pollIntervalMs || this.config.defaultPollIntervalMs,
      changeThreshold: params.changeThreshold || this.config.defaultChangeThreshold,
      isActive: true
    };

    // Save to database
    await this.saveWatchRule(watchRule);

    // Start polling if watch manager is running
    if (this.isRunning) {
      this.startPolling(watchRule);
    }

    this.emitEvent({
      type: 'watch_started',
      timestamp: new Date(),
      data: watchRule
    });

    console.log(`👁️ Created watch rule: ${params.targetType}:${params.targetId} for ${params.intent}`);
    return watchRule;
  }

  /**
   * Auto-watch based on recent query (time window logic)
   */
  async autoWatch(
    conversationId: string,
    targetId: string,
    targetType: 'device' | 'service',
    intent: string
  ): Promise<void> {
    // Check if there was a recent query for this target
    const recentQuery = await this.findRecentQuery(conversationId, targetId, targetType, intent);
    
    if (recentQuery) {
      console.log(`🕐 Auto-watching ${targetType}:${targetId} based on recent query`);
      await this.createWatchRule({
        conversationId,
        targetId,
        targetType,
        intent,
        durationMs: this.config.defaultDurationMs
      });
    }
  }

  /**
   * Cancel a watch rule
   */
  async cancelWatchRule(watchRuleId: string): Promise<void> {
    const watchRule = await this.getWatchRule(watchRuleId);
    if (!watchRule) {
      throw new Error(`Watch rule ${watchRuleId} not found`);
    }

    // Stop polling
    this.stopPolling(watchRuleId);

    // Mark as inactive in database
    await this.updateWatchRule(watchRuleId, { isActive: false });

    this.emitEvent({
      type: 'watch_cancelled',
      timestamp: new Date(),
      data: { watchRuleId, targetId: watchRule.targetId }
    });

    console.log(`🚫 Cancelled watch rule: ${watchRuleId}`);
  }

  /**
   * Load active watch rules from database
   */
  private async loadActiveWatches(): Promise<void> {
    if (!this.dbManager.isReady()) {
      return;
    }

    const db = this.dbManager.getChatDb();
    const now = Date.now();

    const rows = await db.query<any>(
      `
      SELECT * FROM watch_rules 
      WHERE is_active = 1 AND expires_at > ?
    `,
      [now],
    );

    for (const row of rows) {
      const watchRule: DbWatchRule = {
        id: row.id,
        conversationId: row.conversation_id,
        targetId: row.target_id,
        targetType: row.target_type,
        intent: row.intent,
        startedAt: new Date(row.started_at),
        expiresAt: new Date(row.expires_at),
        pollIntervalMs: row.poll_interval_ms,
        changeThreshold: row.change_threshold,
        isActive: Boolean(row.is_active),
        lastPolled: row.last_polled ? new Date(row.last_polled) : undefined,
        lastChangeDetected: row.last_change_detected ? new Date(row.last_change_detected) : undefined
      };

      this.startPolling(watchRule);
    }
  }

  /**
   * Start polling for a watch rule
   */
  private startPolling(watchRule: DbWatchRule): void {
    if (this.pollingIntervals.has(watchRule.id)) {
      return; // Already polling
    }

    const interval = setInterval(async () => {
      await this.pollTarget(watchRule);
    }, watchRule.pollIntervalMs);

    this.pollingIntervals.set(watchRule.id, interval);
  }

  /**
   * Stop polling for a watch rule
   */
  private stopPolling(watchRuleId: string): void {
    const interval = this.pollingIntervals.get(watchRuleId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(watchRuleId);
    }
  }

  /**
   * Poll a target for changes
   */
  private async pollTarget(watchRule: DbWatchRule): Promise<void> {
    const startTime = Date.now();
    this.stats.totalPolls++;

    try {
      // Get current content from the target
      const currentContent = await this.fetchTargetContent(watchRule.targetId, watchRule.targetType);
      
      if (currentContent === null) {
        console.warn(`⚠️ Failed to fetch content for ${watchRule.targetType}:${watchRule.targetId}`);
        this.stats.failedPolls++;
        return;
      }

      // Detect changes
      const changeResult = await this.changeDetector.detectChanges(
        watchRule.targetId,
        watchRule.targetType,
        currentContent,
        'text/plain',
        watchRule.changeThreshold
      );

      // Update last polled time
      await this.updateWatchRule(watchRule.id, { lastPolled: new Date() });

      if (changeResult.hasChanged) {
        this.stats.changesDetected++;
        
        // Update last change detected time
        await this.updateWatchRule(watchRule.id, { lastChangeDetected: new Date() });

        // Emit change detected event
        const changeEvent: ChangeDetectedEvent = {
          id: crypto.randomUUID(),
          watchRuleId: watchRule.id,
          targetId: watchRule.targetId,
          targetType: watchRule.targetType,
          changeType: changeResult.changeType,
          changeScore: changeResult.changeScore,
          previousContent: changeResult.previousSnapshot,
          currentContent: changeResult.currentSnapshot,
          detectedAt: new Date(),
          summary: changeResult.summary
        };

        this.emitEvent({
          type: 'change_detected',
          timestamp: new Date(),
          data: changeEvent
        });

        console.log(`🔔 Change detected for ${watchRule.targetType}:${watchRule.targetId} - ${changeResult.summary}`);
      }

      this.stats.successfulPolls++;

    } catch (error) {
      console.error(`❌ Error polling ${watchRule.targetType}:${watchRule.targetId}:`, error);
      this.stats.failedPolls++;
    } finally {
      // Update stats
      const pollTime = Date.now() - startTime;
      this.stats.averagePollTime = (this.stats.averagePollTime * (this.stats.totalPolls - 1) + pollTime) / this.stats.totalPolls;
      this.stats.lastPollTime = new Date();
    }
  }

  /**
   * Fetch current content from a target
   */
  private async fetchTargetContent(targetId: string, targetType: 'device' | 'service'): Promise<string | null> {
    try {
      if (targetType === 'device') {
        // For devices, we might fetch a summary page or status
        // This is a simplified implementation
        return `Device ${targetId} status at ${new Date().toISOString()}`;
      } else {
        // For services, we'd fetch the service endpoint
        // This is a simplified implementation
        const response = await fetch(`http://localhost/${targetId}`, {
          signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
          return await response.text();
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch content for ${targetType}:${targetId}:`, error);
    }
    
    return null;
  }

  /**
   * Start cleanup interval for expired watches
   */
  private startCleanupInterval(): void {
    setInterval(async () => {
      await this.cleanupExpiredWatches();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up expired watch rules
   */
  private async cleanupExpiredWatches(): Promise<void> {
    if (!this.dbManager.isReady()) {
      return;
    }

    const db = this.dbManager.getChatDb();
    const now = Date.now();

    const expiredRules = await db.query<any>(
      `
      SELECT id, target_id, target_type FROM watch_rules 
      WHERE is_active = 1 AND expires_at <= ?
    `,
      [now],
    );

    for (const rule of expiredRules) {
      await this.cancelWatchRule(rule.id);
      
      this.emitEvent({
        type: 'watch_expired',
        timestamp: new Date(),
        data: { watchRuleId: rule.id, targetId: rule.target_id, targetType: rule.target_type }
      });
    }
  }

  /**
   * Find recent query for auto-watch logic
   */
  private async findRecentQuery(
    conversationId: string,
    targetId: string,
    targetType: 'device' | 'service',
    intent: string
  ): Promise<boolean> {
    // Simplified implementation - in production you'd analyze actual message history
    // For now, we'll assume any recent query within the last hour triggers auto-watch
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // This would involve querying the messages table for relevant queries
    return true; // Simplified - always auto-watch for demo
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: WatchManagerEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: WatchManagerEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit watch manager event
   */
  private emitEvent(event: WatchManagerEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in watch manager event listener:', error);
      }
    });
  }

  /**
   * Get current statistics
   */
  getStats(): PollingStats {
    return { ...this.stats };
  }

  /**
   * Get active watch count
   */
  getActiveWatchCount(): number {
    return this.pollingIntervals.size;
  }
}

/**
 * Auto-Watch Integration - connects chat queries with watch management
 * Implements time window logic for automatic monitoring
 */

import type { WatchManager } from '../reactive/watchManager';
import type { DatabaseManager } from '../persistence/databaseManager';
import type { ChatMessage } from '../domain/chatEvents';
import { logger } from '../lib/logger';

export interface AutoWatchConfig {
  enabled: boolean;
  timeWindowMs: number; // How long to look back for recent queries
  watchDurationMs: number; // How long to watch after a query
  intentsToWatch: string[];
  excludePatterns: string[];
}

export class AutoWatchIntegration {
  private watchManager: WatchManager;
  private dbManager: DatabaseManager;
  private config: AutoWatchConfig;
  private logger = logger.scope('auto-watch');

  constructor(
    watchManager: WatchManager,
    dbManager: DatabaseManager,
    config: AutoWatchConfig
  ) {
    this.watchManager = watchManager;
    this.dbManager = dbManager;
    this.config = config;
  }

  /**
   * Process a chat message and potentially trigger auto-watch
   */
  async processMessage(message: ChatMessage): Promise<void> {
    if (!this.config.enabled || message.role !== 'user') {
      return;
    }

    try {
      // Extract intent and entities from the message
      const intentInfo = await this.extractIntentInfo(message.text);
      
      if (!intentInfo) {
        return;
      }

      // Check if this query should trigger auto-watch
      const shouldWatch = await this.shouldAutoWatch(intentInfo, message);
      
      if (shouldWatch) {
        await this.triggerAutoWatch(intentInfo, message);
      }

    } catch (error) {
      this.logger.error('Error processing message for auto-watch:', error);
    }
  }

  /**
   * Extract intent and target information from message
   */
  private async extractIntentInfo(message: string): Promise<{
    intent: string;
    targetId?: string;
    targetType?: 'device' | 'service';
    confidence: number;
  } | null> {
    // Simplified intent extraction - in production you'd use NLP
    const lowerMessage = message.toLowerCase();

    // Camera-related intents
    if (lowerMessage.includes('kamera') || lowerMessage.includes('kamerze') || lowerMessage.includes('camera')) {
      const cameraMatch = lowerMessage.match(/kamer[ae]\s+(w\s+)?(\w+)/);
      if (cameraMatch) {
        const location = cameraMatch[2];
        return {
          intent: 'camera:describe',
          targetId: `camera-${location}`,
          targetType: 'service',
          confidence: 0.8
        };
      }
    }

    // Device/service status intents
    if (lowerMessage.includes('co jest') || lowerMessage.includes('status') || lowerMessage.includes('stan')) {
      return {
        intent: 'device:status',
        confidence: 0.6
      };
    }

    // Network/device discovery intents
    if (lowerMessage.includes('skanuj') || lowerMessage.includes('odkryj') || lowerMessage.includes('znajdź')) {
      return {
        intent: 'network:scan',
        confidence: 0.9
      };
    }

    // Service-specific intents
    const serviceKeywords = {
      'http': 'http:describe',
      'rtsp': 'rtsp:describe',
      'mqtt': 'mqtt:describe',
      'api': 'api:describe'
    };

    for (const [keyword, intent] of Object.entries(serviceKeywords)) {
      if (lowerMessage.includes(keyword)) {
        return {
          intent,
          confidence: 0.7
        };
      }
    }

    return null;
  }

  /**
   * Determine if auto-watch should be triggered
   */
  private async shouldAutoWatch(
    intentInfo: { intent: string; targetId?: string; targetType?: 'device' | 'service'; confidence: number },
    message: ChatMessage
  ): Promise<boolean> {
    // Check if intent is in the watch list
    if (!this.config.intentsToWatch.includes(intentInfo.intent)) {
      return false;
    }

    // Check confidence threshold
    if (intentInfo.confidence < 0.5) {
      return false;
    }

    // Check exclude patterns
    const messageText = message.text.toLowerCase();
    for (const pattern of this.config.excludePatterns) {
      if (messageText.includes(pattern.toLowerCase())) {
        return false;
      }
    }

    // Check if there was a recent query for the same target
    if (intentInfo.targetId) {
      const hasRecentQuery = await this.hasRecentQuery(
        intentInfo.targetId,
        intentInfo.targetType!,
        intentInfo.intent,
        (message.timestamp && typeof message.timestamp === 'object' && 'getTime' in message.timestamp) ? message.timestamp : new Date(message.timestamp || 0)
      );

      if (hasRecentQuery) {
        return true;
      }
    }

    // For high-confidence queries, consider auto-watch even without recent history
    if (intentInfo.confidence >= 0.8) {
      return true;
    }

    return false;
  }

  /**
   * Check if there was a recent query for the target
   */
  private async hasRecentQuery(
    targetId: string,
    targetType: 'device' | 'service',
    intent: string,
    currentTime: Date
  ): Promise<boolean> {
    if (!this.dbManager.isReady()) {
      return false;
    }

    const db = this.dbManager.getChatDb();
    const timeWindowStart = currentTime.getTime() - this.config.timeWindowMs;

    // Look for recent messages about the same target
    const recentMessages = db.prepare(`
      SELECT m.* FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE m.role = 'user'
      AND m.timestamp > ?
      AND (LOWER(m.content) LIKE ? OR LOWER(m.content) LIKE ?)
      ORDER BY m.timestamp DESC
      LIMIT 5
    `).all(
      timeWindowStart,
      `%${targetId}%`,
      `%${intent.split(':')[0]}%`
    ) as any[];

    return recentMessages.length > 0;
  }

  /**
   * Trigger auto-watch for a target
   */
  private async triggerAutoWatch(
    intentInfo: { intent: string; targetId?: string; targetType?: 'device' | 'service' },
    message: ChatMessage
  ): Promise<void> {
    if (!intentInfo.targetId || !intentInfo.targetType) {
      return;
    }

    try {
      // Get or create conversation ID
      const conversationId = await this.getOrCreateConversation(message);

      // Create watch rule
      await this.watchManager.createWatchRule({
        conversationId,
        targetId: intentInfo.targetId,
        targetType: intentInfo.targetType,
        intent: intentInfo.intent,
        durationMs: this.config.watchDurationMs,
        pollIntervalMs: this.getPollInterval(intentInfo.targetType),
        changeThreshold: this.getChangeThreshold(intentInfo.targetType)
      });

      this.logger.info(`Auto-watched ${intentInfo.targetType}:${intentInfo.targetId} based on query: "${message.text}"`);

    } catch (error) {
      this.logger.error('Failed to trigger auto-watch:', error);
    }
  }

  /**
   * Get or create conversation ID for a message
   */
  private async getOrCreateConversation(message: ChatMessage): Promise<string> {
    if (!this.dbManager.isReady()) {
      throw new Error('Database not ready');
    }

    const db = this.dbManager.getChatDb();
    const now = Date.now();

    // Try to find an existing conversation (simplified - in production you'd track conversation state)
    let conversation = db.prepare('SELECT id FROM conversations ORDER BY last_activity_at DESC LIMIT 1').get() as { id: string } | undefined;

    if (!conversation) {
      // Create new conversation
      const conversationId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO conversations (id, started_at, last_activity_at)
        VALUES (?, ?, ?)
      `).run(conversationId, now, now);

      return conversationId;
    }

    // Update last activity
    db.prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?').run(now, conversation.id);
    return conversation.id;
  }

  /**
   * Get appropriate poll interval for target type
   */
  private getPollInterval(targetType: 'device' | 'service'): number {
    switch (targetType) {
      case 'service':
        return 30000; // 30 seconds for services
      case 'device':
        return 60000; // 1 minute for devices
      default:
        return 60000;
    }
  }

  /**
   * Get appropriate change threshold for target type
   */
  private getChangeThreshold(targetType: 'device' | 'service'): number {
    switch (targetType) {
      case 'service':
        return 0.15; // 15% for services
      case 'device':
        return 0.25; // 25% for devices
      default:
        return 0.15;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AutoWatchConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Auto-watch configuration updated:', newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoWatchConfig {
    return { ...this.config };
  }

  /**
   * Get auto-watch statistics
   */
  async getStats(): Promise<{
    totalAutoWatches: number;
    activeAutoWatches: number;
    recentQueries: number;
    commonIntents: Array<{ intent: string; count: number }>;
  }> {
    if (!this.dbManager.isReady()) {
      return {
        totalAutoWatches: 0,
        activeAutoWatches: 0,
        recentQueries: 0,
        commonIntents: []
      };
    }

    const db = this.dbManager.getChatDb();
    const timeWindowStart = Date.now() - this.config.timeWindowMs;

    // Get watch statistics
    const watchStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN is_active = 1 AND expires_at > ? THEN 1 END) as active
      FROM watch_rules
    `).get(Date.now()) as { total: number; active: number };

    // Get recent queries
    const recentQueries = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE role = 'user' AND timestamp > ?
    `).get(timeWindowStart) as { count: number };

    // Get common intents (simplified)
    const commonIntents = [
      { intent: 'camera:describe', count: 1 },
      { intent: 'device:status', count: 2 },
      { intent: 'network:scan', count: 1 }
    ];

    return {
      totalAutoWatches: watchStats.total,
      activeAutoWatches: watchStats.active,
      recentQueries: recentQueries.count,
      commonIntents
    };
  }
}

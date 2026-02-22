/**
 * Change Detector - detects and analyzes changes in device/service content
 * Provides diff analysis and change scoring
 */

import type { 
  ChangeDetectionResult, 
  ChangeDetectedEvent 
} from './types';
import { DatabaseManager } from '../persistence/databaseManager';
import type { ContentSnapshot, ChangeHistory } from '../persistence/types';

export class ChangeDetector {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  /**
   * Detect changes in content for a device/service
   */
  async detectChanges(
    targetId: string,
    targetType: 'device' | 'service',
    currentContent: string,
    contentType: string,
    changeThreshold: number
  ): Promise<ChangeDetectionResult> {
    try {
      // Get the most recent snapshot for this target
      const previousSnapshot = await this.getLatestSnapshot(targetId, targetType);

      if (!previousSnapshot) {
        // First time seeing this content, create initial snapshot
        await this.createSnapshot(targetId, targetType, currentContent, contentType);
        return {
          hasChanged: false,
          changeScore: 0,
          changeType: 'content',
          currentSnapshot: currentContent,
          summary: 'Initial content snapshot created'
        };
      }

      // Calculate change score
      const changeScore = this.calculateChangeScore(previousSnapshot.content, currentContent);
      
      // Determine if change exceeds threshold
      const hasChanged = changeScore >= changeThreshold;
      const changeType = this.determineChangeType(previousSnapshot.content, currentContent);

      if (hasChanged) {
        // Create new snapshot
        const newSnapshot = await this.createSnapshot(targetId, targetType, currentContent, contentType);
        
        // Record change history
        await this.recordChangeHistory(
          targetId,
          targetType,
          previousSnapshot.id,
          newSnapshot.id,
          changeType,
          changeScore
        );

        return {
          hasChanged: true,
          changeScore,
          changeType,
          previousSnapshot: previousSnapshot.content,
          currentSnapshot: currentContent,
          summary: this.generateChangeSummary(changeType, changeScore, previousSnapshot.content, currentContent)
        };
      }

      return {
        hasChanged: false,
        changeScore,
        changeType,
        previousSnapshot: previousSnapshot.content,
        currentSnapshot: currentContent,
        summary: `No significant changes detected (score: ${changeScore.toFixed(3)}, threshold: ${changeThreshold})`
      };

    } catch (error) {
      console.error('Error detecting changes:', error);
      throw error;
    }
  }

  /**
   * Get the latest snapshot for a target
   */
  private async getLatestSnapshot(
    targetId: string, 
    targetType: 'device' | 'service'
  ): Promise<ContentSnapshot | null> {
    if (!this.dbManager.isReady()) {
      return null;
    }

    const db = this.dbManager.getDevicesDb();
    
    let query = `
      SELECT * FROM content_snapshots 
      WHERE device_id = ? 
      ORDER BY captured_at DESC 
      LIMIT 1
    `;
    
    let params = [targetId];

    if (targetType === 'service') {
      query = `
        SELECT cs.* FROM content_snapshots cs
        JOIN device_services ds ON cs.service_id = ds.id
        WHERE ds.id = ?
        ORDER BY cs.captured_at DESC 
        LIMIT 1
      `;
      params = [targetId];
    }

    const row = db.prepare(query).get(...params) as any;
    
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      deviceId: row.device_id,
      serviceId: row.service_id,
      content: row.content,
      contentType: row.content_type,
      hash: row.hash,
      size: row.size,
      capturedAt: new Date(row.captured_at)
    };
  }

  /**
   * Create a new content snapshot
   */
  private async createSnapshot(
    targetId: string,
    targetType: 'device' | 'service',
    content: string,
    contentType: string
  ): Promise<ContentSnapshot> {
    if (!this.dbManager.isReady()) {
      throw new Error('Database not ready');
    }

    const db = this.dbManager.getDevicesDb();
    const now = Date.now();
    const hash = this.calculateHash(content);
    const size = new Blob([content]).size;

    const snapshotId = crypto.randomUUID();

    if (targetType === 'device') {
      db.prepare(`
        INSERT INTO content_snapshots (id, device_id, service_id, content, content_type, hash, size, captured_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
      `).run(snapshotId, targetId, content, contentType, hash, size, now);
    } else {
      db.prepare(`
        INSERT INTO content_snapshots (id, device_id, service_id, content, content_type, hash, size, captured_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
      `).run(snapshotId, targetId, content, contentType, hash, size, now);
    }

    return {
      id: snapshotId,
      deviceId: targetType === 'device' ? targetId : undefined,
      serviceId: targetType === 'service' ? targetId : undefined,
      content,
      contentType,
      hash,
      size,
      capturedAt: new Date(now)
    };
  }

  /**
   * Record change history
   */
  private async recordChangeHistory(
    targetId: string,
    targetType: 'device' | 'service',
    previousSnapshotId: string,
    currentSnapshotId: string,
    changeType: 'content' | 'status' | 'metadata',
    changeScore: number
  ): Promise<void> {
    if (!this.dbManager.isReady()) {
      return;
    }

    const db = this.dbManager.getDevicesDb();
    const now = Date.now();

    db.prepare(`
      INSERT INTO change_history (id, device_id, service_id, previous_snapshot_id, current_snapshot_id, change_type, change_score, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      targetType === 'device' ? targetId : null,
      targetType === 'service' ? targetId : null,
      previousSnapshotId,
      currentSnapshotId,
      changeType,
      changeScore,
      now
    );
  }

  /**
   * Calculate change score between two content strings
   */
  private calculateChangeScore(previous: string, current: string): number {
    if (previous === current) {
      return 0;
    }

    // Use a simple similarity algorithm (could be enhanced with more sophisticated diff)
    const previousWords = previous.toLowerCase().split(/\s+/);
    const currentWords = current.toLowerCase().split(/\s+/);

    const previousSet = new Set(previousWords);
    const currentSet = new Set(currentWords);

    const intersection = new Set([...previousSet].filter(x => currentSet.has(x)));
    const union = new Set([...previousSet, ...currentSet]);

    const jaccardSimilarity = intersection.size / union.size;
    const changeScore = 1 - jaccardSimilarity;

    return changeScore;
  }

  /**
   * Determine the type of change
   */
  private determineChangeType(previous: string, current: string): 'content' | 'status' | 'metadata' {
    // Simple heuristic - could be enhanced
    const prevLower = previous.toLowerCase();
    const currLower = current.toLowerCase();

    // Check for status indicators
    const statusIndicators = ['online', 'offline', 'available', 'unavailable', 'active', 'inactive'];
    const hasStatusChange = statusIndicators.some(indicator => 
      (prevLower.includes(indicator) && !currLower.includes(indicator)) ||
      (currLower.includes(indicator) && !prevLower.includes(indicator))
    );

    if (hasStatusChange) {
      return 'status';
    }

    // Check for metadata changes (JSON, headers, etc.)
    const metadataPatterns = [/{.*}/, /\[.*?\]/, /^[\w-]+:\s*.*$/m];
    const hasMetadataChange = metadataPatterns.some(pattern => 
      pattern.test(previous) !== pattern.test(current)
    );

    if (hasMetadataChange) {
      return 'metadata';
    }

    return 'content';
  }

  /**
   * Generate human-readable change summary
   */
  private generateChangeSummary(
    changeType: 'content' | 'status' | 'metadata',
    changeScore: number,
    previous: string,
    current: string
  ): string {
    const percentage = (changeScore * 100).toFixed(1);

    switch (changeType) {
      case 'status':
        return `Status change detected (${percentage}% difference)`;
      case 'metadata':
        return `Metadata change detected (${percentage}% difference)`;
      case 'content':
        if (changeScore > 0.8) {
          return `Major content change detected (${percentage}% difference)`;
        } else if (changeScore > 0.5) {
          return `Significant content change detected (${percentage}% difference)`;
        } else {
          return `Minor content change detected (${percentage}% difference)`;
        }
      default:
        return `Change detected (${percentage}% difference)`;
    }
  }

  /**
   * Calculate hash for content
   */
  private calculateHash(content: string): string {
    // Simple hash implementation - in production you'd use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Get change history for a target
   */
  async getChangeHistory(
    targetId: string, 
    targetType: 'device' | 'service',
    limit: number = 10
  ): Promise<ChangeHistory[]> {
    if (!this.dbManager.isReady()) {
      return [];
    }

    const db = this.dbManager.getDevicesDb();
    
    let query = `
      SELECT * FROM change_history 
      WHERE ${targetType}_id = ? 
      ORDER BY detected_at DESC 
      LIMIT ?
    `;
    
    const rows = db.prepare(query).all(targetId, limit) as any[];
    
    return rows.map(row => ({
      id: row.id,
      deviceId: row.device_id,
      serviceId: row.service_id,
      previousSnapshotId: row.previous_snapshot_id,
      currentSnapshotId: row.current_snapshot_id,
      changeType: row.change_type,
      changeScore: row.change_score,
      detectedAt: new Date(row.detected_at)
    }));
  }
}

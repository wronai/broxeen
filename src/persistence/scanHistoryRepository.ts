/**
 * ScanHistoryRepository - persists network scan history with metadata
 */

export interface ScanHistoryEntry {
  id: string;
  timestamp: number;
  scope: string;
  subnet: string;
  deviceCount: number;
  durationMs: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface IncrementalScanRecommendation {
  recommended: boolean;
  reason: string;
  lastScan: ScanHistoryEntry | null;
}

export class ScanHistoryRepository {
  private db: any;

  constructor(dbManager: any) {
    this.db = dbManager;
  }

  async save(entry: Omit<ScanHistoryEntry, 'id'>): Promise<string> {
    const id = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullEntry: ScanHistoryEntry = { ...entry, id };
    
    await this.db.execute(`
      INSERT INTO scan_history (id, timestamp, scope, subnet, device_count, duration_ms, success, error, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      fullEntry.timestamp,
      fullEntry.scope,
      fullEntry.subnet,
      fullEntry.deviceCount,
      fullEntry.durationMs,
      fullEntry.success ? 1 : 0,
      fullEntry.error || null,
      JSON.stringify(fullEntry.metadata || {})
    ]);
    
    return id;
  }

  async list(limit: number = 50): Promise<ScanHistoryEntry[]> {
    const results = await this.db.query(`
      SELECT * FROM scan_history 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, [limit]);
    
    return results.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      scope: row.scope,
      subnet: row.subnet,
      deviceCount: row.device_count,
      durationMs: row.duration_ms,
      success: row.success === 1,
      error: row.error,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  async getLastSuccessfulBySubnet(subnet: string): Promise<ScanHistoryEntry | null> {
    const results = await this.db.query(`
      SELECT * FROM scan_history
      WHERE subnet = ? AND success = 1
      ORDER BY timestamp DESC
      LIMIT 1
    `, [subnet]);

    const row = results?.[0];
    if (!row) return null;
    return {
      id: row.id,
      timestamp: row.timestamp,
      scope: row.scope,
      subnet: row.subnet,
      deviceCount: row.device_count,
      durationMs: row.duration_ms,
      success: row.success === 1,
      error: row.error,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  async shouldUseIncrementalScan(subnet: string): Promise<IncrementalScanRecommendation> {
    const last = await this.getLastSuccessfulBySubnet(subnet);
    if (!last) {
      return {
        recommended: false,
        reason: 'Brak historii skanów dla tego subnetu',
        lastScan: null,
      };
    }

    const ageMs = Date.now() - last.timestamp;
    const RECENT_MS = 15 * 60 * 1000; // 15 min

    // Heurystyka: jeśli był niedawny udany skan, warto preferować inkrementalny.
    if (ageMs < RECENT_MS) {
      return {
        recommended: true,
        reason: `Ostatni skan był ${Math.round(ageMs / 1000)}s temu`,
        lastScan: last,
      };
    }

    return {
      recommended: false,
      reason: `Ostatni skan jest zbyt stary (${Math.round(ageMs / 60000)} min)`,
      lastScan: last,
    };
  }

  async getByScope(scope: string, limit: number = 10): Promise<ScanHistoryEntry[]> {
    const results = await this.db.query(`
      SELECT * FROM scan_history 
      WHERE scope = ?
      ORDER BY timestamp DESC 
      LIMIT ?
    `, [scope, limit]);
    
    return results.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      scope: row.scope,
      subnet: row.subnet,
      deviceCount: row.device_count,
      durationMs: row.duration_ms,
      success: row.success === 1,
      error: row.error,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }));
  }

  async cleanup(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const result = await this.db.execute(`
      DELETE FROM scan_history WHERE timestamp < ?
    `, [cutoff]);
    
    return result.changes || 0;
  }
}

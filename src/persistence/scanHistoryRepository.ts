/**
 * Scan History Repository — manages network scan history for incremental scanning
 * Tracks scan performance, results, and enables smart rescan strategies
 */

import type { DbAdapter } from './databaseManager';
import type { ScanHistory } from './types';
import { logger } from '../lib/logger';

const repoLogger = logger.scope('persistence:scanHistory');

export class ScanHistoryRepository {
  constructor(private db: DbAdapter) {}

  /** Save a completed scan to history */
  async saveScan(scan: {
    id: string;
    subnet: string;
    scanType: ScanHistory['scanType'];
    devicesFound: number;
    devicesUpdated: number;
    newDevices: number;
    scanDurationMs: number;
    scanRange: string[];
    triggeredBy: ScanHistory['triggeredBy'];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `INSERT INTO scan_history (
          id, subnet, scan_type, devices_found, devices_updated, new_devices,
          scan_duration_ms, scan_range, triggered_by, metadata, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scan.id,
          scan.subnet,
          scan.scanType,
          scan.devicesFound,
          scan.devicesUpdated,
          scan.newDevices,
          scan.scanDurationMs,
          JSON.stringify(scan.scanRange),
          scan.triggeredBy,
          scan.metadata ? JSON.stringify(scan.metadata) : null,
          now - scan.scanDurationMs,
          now,
        ],
      );
      repoLogger.info('Scan saved to history', { 
        scanId: scan.id, 
        type: scan.scanType, 
        devicesFound: scan.devicesFound,
        duration: scan.scanDurationMs 
      });
    } catch (err) {
      repoLogger.warn('saveScan failed', err);
    }
  }

  /** Get recent scans for a subnet */
  async getRecentScans(subnet: string, limit: number = 10): Promise<ScanHistory[]> {
    try {
      const rows = await this.db.query(
        `SELECT * FROM scan_history 
         WHERE subnet = ? 
         ORDER BY started_at DESC 
         LIMIT ?`,
        [subnet, limit]
      ) as ScanHistoryRow[];

      return rows.map(this.mapRowToScanHistory);
    } catch (err) {
      repoLogger.warn('getRecentScans failed', err);
      return [];
    }
  }

  /** Get the most recent successful scan for a subnet */
  async getLastScan(subnet: string): Promise<ScanHistory | null> {
    try {
      const rows = await this.db.query(
        `SELECT * FROM scan_history 
         WHERE subnet = ? AND scan_type != 'targeted'
         ORDER BY started_at DESC 
         LIMIT 1`,
        [subnet]
      ) as ScanHistoryRow[];

      return rows.length > 0 ? this.mapRowToScanHistory(rows[0]) : null;
    } catch (err) {
      repoLogger.warn('getLastScan failed', err);
      return null;
    }
  }

  /** Get scan statistics for a subnet */
  async getScanStats(subnet: string, days: number = 7): Promise<{
    totalScans: number;
    avgDuration: number;
    avgDevicesFound: number;
    lastScanDate: Date | null;
    scanTypes: Record<string, number>;
  }> {
    try {
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      const rows = await this.db.query(
        `SELECT 
           COUNT(*) as total_scans,
           AVG(scan_duration_ms) as avg_duration,
           AVG(devices_found) as avg_devices_found,
           MAX(started_at) as last_scan_date,
           scan_type,
           COUNT(*) as type_count
         FROM scan_history 
         WHERE subnet = ? AND started_at > ?
         GROUP BY scan_type`,
        [subnet, cutoff]
      ) as any[];

      if (rows.length === 0) {
        return {
          totalScans: 0,
          avgDuration: 0,
          avgDevicesFound: 0,
          lastScanDate: null,
          scanTypes: {}
        };
      }

      const totalScans = rows.reduce((sum, row) => sum + row.type_count, 0);
      const avgDuration = Math.round(rows.reduce((sum, row) => sum + (row.avg_duration * row.type_count), 0) / totalScans);
      const avgDevicesFound = Math.round(rows.reduce((sum, row) => sum + (row.avg_devices_found * row.type_count), 0) / totalScans);
      const lastScanDate = new Date(Math.max(...rows.map(row => row.last_scan_date)));

      const scanTypes: Record<string, number> = {};
      rows.forEach(row => {
        scanTypes[row.scan_type] = row.type_count;
      });

      return {
        totalScans,
        avgDuration,
        avgDevicesFound,
        lastScanDate,
        scanTypes
      };
    } catch (err) {
      repoLogger.warn('getScanStats failed', err);
      return {
        totalScans: 0,
        avgDuration: 0,
        avgDevicesFound: 0,
        lastScanDate: null,
        scanTypes: {}
      };
    }
  }

  /** Determine if incremental scan is recommended */
  async shouldUseIncrementalScan(subnet: string): Promise<{
    recommended: boolean;
    reason: string;
    lastScan?: ScanHistory;
  }> {
    const lastScan = await this.getLastScan(subnet);
    
    if (!lastScan) {
      return { recommended: false, reason: 'No previous scan history found' };
    }

    const hoursSinceLastScan = (Date.now() - lastScan.startedAt.getTime()) / (1000 * 60 * 60);
    
    // If last scan was recent (< 2 hours) and successful, use incremental
    if (hoursSinceLastScan < 2 && lastScan.devicesFound > 0) {
      return { 
        recommended: true, 
        reason: `Recent successful scan ${Math.round(hoursSinceLastScan)}h ago with ${lastScan.devicesFound} devices`,
        lastScan 
      };
    }

    // If last scan found many devices and was thorough, use incremental
    if (lastScan.devicesFound > 10 && lastScan.scanType === 'full') {
      return { 
        recommended: true, 
        reason: `Previous full scan found ${lastScan.devicesFound} devices, incremental scan recommended`,
        lastScan 
      };
    }

    return { 
      recommended: false, 
      reason: `Last scan was ${hoursSinceLastScan.toFixed(1)}h ago or found few devices, full scan recommended`,
      lastScan 
    };
  }

  /** Clean up old scan history (keep last 30 days) */
  async cleanupOldHistory(): Promise<number> {
    try {
      const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const result = await this.db.execute(
        `DELETE FROM scan_history WHERE started_at < ?`,
        [cutoff]
      );
      
      const deletedCount = result.changes || 0;
      if (deletedCount > 0) {
        repoLogger.info('Cleaned up old scan history', { deletedCount });
      }
      
      return deletedCount;
    } catch (err) {
      repoLogger.warn('cleanupOldHistory failed', err);
      return 0;
    }
  }

  private mapRowToScanHistory(row: ScanHistoryRow): ScanHistory {
    return {
      id: row.id,
      subnet: row.subnet,
      scanType: row.scan_type,
      devicesFound: row.devices_found,
      devicesUpdated: row.devices_updated,
      newDevices: row.new_devices,
      scanDurationMs: row.scan_duration_ms,
      scanRange: JSON.parse(row.scan_range),
      triggeredBy: row.triggered_by,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      startedAt: new Date(row.started_at),
      completedAt: new Date(row.completed_at),
    };
  }
}

type ScanHistoryRow = {
  id: string;
  subnet: string;
  scan_type: ScanHistory['scanType'];
  devices_found: number;
  devices_updated: number;
  new_devices: number;
  scan_duration_ms: number;
  scan_range: string;
  triggered_by: ScanHistory['triggeredBy'];
  metadata: string | null;
  started_at: number;
  completed_at: number;
};

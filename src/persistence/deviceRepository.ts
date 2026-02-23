/**
 * Device Repository — persists discovered network devices and services to SQLite.
 * Works in Tauri (real SQLite) and browser (InMemoryDbAdapter / no-op).
 */

import type { DbAdapter } from './databaseManager';
import type { Device, DeviceService } from './types';
import { logger } from '../lib/logger';

const repoLogger = logger.scope('persistence:devices');

export class DeviceRepository {
  constructor(private db: DbAdapter) {}

  /** Upsert a discovered device. */
  async saveDevice(device: {
    id: string;
    ip: string;
    hostname?: string;
    mac?: string;
    vendor?: string;
  }): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `INSERT INTO devices (id, ip, hostname, mac, vendor, last_seen, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           hostname = COALESCE(excluded.hostname, hostname),
           mac = COALESCE(excluded.mac, mac),
           vendor = COALESCE(excluded.vendor, vendor),
           last_seen = excluded.last_seen,
           updated_at = excluded.updated_at`,
        [device.id, device.ip, device.hostname ?? null, device.mac ?? null, device.vendor ?? null, now, now, now],
      );
    } catch (err) {
      repoLogger.warn('saveDevice failed', err);
    }
  }

  /** Bulk upsert devices from a network scan. */
  async saveDevices(devices: Array<{ id: string; ip: string; hostname?: string; mac?: string; vendor?: string }>): Promise<void> {
    for (const d of devices) {
      await this.saveDevice(d);
    }
  }

  /** Add or update a service on a device. */
  async saveService(service: {
    id: string;
    deviceId: string;
    type: DeviceService['type'];
    port: number;
    path?: string;
    status?: DeviceService['status'];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `INSERT INTO device_services (id, device_id, type, port, path, status, last_checked, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           last_checked = excluded.last_checked,
           metadata = excluded.metadata`,
        [
          service.id,
          service.deviceId,
          service.type,
          service.port,
          service.path ?? null,
          service.status ?? 'unknown',
          now,
          service.metadata ? JSON.stringify(service.metadata) : null,
        ],
      );
    } catch (err) {
      repoLogger.warn('saveService failed', err);
    }
  }

  /** List all known devices. */
  async listDevices(limit = 100): Promise<Array<{
    id: string;
    ip: string;
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    last_seen: number;
  }>> {
    try {
      return await this.db.query(
        `SELECT id, ip, hostname, mac, vendor, last_seen FROM devices ORDER BY last_seen DESC LIMIT ?`,
        [limit],
      );
    } catch {
      return [];
    }
  }

  /** Update device status (online/offline/unknown) */
  async updateDeviceStatus(deviceId: string, status: 'online' | 'offline' | 'unknown'): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `UPDATE devices SET last_seen = ?, updated_at = ? WHERE id = ?`,
        [now, now, deviceId]
      );
      
      // Also update all services for this device
      await this.db.execute(
        `UPDATE device_services SET status = ?, last_checked = ? WHERE device_id = ?`,
        [status, now, deviceId]
      );
      
      repoLogger.debug('Device status updated', { deviceId, status });
    } catch (err) {
      repoLogger.warn('updateDeviceStatus failed', { deviceId, status, error: err });
    }
  }

  /** Get devices with their current status */
  async getDevicesWithStatus(): Promise<Array<{
    id: string;
    ip: string;
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    last_seen: number;
    status: 'online' | 'offline' | 'unknown';
    services_count: number;
  }>> {
    try {
      return await this.db.query(
        `SELECT d.id, d.ip, d.hostname, d.mac, d.vendor, d.last_seen,
                COALESCE(ds.status, 'unknown') as status,
                COUNT(ds.id) as services_count
         FROM devices d
         LEFT JOIN device_services ds ON d.id = ds.device_id
         GROUP BY d.id, d.ip, d.hostname, d.mac, d.vendor, d.last_seen, ds.status
         ORDER BY d.last_seen DESC`
      );
    } catch {
      return [];
    }
  }

  /** Get recently active devices (within N minutes) */
  async getRecentlyActiveDevices(minutesAgo = 30): Promise<Array<{
    id: string;
    ip: string;
    hostname: string | null;
    last_seen: number;
    minutes_since_last_seen: number;
  }>> {
    try {
      const cutoff = Date.now() - (minutesAgo * 60 * 1000);
      return await this.db.query(
        `SELECT id, ip, hostname, last_seen,
                ((? - last_seen) / 60000) as minutes_since_last_seen
         FROM devices 
         WHERE last_seen > ?
         ORDER BY last_seen DESC`,
        [Date.now(), cutoff]
      );
    } catch {
      return [];
    }
  }

  /** Get offline devices (not seen for N hours) */
  async getOfflineDevices(hoursAgo = 2): Promise<Array<{
    id: string;
    ip: string;
    hostname: string | null;
    last_seen: number;
    hours_since_last_seen: number;
  }>> {
    try {
      const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);
      return await this.db.query(
        `SELECT id, ip, hostname, last_seen,
                ((? - last_seen) / 3600000) as hours_since_last_seen
         FROM devices 
         WHERE last_seen < ?
         ORDER BY last_seen DESC`,
        [Date.now(), cutoff]
      );
    } catch {
      return [];
    }
  }

  /** List services for a device. */
  async listServices(deviceId: string): Promise<Array<{
    id: string;
    type: string;
    port: number;
    path: string | null;
    status: string;
    last_checked: number;
  }>> {
    try {
      return await this.db.query(
        `SELECT id, type, port, path, status, last_checked FROM device_services WHERE device_id = ? ORDER BY port`,
        [deviceId],
      );
    } catch {
      return [];
    }
  }

  /** Get a device by IP. */
  async getByIp(ip: string): Promise<{
    id: string;
    ip: string;
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    last_seen: number;
  } | null> {
    try {
      return await this.db.queryOne(
        `SELECT id, ip, hostname, mac, vendor, last_seen FROM devices WHERE ip = ?`,
        [ip],
      );
    } catch {
      return null;
    }
  }

  /** Count devices. */
  async countDevices(): Promise<number> {
    try {
      const row = await this.db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM devices');
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }

  /** Count services. */
  async countServices(): Promise<number> {
    try {
      const row = await this.db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM device_services');
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }
}

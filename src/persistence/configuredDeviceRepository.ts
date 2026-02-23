/**
 * ConfiguredDeviceRepository — persists user-configured devices to SQLite.
 * These survive app restarts and don't need to be re-programmed via chat.
 */

import type { DbAdapter } from './databaseManager';
import { logger } from '../lib/logger';

const repoLogger = logger.scope('persistence:configured-devices');

export interface ConfiguredDevice {
  id: string;
  device_id: string | null;
  label: string;
  ip: string;
  device_type: 'camera' | 'server' | 'sensor' | 'other';
  rtsp_url: string | null;
  http_url: string | null;
  username: string | null;
  password: string | null;
  stream_path: string | null;
  monitor_enabled: boolean;
  monitor_interval_ms: number;
  last_snapshot_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

/** Raw row from SQLite (monitor_enabled is INTEGER 0/1) */
interface ConfiguredDeviceRow {
  id: string;
  device_id: string | null;
  label: string;
  ip: string;
  device_type: 'camera' | 'server' | 'sensor' | 'other';
  rtsp_url: string | null;
  http_url: string | null;
  username: string | null;
  password: string | null;
  stream_path: string | null;
  monitor_enabled: number;
  monitor_interval_ms: number;
  last_snapshot_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

function rowToDevice(r: ConfiguredDeviceRow): ConfiguredDevice {
  return { ...r, monitor_enabled: !!r.monitor_enabled };
}

export type ConfiguredDeviceInput = Omit<ConfiguredDevice, 'created_at' | 'updated_at'>;

function genId(): string {
  return `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ConfiguredDeviceRepository {
  constructor(private db: DbAdapter) {}

  /** Save or update a configured device. */
  async save(input: Partial<ConfiguredDeviceInput> & { label: string; ip: string }): Promise<string> {
    const now = Date.now();
    const id = input.id || genId();

    try {
      await this.db.execute(
        `INSERT INTO configured_devices
           (id, device_id, label, ip, device_type, rtsp_url, http_url,
            username, password, stream_path, monitor_enabled, monitor_interval_ms,
            last_snapshot_at, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           ip = excluded.ip,
           device_type = excluded.device_type,
           rtsp_url = excluded.rtsp_url,
           http_url = excluded.http_url,
           username = excluded.username,
           password = excluded.password,
           stream_path = excluded.stream_path,
           monitor_enabled = excluded.monitor_enabled,
           monitor_interval_ms = excluded.monitor_interval_ms,
           notes = excluded.notes,
           updated_at = excluded.updated_at`,
        [
          id,
          input.device_id ?? null,
          input.label,
          input.ip,
          input.device_type ?? 'camera',
          input.rtsp_url ?? null,
          input.http_url ?? null,
          input.username ?? null,
          input.password ?? null,
          input.stream_path ?? null,
          input.monitor_enabled !== false ? 1 : 0,
          input.monitor_interval_ms ?? 3000,
          input.last_snapshot_at ?? null,
          input.notes ?? null,
          now,
          now,
        ],
      );
      repoLogger.info('Configured device saved', { id, label: input.label, ip: input.ip });
      return id;
    } catch (err) {
      repoLogger.warn('save configured device failed', err);
      throw err;
    }
  }

  /** List all configured devices. */
  async listAll(): Promise<ConfiguredDevice[]> {
    try {
      const rows = await this.db.query<ConfiguredDeviceRow>(
        `SELECT * FROM configured_devices ORDER BY updated_at DESC`,
      );
      return rows.map(rowToDevice);
    } catch {
      return [];
    }
  }

  /** Get only monitoring-enabled devices. */
  async listMonitored(): Promise<ConfiguredDevice[]> {
    try {
      const rows = await this.db.query<ConfiguredDeviceRow>(
        `SELECT * FROM configured_devices WHERE monitor_enabled = 1 ORDER BY updated_at DESC`,
      );
      return rows.map(rowToDevice);
    } catch {
      return [];
    }
  }

  /** Get a single configured device by ID. */
  async getById(id: string): Promise<ConfiguredDevice | null> {
    try {
      const row = await this.db.queryOne<ConfiguredDeviceRow>(
        `SELECT * FROM configured_devices WHERE id = ?`,
        [id],
      );
      return row ? rowToDevice(row) : null;
    } catch {
      return null;
    }
  }

  /** Find configured device by IP. */
  async getByIp(ip: string): Promise<ConfiguredDevice | null> {
    try {
      const row = await this.db.queryOne<ConfiguredDeviceRow>(
        `SELECT * FROM configured_devices WHERE ip = ?`,
        [ip],
      );
      return row ? rowToDevice(row) : null;
    } catch {
      return null;
    }
  }

  /** List all configured devices matching an IP (used to detect duplicates). */
  async listByIp(ip: string): Promise<ConfiguredDevice[]> {
    try {
      const rows = await this.db.query<ConfiguredDeviceRow>(
        `SELECT * FROM configured_devices WHERE ip = ? ORDER BY updated_at DESC`,
        [ip],
      );
      return rows.map(rowToDevice);
    } catch {
      return [];
    }
  }

  /** Delete a configured device. */
  async remove(id: string): Promise<void> {
    try {
      await this.db.execute(`DELETE FROM configured_devices WHERE id = ?`, [id]);
      repoLogger.info('Configured device removed', { id });
    } catch (err) {
      repoLogger.warn('remove configured device failed', err);
    }
  }

  /** Toggle monitoring for a device. */
  async setMonitorEnabled(id: string, enabled: boolean): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `UPDATE configured_devices SET monitor_enabled = ?, updated_at = ? WHERE id = ?`,
        [enabled ? 1 : 0, now, id],
      );
    } catch (err) {
      repoLogger.warn('setMonitorEnabled failed', err);
    }
  }

  /** Update last snapshot timestamp. */
  async updateLastSnapshot(id: string): Promise<void> {
    const now = Date.now();
    try {
      await this.db.execute(
        `UPDATE configured_devices SET last_snapshot_at = ?, updated_at = ? WHERE id = ?`,
        [now, now, id],
      );
    } catch (err) {
      repoLogger.warn('updateLastSnapshot failed', err);
    }
  }

  /** Count configured devices. */
  async count(): Promise<number> {
    try {
      const row = await this.db.queryOne<{ cnt: number }>('SELECT count(*) as cnt FROM configured_devices');
      return row?.cnt ?? 0;
    } catch {
      return 0;
    }
  }
}

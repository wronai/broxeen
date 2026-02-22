/**
 * @module persistence/deviceRepository
 * @description Repository for network devices, services, snapshots and change history.
 *
 * SRP: Only handles device-related data persistence.
 * All methods are synchronous (SQLite is sync) with async wrappers where needed.
 */

import type { DbAdapter } from "./database";

// ─── Domain Types ───────────────────────────────────────────

export interface Device {
  id: string;
  ip: string;
  mac?: string;
  hostname?: string;
  name?: string;
  deviceType: DeviceType;
  firstSeen: number;
  lastSeen: number;
  isOnline: boolean;
  metadata: Record<string, unknown>;
}

export type DeviceType =
  | "camera"
  | "sensor"
  | "server"
  | "printer"
  | "router"
  | "smart-home"
  | "unknown";

export interface DeviceService {
  id?: number;
  deviceId: string;
  protocol: ServiceProtocol;
  port: number;
  path: string;
  label?: string;
  isActive: boolean;
  probedAt: number;
  responseMs?: number;
  metadata: Record<string, unknown>;
}

export type ServiceProtocol =
  | "http"
  | "https"
  | "rtsp"
  | "mqtt"
  | "mqtt-ws"
  | "ssh"
  | "api"
  | "onvif";

export interface ContentSnapshot {
  id?: number;
  endpointId: string;
  contentHash: string;
  contentText?: string;
  contentSize?: number;
  snapshotAt: number;
  metadata: Record<string, unknown>;
}

export interface ChangeRecord {
  id?: number;
  endpointId: string;
  changeType: ChangeType;
  description: string;
  oldHash?: string;
  newHash?: string;
  diffSummary?: string;
  severity: "info" | "warning" | "alert";
  detectedAt: number;
  acknowledged: boolean;
}

export type ChangeType =
  | "content_changed"
  | "status_changed"
  | "new_service"
  | "device_offline"
  | "device_online"
  | "scene_changed";

// ─── Repository Implementation ──────────────────────────────

export class DeviceRepository {
  constructor(private readonly db: DbAdapter) {}

  // ── Devices ─────────────────────────────────────────────

  upsertDevice(device: Device): void {
    this.db.execute(
      `INSERT INTO devices (id, ip, mac, hostname, name, device_type, first_seen, last_seen, is_online, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ip = excluded.ip,
         mac = COALESCE(excluded.mac, devices.mac),
         hostname = COALESCE(excluded.hostname, devices.hostname),
         name = COALESCE(excluded.name, devices.name),
         device_type = CASE WHEN excluded.device_type != 'unknown' THEN excluded.device_type ELSE devices.device_type END,
         last_seen = excluded.last_seen,
         is_online = excluded.is_online,
         metadata = excluded.metadata`,
      [
        device.id,
        device.ip,
        device.mac ?? null,
        device.hostname ?? null,
        device.name ?? null,
        device.deviceType,
        device.firstSeen,
        device.lastSeen,
        device.isOnline ? 1 : 0,
        JSON.stringify(device.metadata),
      ],
    );
  }

  getDevice(id: string): Device | null {
    const row = this.db.queryOne<any>(
      "SELECT * FROM devices WHERE id = ?",
      [id],
    );
    return row ? this.mapDevice(row) : null;
  }

  getDeviceByIp(ip: string): Device | null {
    const row = this.db.queryOne<any>(
      "SELECT * FROM devices WHERE ip = ?",
      [ip],
    );
    return row ? this.mapDevice(row) : null;
  }

  getAllDevices(): Device[] {
    return this.db
      .query<any>("SELECT * FROM devices ORDER BY last_seen DESC")
      .map(this.mapDevice);
  }

  getOnlineDevices(): Device[] {
    return this.db
      .query<any>("SELECT * FROM devices WHERE is_online = 1 ORDER BY last_seen DESC")
      .map(this.mapDevice);
  }

  getDevicesByType(type: DeviceType): Device[] {
    return this.db
      .query<any>("SELECT * FROM devices WHERE device_type = ? ORDER BY name", [type])
      .map(this.mapDevice);
  }

  markOffline(deviceId: string): void {
    this.db.execute(
      "UPDATE devices SET is_online = 0 WHERE id = ?",
      [deviceId],
    );
  }

  setDeviceName(deviceId: string, name: string): void {
    this.db.execute(
      "UPDATE devices SET name = ? WHERE id = ?",
      [name, deviceId],
    );
  }

  // ── Services ────────────────────────────────────────────

  upsertService(service: DeviceService): void {
    this.db.execute(
      `INSERT INTO device_services (device_id, protocol, port, path, label, is_active, probed_at, response_ms, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(device_id, protocol, port, path) DO UPDATE SET
         label = COALESCE(excluded.label, device_services.label),
         is_active = excluded.is_active,
         probed_at = excluded.probed_at,
         response_ms = excluded.response_ms,
         metadata = excluded.metadata`,
      [
        service.deviceId,
        service.protocol,
        service.port,
        service.path,
        service.label ?? null,
        service.isActive ? 1 : 0,
        service.probedAt,
        service.responseMs ?? null,
        JSON.stringify(service.metadata),
      ],
    );
  }

  getServicesForDevice(deviceId: string): DeviceService[] {
    return this.db
      .query<any>(
        "SELECT * FROM device_services WHERE device_id = ? AND is_active = 1 ORDER BY protocol, port",
        [deviceId],
      )
      .map(this.mapService);
  }

  getServicesByProtocol(protocol: ServiceProtocol): DeviceService[] {
    return this.db
      .query<any>(
        `SELECT ds.*, d.ip, d.name as device_name
         FROM device_services ds
         JOIN devices d ON d.id = ds.device_id
         WHERE ds.protocol = ? AND ds.is_active = 1`,
        [protocol],
      )
      .map(this.mapService);
  }

  /** Get all cameras (devices with RTSP or HTTP snapshot services) */
  getCameras(): Array<Device & { services: DeviceService[] }> {
    const cameras = this.getDevicesByType("camera");
    return cameras.map((cam) => ({
      ...cam,
      services: this.getServicesForDevice(cam.id),
    }));
  }

  // ── Snapshots ───────────────────────────────────────────

  saveSnapshot(snapshot: ContentSnapshot): number {
    this.db.execute(
      `INSERT INTO content_snapshots (endpoint_id, content_hash, content_text, content_size, snapshot_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        snapshot.endpointId,
        snapshot.contentHash,
        snapshot.contentText ?? null,
        snapshot.contentSize ?? null,
        snapshot.snapshotAt,
        JSON.stringify(snapshot.metadata),
      ],
    );
    const row = this.db.queryOne<any>("SELECT last_insert_rowid() as id");
    return row?.id ?? 0;
  }

  getLatestSnapshot(endpointId: string): ContentSnapshot | null {
    const row = this.db.queryOne<any>(
      `SELECT * FROM content_snapshots
       WHERE endpoint_id = ?
       ORDER BY snapshot_at DESC LIMIT 1`,
      [endpointId],
    );
    return row ? this.mapSnapshot(row) : null;
  }

  getSnapshots(endpointId: string, limit = 50): ContentSnapshot[] {
    return this.db
      .query<any>(
        `SELECT * FROM content_snapshots
         WHERE endpoint_id = ?
         ORDER BY snapshot_at DESC LIMIT ?`,
        [endpointId, limit],
      )
      .map(this.mapSnapshot);
  }

  /** Cleanup old snapshots, keep latest N per endpoint */
  pruneSnapshots(keepPerEndpoint = 100): number {
    this.db.execute(
      `DELETE FROM content_snapshots WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY endpoint_id ORDER BY snapshot_at DESC) as rn
          FROM content_snapshots
        ) WHERE rn <= ?
      )`,
      [keepPerEndpoint],
    );
    // Return count not available in this simplified adapter
    return 0;
  }

  // ── Change History ──────────────────────────────────────

  recordChange(change: ChangeRecord): number {
    this.db.execute(
      `INSERT INTO change_history (endpoint_id, change_type, description, old_hash, new_hash, diff_summary, severity, detected_at, acknowledged)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.endpointId,
        change.changeType,
        change.description,
        change.oldHash ?? null,
        change.newHash ?? null,
        change.diffSummary ?? null,
        change.severity,
        change.detectedAt,
        change.acknowledged ? 1 : 0,
      ],
    );
    const row = this.db.queryOne<any>("SELECT last_insert_rowid() as id");
    return row?.id ?? 0;
  }

  getUnacknowledgedChanges(): ChangeRecord[] {
    return this.db
      .query<any>(
        `SELECT * FROM change_history
         WHERE acknowledged = 0
         ORDER BY detected_at DESC`,
      )
      .map(this.mapChange);
  }

  getChangesForEndpoint(endpointId: string, limit = 50): ChangeRecord[] {
    return this.db
      .query<any>(
        `SELECT * FROM change_history
         WHERE endpoint_id = ?
         ORDER BY detected_at DESC LIMIT ?`,
        [endpointId, limit],
      )
      .map(this.mapChange);
  }

  acknowledgeChange(changeId: number): void {
    this.db.execute(
      "UPDATE change_history SET acknowledged = 1 WHERE id = ?",
      [changeId],
    );
  }

  acknowledgeAllForEndpoint(endpointId: string): void {
    this.db.execute(
      "UPDATE change_history SET acknowledged = 1 WHERE endpoint_id = ?",
      [endpointId],
    );
  }

  // ── Row Mappers ─────────────────────────────────────────

  private mapDevice(row: any): Device {
    return {
      id: row.id,
      ip: row.ip,
      mac: row.mac ?? undefined,
      hostname: row.hostname ?? undefined,
      name: row.name ?? undefined,
      deviceType: row.device_type as DeviceType,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      isOnline: row.is_online === 1,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private mapService(row: any): DeviceService {
    return {
      id: row.id,
      deviceId: row.device_id,
      protocol: row.protocol as ServiceProtocol,
      port: row.port,
      path: row.path,
      label: row.label ?? undefined,
      isActive: row.is_active === 1,
      probedAt: row.probed_at,
      responseMs: row.response_ms ?? undefined,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private mapSnapshot(row: any): ContentSnapshot {
    return {
      id: row.id,
      endpointId: row.endpoint_id,
      contentHash: row.content_hash,
      contentText: row.content_text ?? undefined,
      contentSize: row.content_size ?? undefined,
      snapshotAt: row.snapshot_at,
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  private mapChange(row: any): ChangeRecord {
    return {
      id: row.id,
      endpointId: row.endpoint_id,
      changeType: row.change_type as ChangeType,
      description: row.description,
      oldHash: row.old_hash ?? undefined,
      newHash: row.new_hash ?? undefined,
      diffSummary: row.diff_summary ?? undefined,
      severity: row.severity as "info" | "warning" | "alert",
      detectedAt: row.detected_at,
      acknowledged: row.acknowledged === 1,
    };
  }
}

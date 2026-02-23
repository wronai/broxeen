/**
 * AutoScanScheduler - periodically triggers incremental network scans
 * and updates device online/offline status based on scan results.
 */

import type { PluginContext } from '../../core/types';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { ScanHistoryRepository } from '../../persistence/scanHistoryRepository';
import { logger } from '../../lib/logger';
import type { DeviceStatusChange } from '../../reactive/alertBridge';

const schedLogger = logger.scope('auto-scan:scheduler');

export interface AutoScanConfig {
  intervalMs: number;       // How often to run (default: 5 min)
  offlineThresholdMs: number; // Mark offline after N ms without scan (default: 30 min)
  enabled: boolean;
}

const DEFAULT_CONFIG: AutoScanConfig = {
  intervalMs: 5 * 60 * 1000,       // 5 min
  offlineThresholdMs: 30 * 60 * 1000, // 30 min
  enabled: true,
};

export type DeviceStatusChangeCallback = (change: DeviceStatusChange) => void;

export class AutoScanScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private context: PluginContext | null = null;
  private config: AutoScanConfig;
  private running = false;
  private lastScanAt = 0;
  private knownStatuses = new Map<string, 'online' | 'offline'>();
  private onStatusChange: DeviceStatusChangeCallback | null = null;

  constructor(config: Partial<AutoScanConfig> = {}, onStatusChange?: DeviceStatusChangeCallback) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.onStatusChange = onStatusChange ?? null;
  }

  setStatusChangeCallback(cb: DeviceStatusChangeCallback): void {
    this.onStatusChange = cb;
  }

  start(context: PluginContext): void {
    if (!this.config.enabled) return;
    if (this.timer) return;

    this.context = context;
    schedLogger.info('AutoScanScheduler started', { intervalMs: this.config.intervalMs });

    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.context = null;
    schedLogger.info('AutoScanScheduler stopped');
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get lastScanTimestamp(): number {
    return this.lastScanAt;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    if (!this.context?.tauriInvoke || !this.context.isTauri) return;

    this.running = true;
    const tickStart = Date.now();

    try {
      const subnet = await this.detectSubnet();
      if (!subnet) {
        schedLogger.debug('AutoScan tick: no subnet detected, skipping');
        return;
      }

      const scanHistoryRepo = this.context.databaseManager
        ? new ScanHistoryRepository(this.context.databaseManager.getDevicesDb())
        : null;

      const recommendation = scanHistoryRepo
        ? await scanHistoryRepo.shouldUseIncrementalScan(subnet)
        : { recommended: false, reason: 'no DB', lastScan: null };

      const incremental = recommendation.recommended;
      let targetRanges: string[] = [];

      if (incremental && this.context.databaseManager) {
        targetRanges = await this.buildIncrementalRanges(subnet);
      }

      schedLogger.debug('AutoScan tick', { subnet, incremental, ranges: targetRanges.length });

      const result = await this.context.tauriInvoke('scan_network', {
        args: {
          subnet,
          timeout: 3000,
          incremental,
          target_ranges: targetRanges,
        },
      }) as { devices: Array<{ ip: string; open_ports: number[]; response_time: number; last_seen: string; device_type: string }> };

      this.lastScanAt = Date.now();

      if (this.context.databaseManager && result?.devices) {
        await this.persistResults(subnet, result.devices, tickStart);
        this.detectStatusChanges(result.devices);
      }

      schedLogger.info('AutoScan tick complete', {
        devices: result?.devices?.length ?? 0,
        mode: incremental ? 'incremental' : 'full',
        durationMs: Date.now() - tickStart,
      });
    } catch (err) {
      schedLogger.warn('AutoScan tick failed', err);
    } finally {
      this.running = false;
    }
  }

  private async detectSubnet(): Promise<string | null> {
    if (!this.context?.tauriInvoke) return null;
    try {
      const ifaces = await this.context.tauriInvoke('list_network_interfaces') as any[];
      for (const iface of ifaces ?? []) {
        const ip = Array.isArray(iface) ? iface[1] : iface?.ip;
        if (typeof ip === 'string' && ip.startsWith('192.168.')) {
          return ip.split('.').slice(0, 3).join('.');
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async buildIncrementalRanges(subnet: string): Promise<string[]> {
    if (!this.context?.databaseManager) return [];
    try {
      const repo = new DeviceRepository(this.context.databaseManager.getDevicesDb());
      const devices = await repo.listDevices(200);
      const prefix = `${subnet}.`;
      const octets = devices
        .map(d => d.ip)
        .filter(ip => ip.startsWith(prefix))
        .map(ip => parseInt(ip.split('.')[3], 10))
        .filter(n => n >= 1 && n <= 254);

      if (octets.length === 0) return [];

      const WINDOW = 4;
      const ranges: Array<[number, number]> = octets.map(o => [
        Math.max(1, o - WINDOW),
        Math.min(254, o + WINDOW),
      ]);

      // Merge overlapping ranges
      ranges.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const r of ranges) {
        if (merged.length === 0 || r[0] > merged[merged.length - 1][1] + 1) {
          merged.push([...r]);
        } else {
          merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
        }
      }

      return merged.map(([lo, hi]) => lo === hi ? `${lo}` : `${lo}-${hi}`);
    } catch {
      return [];
    }
  }

  private detectStatusChanges(
    devices: Array<{ ip: string; open_ports: number[]; response_time: number; last_seen: string; device_type: string }>,
  ): void {
    if (!this.onStatusChange) return;

    const seenIps = new Set(devices.map(d => d.ip));

    // Devices that appeared online
    for (const d of devices) {
      const prev = this.knownStatuses.get(d.ip);
      if (prev === 'offline' || prev === undefined) {
        if (prev === 'offline') {
          this.onStatusChange({
            ip: d.ip,
            deviceType: d.device_type || undefined,
            previousStatus: 'offline',
            currentStatus: 'online',
            detectedAt: new Date(),
          });
        }
        this.knownStatuses.set(d.ip, 'online');
      }
    }

    // Devices that went offline (were known online, not seen this scan)
    for (const [ip, status] of this.knownStatuses.entries()) {
      if (status === 'online' && !seenIps.has(ip)) {
        this.knownStatuses.set(ip, 'offline');
        this.onStatusChange({
          ip,
          previousStatus: 'online',
          currentStatus: 'offline',
          detectedAt: new Date(),
        });
      }
    }
  }

  private async persistResults(
    subnet: string,
    devices: Array<{ ip: string; open_ports: number[]; response_time: number; last_seen: string; device_type: string }>,
    scanStart: number,
  ): Promise<void> {
    if (!this.context?.databaseManager) return;
    try {
      const repo = new DeviceRepository(this.context.databaseManager.getDevicesDb());
      const scanHistoryRepo = new ScanHistoryRepository(this.context.databaseManager.getDevicesDb());

      for (const d of devices) {
        await repo.saveDevice({ id: d.ip, ip: d.ip });
        await repo.updateDeviceStatus(d.ip, 'online');
      }

      await scanHistoryRepo.save({
        timestamp: Date.now(),
        scope: 'auto',
        subnet,
        deviceCount: devices.length,
        durationMs: Date.now() - scanStart,
        success: true,
      });
    } catch (err) {
      schedLogger.warn('AutoScan persistResults failed', err);
    }
  }
}

export const autoScanScheduler = new AutoScanScheduler();

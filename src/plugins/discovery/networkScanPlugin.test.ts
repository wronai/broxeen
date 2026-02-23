import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkScanPlugin } from './networkScanPlugin';

describe('NetworkScanPlugin subnet detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('probeGateways returns the first subnet in priority order that succeeds', async () => {
    const plugin = new NetworkScanPlugin() as any;

    const subnets = ['192.168.188', '192.168.0', '192.168.1'];

    plugin.probeGateway = (subnet: string) => {
      if (subnet === '192.168.188') {
        return new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10));
      }
      return new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100));
    };

    const p = plugin.probeGateways(subnets);

    await vi.advanceTimersByTimeAsync(11);
    await expect(p).resolves.toBe('192.168.188');
  });

  it('probeGateways skips earlier subnets that fail and returns next successful in order', async () => {
    const plugin = new NetworkScanPlugin() as any;

    const subnets = ['192.168.188', '192.168.0', '192.168.1'];

    plugin.probeGateway = (subnet: string) => {
      if (subnet === '192.168.188') {
        return new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10));
      }
      if (subnet === '192.168.0') {
        return new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20));
      }
      return new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 5));
    };

    const p = plugin.probeGateways(subnets);

    await vi.advanceTimersByTimeAsync(21);
    await expect(p).resolves.toBe('192.168.0');
  });

  it('getDefaultSubnet picks best interface from Tauri list_network_interfaces tuple payload', async () => {
    const plugin = new NetworkScanPlugin() as any;

    const context = {
      isTauri: true,
      tauriInvoke: vi.fn().mockResolvedValue([
        ['docker0', '172.17.0.1'],
        ['wlan0', '192.168.188.23'],
      ]),
    } as any;

    const subnet = await plugin.getDefaultSubnet(context);
    expect(subnet).toBe('192.168.188');
  });
});

describe('NetworkScanPlugin canHandle', () => {
  it('handles Raspberry Pi discovery queries', async () => {
    const plugin = new NetworkScanPlugin();
    const ok = await plugin.canHandle('znajdź rpi w sieci', { isTauri: false } as any);
    expect(ok).toBe(true);
  });

  it('handles device status queries', async () => {
    const plugin = new NetworkScanPlugin();
    expect(await plugin.canHandle('status urządzeń', { isTauri: false } as any)).toBe(true);
    expect(await plugin.canHandle('lista urządzeń', { isTauri: false } as any)).toBe(true);
    expect(await plugin.canHandle('znane urządzenia', { isTauri: false } as any)).toBe(true);
    expect(await plugin.canHandle('pokaż urządzenia', { isTauri: false } as any)).toBe(true);
    expect(await plugin.canHandle('device status', { isTauri: false } as any)).toBe(true);
  });
});

describe('NetworkScanPlugin handleDeviceStatus', () => {
  it('returns error when no databaseManager', async () => {
    const plugin = new NetworkScanPlugin();
    const result = await plugin.execute('status urządzeń', { isTauri: true } as any);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('niedostępna');
  });

  it('returns empty message when no devices in DB', async () => {
    const plugin = new NetworkScanPlugin();
    const mockDb = {
      query: vi.fn(async () => []),
      execute: vi.fn(async () => {}),
      queryOne: vi.fn(async () => null),
    };
    const ctx = {
      isTauri: true,
      databaseManager: { getDevicesDb: () => mockDb },
    } as any;

    const result = await plugin.execute('status urządzeń', ctx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak zapisanych urządzeń');
  });

  it('classifies devices as online/offline based on last_seen', async () => {
    const plugin = new NetworkScanPlugin();
    const now = Date.now();
    const mockDevices = [
      { id: '1', ip: '192.168.1.1', hostname: 'router', mac: null, vendor: null, last_seen: now - 5 * 60 * 1000 },     // 5 min ago → online
      { id: '2', ip: '192.168.1.100', hostname: null, mac: null, vendor: null, last_seen: now - 30 * 60 * 1000 },       // 30 min ago → niedawno
      { id: '3', ip: '192.168.1.200', hostname: 'cam', mac: null, vendor: null, last_seen: now - 3 * 60 * 60 * 1000 }, // 3 h ago → offline
    ];
    const mockDb = {
      query: vi.fn(async () => mockDevices),
      execute: vi.fn(async () => {}),
      queryOne: vi.fn(async () => null),
    };
    const ctx = {
      isTauri: true,
      databaseManager: { getDevicesDb: () => mockDb },
    } as any;

    const result = await plugin.execute('status urządzeń', ctx);
    expect(result.status).toBe('success');
    const data = result.content[0].data;
    expect(data).toContain('🟢');
    expect(data).toContain('🔴');
    expect(data).toContain('online: 1');
    expect(data).toContain('192.168.1.1');
    expect((result.metadata as any).deviceCount).toBe(3);
  });
});

describe('NetworkScanPlugin execute', () => {
  it('passes incremental + target_ranges to scan_network when strategy is incremental', async () => {
    const plugin = new NetworkScanPlugin() as any;

    const tauriInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scan_network') {
        return {
          devices: [],
          scan_duration: 10,
          scan_method: 'tcp-connect-parallel-incremental',
          subnet: '192.168.1',
        };
      }
      return [];
    });

    plugin.determineScanStrategy = vi.fn(async () => ({
      type: 'incremental',
      subnet: '192.168.1',
      targetRanges: ['192.168.1.1-10'],
      triggeredBy: 'manual',
    }));

    plugin.persistDevices = vi.fn(async () => undefined);
    plugin.trackScanResults = vi.fn(async () => ({
      devicesFound: 0,
      devicesUpdated: 0,
      newDevices: 0,
      scanDuration: 1,
      efficiency: '0 devices/s',
    }));

    await plugin.execute('skanuj sieć', { isTauri: true, tauriInvoke } as any);

    expect(tauriInvoke).toHaveBeenCalledWith('scan_network', expect.objectContaining({
      args: expect.objectContaining({
        incremental: true,
        target_ranges: ['192.168.1.1-10'],
      }),
    }));
  });
});

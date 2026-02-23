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

describe('NetworkScanPlugin handleDeviceFilter', () => {
  const now = Date.now();
  const mockDevices = [
    { id: '1', ip: '192.168.1.100', hostname: 'cam1', mac: null, vendor: null, last_seen: now - 2 * 60 * 1000, device_type: 'camera' },
    { id: '2', ip: '192.168.1.1', hostname: 'router', mac: null, vendor: null, last_seen: now - 5 * 60 * 1000, device_type: 'gateway' },
    { id: '3', ip: '192.168.1.101', hostname: 'cam2', mac: null, vendor: null, last_seen: now - 60 * 60 * 1000, device_type: 'camera' },
  ];

  const makeCtx = () => ({
    isTauri: true,
    databaseManager: {
      getDevicesDb: () => ({
        query: vi.fn(async () => mockDevices),
        execute: vi.fn(async () => {}),
        queryOne: vi.fn(async () => null),
      }),
    },
  } as any);

  it('canHandle filter keywords', async () => {
    const plugin = new NetworkScanPlugin();
    expect(await plugin.canHandle('tylko kamery', {} as any)).toBe(true);
    expect(await plugin.canHandle('filtruj urządzenia', {} as any)).toBe(true);
    expect(await plugin.canHandle('tylko routery', {} as any)).toBe(true);
    expect(await plugin.canHandle('filter devices', {} as any)).toBe(true);
  });

  it('returns type summary when no specific type given', async () => {
    const plugin = new NetworkScanPlugin();
    const result = await plugin.execute('filtruj urządzenia', makeCtx());
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Typy urządzeń');
    expect(result.content[0].data).toContain('Kamery');
  });

  it('filters by camera type', async () => {
    const plugin = new NetworkScanPlugin();
    const result = await plugin.execute('tylko kamery', makeCtx());
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Kamery');
    expect(result.content[0].data).toContain('192.168.1.100');
    expect(result.content[0].data).toContain('192.168.1.101');
    expect((result.metadata as any).deviceCount).toBe(2);
  });

  it('returns empty message when no devices of given type', async () => {
    const plugin = new NetworkScanPlugin();
    const ctx = {
      isTauri: true,
      databaseManager: {
        getDevicesDb: () => ({
          query: vi.fn(async () => []),
          execute: vi.fn(async () => {}),
          queryOne: vi.fn(async () => null),
        }),
      },
    } as any;
    const result = await plugin.execute('tylko drukarki', ctx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak urządzeń');
  });
});

describe('NetworkScanPlugin handleExport', () => {
  const makeCtxWithDevices = (devices: any[]) => ({
    isTauri: true,
    databaseManager: {
      getDevicesDb: () => ({
        query: vi.fn(async () => devices),
        execute: vi.fn(async () => {}),
        queryOne: vi.fn(async () => null),
      }),
    },
  } as any);

  it('returns error when no databaseManager', async () => {
    const plugin = new NetworkScanPlugin();
    const result = await plugin.execute('eksportuj urządzenia', { isTauri: true } as any);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('niedostępna');
  });

  it('returns empty message when no devices', async () => {
    const plugin = new NetworkScanPlugin();
    const result = await plugin.execute('eksportuj urządzenia', makeCtxWithDevices([]));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak urządzeń');
  });

  it('exports CSV by default', async () => {
    const plugin = new NetworkScanPlugin();
    const now = Date.now();
    const devices = [
      { id: '1', ip: '192.168.1.1', hostname: 'router', mac: 'AA:BB:CC', vendor: 'Cisco', last_seen: now - 1000, device_type: 'gateway', open_ports: [80, 443] },
    ];
    const result = await plugin.execute('eksportuj urządzenia', makeCtxWithDevices(devices));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('CSV');
    expect(result.content[0].data).toContain('192.168.1.1');
    expect(result.content[0].data).toContain('ip,hostname,mac');
    expect(result.content[0].data).toContain('.csv');
  });

  it('exports JSON when json keyword present', async () => {
    const plugin = new NetworkScanPlugin();
    const now = Date.now();
    const devices = [
      { id: '1', ip: '192.168.1.100', hostname: null, mac: null, vendor: null, last_seen: now - 1000, device_type: 'camera', open_ports: [554] },
    ];
    const result = await plugin.execute('eksport json', makeCtxWithDevices(devices));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('JSON');
    expect(result.content[0].data).toContain('"ip"');
    expect(result.content[0].data).toContain('.json');
  });

  it('canHandle export keywords', async () => {
    const plugin = new NetworkScanPlugin();
    const ctx = { isTauri: true } as any;
    expect(await plugin.canHandle('eksportuj urządzenia', ctx)).toBe(true);
    expect(await plugin.canHandle('export csv', ctx)).toBe(true);
    expect(await plugin.canHandle('eksport json', ctx)).toBe(true);
    expect(await plugin.canHandle('pobierz urządzenia', ctx)).toBe(true);
  });

  it('marks truncated when export > 3000 chars', async () => {
    const plugin = new NetworkScanPlugin();
    const now = Date.now();
    const devices = Array.from({ length: 100 }, (_, i) => ({
      id: String(i), ip: `192.168.1.${i}`, hostname: `host-${i}`, mac: null, vendor: null,
      last_seen: now - 1000, device_type: 'linux-device', open_ports: [],
    }));
    const result = await plugin.execute('eksportuj urządzenia', makeCtxWithDevices(devices));
    expect((result.metadata as any).truncated).toBe(true);
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

  it('forces full scan for camera discovery even when strategy recommends incremental', async () => {
    const plugin = new NetworkScanPlugin() as any;

    const tauriInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'scan_network') {
        return {
          devices: [],
          scan_duration: 10,
          scan_method: 'tcp-connect-parallel',
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

    await plugin.execute('pokaż kamery 192.168.1', { isTauri: true, tauriInvoke } as any);

    expect(tauriInvoke).toHaveBeenCalledWith('scan_network', expect.objectContaining({
      args: expect.objectContaining({
        incremental: false,
        target_ranges: [],
      }),
    }));
  });
});

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

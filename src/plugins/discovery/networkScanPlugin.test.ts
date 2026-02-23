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

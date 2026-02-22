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
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoScanScheduler } from './autoScanScheduler';

const makeTauriCtx = (invokeImpl?: (cmd: string, args?: any) => any) => ({
  isTauri: true,
  tauriInvoke: vi.fn(async (cmd: string, args?: any) => {
    if (invokeImpl) return invokeImpl(cmd, args);
    if (cmd === 'list_network_interfaces') return [['wlan0', '192.168.1.23']];
    if (cmd === 'scan_network') return { devices: [], scan_duration: 10, scan_method: 'tcp', subnet: '192.168.1' };
    return null;
  }),
  databaseManager: null,
});

describe('AutoScanScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not start when enabled=false', () => {
    const scheduler = new AutoScanScheduler({ enabled: false });
    const ctx = makeTauriCtx();
    scheduler.start(ctx as any);
    expect(scheduler.isRunning).toBe(false);
  });

  it('starts and stops correctly', () => {
    const scheduler = new AutoScanScheduler({ intervalMs: 60_000 });
    const ctx = makeTauriCtx();
    scheduler.start(ctx as any);
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
  });

  it('does not double-start', () => {
    const scheduler = new AutoScanScheduler({ intervalMs: 60_000 });
    const ctx = makeTauriCtx();
    scheduler.start(ctx as any);
    scheduler.start(ctx as any); // second call should be no-op
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
  });

  it('does not run in non-tauri context', async () => {
    const scheduler = new AutoScanScheduler({ intervalMs: 1_000 });
    const ctx = { isTauri: false, tauriInvoke: undefined, databaseManager: null };
    scheduler.start(ctx as any);
    await vi.advanceTimersByTimeAsync(1_100);
    // Should not throw, just silently skip
    scheduler.stop();
  });

  it('calls scan_network after interval elapses', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_network_interfaces') return [['wlan0', '192.168.1.23']];
      if (cmd === 'scan_network') return { devices: [], scan_duration: 10, scan_method: 'tcp', subnet: '192.168.1' };
      return null;
    });
    const ctx = { isTauri: true, tauriInvoke: invoke, databaseManager: null };
    const scheduler = new AutoScanScheduler({ intervalMs: 1_000 });
    scheduler.start(ctx as any);

    await vi.advanceTimersByTimeAsync(1_100);

    expect(invoke).toHaveBeenCalledWith('list_network_interfaces');
    expect(invoke).toHaveBeenCalledWith('scan_network', expect.objectContaining({
      args: expect.objectContaining({ subnet: '192.168.1', timeout: 3000 }),
    }));

    scheduler.stop();
  });

  it('updates lastScanTimestamp after successful tick', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_network_interfaces') return [['wlan0', '192.168.1.23']];
      if (cmd === 'scan_network') return { devices: [{ ip: '192.168.1.1', open_ports: [80], response_time: 5, last_seen: new Date().toISOString(), device_type: 'web-device' }], scan_duration: 10, scan_method: 'tcp', subnet: '192.168.1' };
      return null;
    });
    const ctx = { isTauri: true, tauriInvoke: invoke, databaseManager: null };
    const scheduler = new AutoScanScheduler({ intervalMs: 1_000 });

    expect(scheduler.lastScanTimestamp).toBe(0);
    scheduler.start(ctx as any);
    await vi.advanceTimersByTimeAsync(1_100);

    expect(scheduler.lastScanTimestamp).toBeGreaterThan(0);
    scheduler.stop();
  });

  it('skips tick when previous tick still running', async () => {
    let resolveFirst: (() => void) | null = null;
    let scanCallCount = 0;

    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'list_network_interfaces') return [['wlan0', '192.168.1.23']];
      if (cmd === 'scan_network') {
        scanCallCount++;
        if (scanCallCount === 1) {
          await new Promise<void>(res => { resolveFirst = res; });
        }
        return { devices: [], scan_duration: 10, scan_method: 'tcp', subnet: '192.168.1' };
      }
      return null;
    });

    const ctx = { isTauri: true, tauriInvoke: invoke, databaseManager: null };
    const scheduler = new AutoScanScheduler({ intervalMs: 500 });
    scheduler.start(ctx as any);

    // First tick starts (blocks on scan_network)
    await vi.advanceTimersByTimeAsync(600);
    // Second tick fires but should be skipped (first still running)
    await vi.advanceTimersByTimeAsync(600);

    // Resolve first scan
    resolveFirst?.();
    await vi.advanceTimersByTimeAsync(10);

    expect(scanCallCount).toBe(1);
    scheduler.stop();
  });
});

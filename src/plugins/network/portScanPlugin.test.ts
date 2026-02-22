import { describe, it, expect, vi } from 'vitest';
import { PortScanPlugin } from './portScanPlugin';

describe('PortScanPlugin', () => {
  it('should not treat IP octets as ports', async () => {
    const plugin = new PortScanPlugin();

    const tauriInvoke = vi.fn().mockResolvedValue({ scanned: 0, open: [] });

    await plugin.execute('skanuj porty 192.168.188.146', {
      isTauri: true,
      tauriInvoke,
      scope: 'local',
    } as any);

    expect(tauriInvoke).toHaveBeenCalledTimes(1);
    const [_cmd, args] = tauriInvoke.mock.calls[0];

    expect(_cmd).toBe('scan_ports');
    const ports = (args as any).ports as number[];

    // If parsing is wrong, ports would be [192,168,188,146]
    expect(ports).not.toEqual([192, 168, 188, 146]);
    expect(ports).not.toContain(192);
    expect(ports).not.toContain(168);
    expect(ports).not.toContain(188);
    expect(ports).not.toContain(146);

    // Should fall back to the common port list
    expect(ports.length).toBeGreaterThan(6);
    expect(ports).toContain(80);
    expect(ports).toContain(443);
  });
});

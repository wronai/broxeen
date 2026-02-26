/**
 * Unit tests for all Network plugins (canonical implementations)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PingPlugin } from './pingPlugin';
import { PortScanPlugin } from './portScanPlugin';
import { ArpPlugin } from './arpPlugin';
import { WakeOnLanPlugin } from './wakeOnLanPlugin';
import { MdnsPlugin } from './mdnsPlugin';
import { OnvifPlugin } from './onvifPlugin';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = { isTauri: false };
const tauriCtx: PluginContext = {
  isTauri: true,
  tauriInvoke: vi.fn(),
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── PingPlugin ──────────────────────────────────────────────

describe('PingPlugin', () => {
  let plugin: PingPlugin;
  beforeEach(() => { plugin = new PingPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-ping');
    expect(plugin.supportedIntents).toContain('network:ping');
  });

  it('canHandle recognizes Polish ping requests', async () => {
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('sprawdź dostępność hosta', browserCtx)).toBe(true);
    expect(await plugin.canHandle('czy jest dostępny', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns result in browser mode', async () => {
    // Browser mode uses HTTP HEAD fallback
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await plugin.execute('ping 192.168.1.1', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
  });

  it('returns error when no target given', async () => {
    const result = await plugin.execute('ping', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('adres IP');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue({ reachable: true, sent: 3, received: 3, lost: 0, lossPercent: 0, avgRtt: 5 }) };
    const result = await plugin.execute('ping 192.168.1.1', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('ping_host', { host: '192.168.1.1', count: 3 });
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('dostępny');
  });

  it('handles Tauri invoke failure gracefully', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await plugin.execute('ping 10.0.0.1', ctx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('timeout');
  });
});

// ── PortScanPlugin ──────────────────────────────────────────

describe('PortScanPlugin', () => {
  let plugin: PortScanPlugin;
  beforeEach(() => { plugin = new PortScanPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-port-scan');
    expect(plugin.supportedIntents).toContain('network:port-scan');
  });

  it('canHandle recognizes port scan requests', async () => {
    expect(await plugin.canHandle('skanuj porty 192.168.1.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('otwarte porty na serwerze', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jakie porty ma 10.0.0.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns result in browser mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await plugin.execute('skanuj porty 192.168.1.1', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
  });

  it('returns error when no target given', async () => {
    const result = await plugin.execute('skanuj porty', browserCtx);
    expect(result.status).toBe('error');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue({ scanned: 20, open: [{ port: 22, rtt: 5 }, { port: 80, rtt: 3 }], filtered: [] }) };
    const result = await plugin.execute('skanuj porty 192.168.1.1', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('SSH');
    expect(result.content[0].data).toContain('HTTP');
  });
});

// ── ArpPlugin ───────────────────────────────────────────────

describe('ArpPlugin', () => {
  let plugin: ArpPlugin;
  beforeEach(() => { plugin = new ArpPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-arp');
    expect(plugin.supportedIntents).toContain('network:arp');
  });

  it('canHandle recognizes ARP requests', async () => {
    expect(await plugin.canHandle('arp scan', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wszystkie urządzenia', browserCtx)).toBe(true);
    expect(await plugin.canHandle('urządzenia lan', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns result in browser mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await plugin.execute('skanuj arp', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('ARP');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const hosts = [{ ip: '10.0.0.1', mac: 'AA:BB:CC:DD:EE:01', vendor: 'Cisco' }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(hosts) };
    const result = await plugin.execute('arp scan', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('arp_scan', expect.objectContaining({ timeout: 3000 }));
    expect(result.status).toBe('success');
    expect((result.metadata as any).deviceCount).toBe(1);
  });
});

// ── WakeOnLanPlugin ─────────────────────────────────────────

describe('WakeOnLanPlugin', () => {
  let plugin: WakeOnLanPlugin;
  beforeEach(() => { plugin = new WakeOnLanPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-wol');
    expect(plugin.supportedIntents).toContain('network:wol');
  });

  it('canHandle recognizes WoL requests', async () => {
    expect(await plugin.canHandle('wake on lan', browserCtx)).toBe(true);
    expect(await plugin.canHandle('obudź urządzenie', browserCtx)).toBe(true);
    expect(await plugin.canHandle('włącz komputer', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns error when no MAC given', async () => {
    const result = await plugin.execute('obudź urządzenie', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('MAC');
  });

  it('returns demo result in browser mode with valid MAC', async () => {
    const result = await plugin.execute('obudź urządzenie AA:BB:CC:DD:EE:FF', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('AA:BB:CC:DD:EE:FF');
    expect(result.content[0].data).toContain('demonstracyjny');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(undefined) };
    const result = await plugin.execute('obudź urządzenie AA:BB:CC:DD:EE:FF', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('network_wol', { mac: 'AA:BB:CC:DD:EE:FF' });
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('wysłany');
  });
});

// ── MdnsPlugin ──────────────────────────────────────────────

describe('MdnsPlugin', () => {
  let plugin: MdnsPlugin;
  beforeEach(() => { plugin = new MdnsPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-mdns');
    expect(plugin.supportedIntents).toContain('network:mdns');
  });

  it('canHandle recognizes mDNS requests', async () => {
    expect(await plugin.canHandle('mdns discovery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('bonjour services', browserCtx)).toBe(true);
    expect(await plugin.canHandle('odkryj urządzenia', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns info in browser mode', async () => {
    const result = await plugin.execute('odkryj usługi mdns', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('mDNS');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const services = [{ name: 'Test', type: '_http._tcp', host: 'test.local', ip: '10.0.0.1', port: 80 }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(services) };
    const result = await plugin.execute('mdns', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect((result.metadata as any).deviceCount).toBe(1);
  });
});

// ── OnvifPlugin ─────────────────────────────────────────────

describe('OnvifPlugin', () => {
  let plugin: OnvifPlugin;
  beforeEach(() => { plugin = new OnvifPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('network-onvif');
    expect(plugin.supportedIntents).toContain('camera:onvif');
    expect(plugin.supportedIntents).toContain('camera:discover');
  });

  it('canHandle recognizes ONVIF requests', async () => {
    expect(await plugin.canHandle('onvif discover', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wykryj kamery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('kamery w sieci', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns result in browser mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await plugin.execute('odkryj kamery onvif', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('ONVIF');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const cameras = [{ ip: '10.0.0.1', port: 80, name: 'Test Cam', manufacturer: 'Test', requiresAuth: false }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(cameras) };
    const result = await plugin.execute('onvif', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('discover_onvif_cameras', expect.objectContaining({ timeout: 5000 }));
    expect(result.status).toBe('success');
    expect((result.metadata as any).deviceCount).toBe(1);
  });
});

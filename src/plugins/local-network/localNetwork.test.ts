/**
 * Unit tests for all Local Network plugins
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
    expect(await plugin.canHandle('sprawdź host router.local', browserCtx)).toBe(true);
    expect(await plugin.canHandle('czy router odpowiada', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns demo result in browser mode', async () => {
    const result = await plugin.execute('ping 192.168.1.1', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
    expect(result.content[0].data).toContain('demonstracyjny');
  });

  it('returns error when no target given', async () => {
    const result = await plugin.execute('ping', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('adres IP');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue({ reachable: true, latency_ms: 5, ttl: 64 }) };
    const result = await plugin.execute('ping 192.168.1.1', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('network_ping', { host: '192.168.1.1' });
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Dostępny');
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

  it('returns demo result in browser mode', async () => {
    const result = await plugin.execute('skanuj porty 192.168.1.1', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
  });

  it('returns error when no target given', async () => {
    const result = await plugin.execute('skanuj porty', browserCtx);
    expect(result.status).toBe('error');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue({ open_ports: [22, 80, 443], scan_duration_ms: 1200 }) };
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
    expect(await plugin.canHandle('tablica arp', browserCtx)).toBe(true);
    expect(await plugin.canHandle('adresy mac', browserCtx)).toBe(true);
    expect(await plugin.canHandle('arp table', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns demo entries in browser mode', async () => {
    const result = await plugin.execute('pokaż tablicę arp', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Tablica ARP');
    expect(result.content[0].data).toContain('192.168.1.1');
    expect(result.metadata.deviceCount).toBe(5);
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const entries = [{ ip: '10.0.0.1', mac: 'AA:BB:CC:DD:EE:01', vendor: 'Cisco' }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(entries) };
    const result = await plugin.execute('arp table', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('network_arp_scan', {});
    expect(result.status).toBe('success');
    expect(result.metadata.deviceCount).toBe(1);
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
    expect(await plugin.canHandle('odkryj usługi', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns demo services in browser mode', async () => {
    const result = await plugin.execute('odkryj usługi mdns', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('mDNS');
    expect(result.metadata.serviceCount).toBeGreaterThan(0);
  });

  it('filters demo by service type', async () => {
    const result = await plugin.execute('odkryj usługi rtsp kamer', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('_rtsp._tcp');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const services = [{ name: 'Test', type: '_http._tcp', host: 'test.local', port: 80, ip: '10.0.0.1' }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(services) };
    const result = await plugin.execute('mdns', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.metadata.serviceCount).toBe(1);
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
    expect(await plugin.canHandle('odkryj kamery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('pokaż kamery w sieci', browserCtx)).toBe(true);
    expect(await plugin.canHandle('random text', browserCtx)).toBe(false);
  });

  it('returns demo cameras in browser mode', async () => {
    const result = await plugin.execute('odkryj kamery onvif', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Kamery ONVIF');
    expect(result.content[0].data).toContain('Hikvision');
    expect(result.content[0].data).toContain('Dahua');
    expect(result.metadata.deviceCount).toBe(3);
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const cameras = [{ ip: '10.0.0.1', port: 80, name: 'Test Cam', manufacturer: 'Test' }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(cameras) };
    const result = await plugin.execute('onvif', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('onvif_discover', { timeout: 5000 });
    expect(result.status).toBe('success');
    expect(result.metadata.deviceCount).toBe(1);
  });
});

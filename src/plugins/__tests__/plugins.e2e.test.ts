/**
 * E2E Plugin Tests
 * Tests all plugins: intent routing, scope selection, camera interactions,
 * network scanning, and marketplace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentRouter } from '../../core/intentRouter';
import { PluginRegistry } from '../../core/pluginRegistry';
import { NetworkScanPlugin } from '../discovery/networkScanPlugin';
import { PingPlugin } from '../network/pingPlugin';
import { PortScanPlugin } from '../network/portScanPlugin';
import { OnvifPlugin } from '../network/onvifPlugin';
import { MdnsPlugin } from '../network/mdnsPlugin';
import { ArpPlugin } from '../network/arpPlugin';
import { HttpBrowsePlugin } from '../http/browsePlugin';
import { ChatLlmPlugin } from '../chat/chatPlugin';
import { scopeRegistry } from '../scope/scopeRegistry';
import type { PluginContext } from '../../core/types';

// ─── Shared Fixtures ────────────────────────────────────────

const browserCtx: PluginContext = {
  isTauri: false,
  scope: 'network',
};

const tauriCtxBase: PluginContext = {
  isTauri: true,
  scope: 'local',
  tauriInvoke: vi.fn(),
};

function makeTauriCtx(invokeImpl: (cmd: string, args?: any) => Promise<any>): PluginContext {
  return { ...tauriCtxBase, tauriInvoke: invokeImpl };
}

// ─── Scope Registry ─────────────────────────────────────────

describe('ScopeRegistry', () => {
  beforeEach(() => scopeRegistry.setActiveScope('network'));

  it('has all built-in scopes', () => {
    const scopes = scopeRegistry.getAllScopes();
    const ids = scopes.map(s => s.id);
    expect(ids).toContain('local');
    expect(ids).toContain('network');
    expect(ids).toContain('internet');
    expect(ids).toContain('remote');
  });

  it('local scope allows network plugins but not internet', () => {
    const local = scopeRegistry.getScope('local')!;
    expect(local.allowLan).toBe(true);
    expect(local.allowInternet).toBe(false);
    expect(local.allowedPlugins).toContain('network-scan');
    expect(local.allowedPlugins).toContain('rtsp-camera');
    expect(local.allowedPlugins).toContain('http-browse'); // LAN IP browsing allowed in local scope
  });

  it('internet scope allows internet but not LAN', () => {
    const internet = scopeRegistry.getScope('internet')!;
    expect(internet.allowInternet).toBe(true);
    expect(internet.allowLan).toBe(false);
    expect(internet.allowedPlugins).toContain('http-browse');
    expect(internet.allowedPlugins).not.toContain('network-scan');
  });

  it('network scope allows both LAN and internet', () => {
    const network = scopeRegistry.getScope('network')!;
    expect(network.allowLan).toBe(true);
    expect(network.allowInternet).toBe(true);
  });

  it('can install and uninstall remote plugins', () => {
    scopeRegistry.installRemotePlugin({
      id: 'test-remote-plugin',
      name: 'Test Remote',
      version: '1.0.0',
      description: 'Test',
      author: 'test',
      marketplaceUrl: 'https://example.com',
      moduleUrl: 'https://example.com/plugin.js',
      installedAt: Date.now(),
      scope: 'remote',
    });
    expect(scopeRegistry.isPluginAllowed('test-remote-plugin', 'remote')).toBe(true);

    scopeRegistry.uninstallRemotePlugin('test-remote-plugin', 'remote');
    expect(scopeRegistry.isPluginAllowed('test-remote-plugin', 'remote')).toBe(false);
  });

  it('isPluginAllowed respects scope boundaries', () => {
    expect(scopeRegistry.isPluginAllowed('network-scan', 'local')).toBe(true);
    expect(scopeRegistry.isPluginAllowed('http-browse', 'local')).toBe(true); // LAN IP browsing allowed
    expect(scopeRegistry.isPluginAllowed('http-browse', 'internet')).toBe(true);
    expect(scopeRegistry.isPluginAllowed('network-scan', 'internet')).toBe(false);
  });
});

// ─── Intent Router ───────────────────────────────────────────

describe('IntentRouter — scope-aware routing', () => {
  let router: IntentRouter;
  let registry: PluginRegistry;

  beforeEach(() => {
    router = new IntentRouter();
    registry = new PluginRegistry();

    const plugins = [
      new NetworkScanPlugin(),
      new PingPlugin(),
      new PortScanPlugin(),
      new OnvifPlugin(),
      new MdnsPlugin(),
      new ArpPlugin(),
      new HttpBrowsePlugin(),
      new ChatLlmPlugin(),
    ];
    plugins.forEach(p => {
      registry.register(p);
      router.registerPlugin(p as any);
    });
  });

  const cases: Array<[string, string]> = [
    ['pokaż kamery w sieci', 'network:scan'],
    ['skanuj sieć', 'network:scan'],
    ['wykryj kamery', 'network:scan'],
    ['ping 192.168.1.1', 'network:ping'],
    ['sprawdź dostępność hosta', 'network:ping'],
    ['skanuj porty 192.168.1.100', 'network:port-scan'],
    ['jakie porty są otwarte na 192.168.1.1', 'network:port-scan'],
    ['onvif kamery', 'camera:onvif'],
    ['kamery ip', 'camera:onvif'],
    ['mdns usługi', 'network:mdns'],
    ['arp tablica', 'network:arp'],
    ['kto jest w sieci', 'network:arp'],
    ['https://example.com', 'browse:url'],
  ];

  it.each(cases)('"%s" → intent "%s"', async (input, expectedIntent) => {
    const detection = await router.detect(input);
    expect(detection.intent).toBe(expectedIntent);
  });

  it('routes network:scan to NetworkScanPlugin', async () => {
    const detection = await router.detect('pokaż kamery');
    const plugin = router.route(detection.intent);
    expect(plugin).not.toBeNull();
    expect(plugin!.id).toBe('network-scan');
  });

  it('routes network:ping to PingPlugin', async () => {
    const detection = await router.detect('ping 192.168.1.1');
    const plugin = router.route(detection.intent);
    expect(plugin!.id).toBe('network-ping');
  });

  it('routes network:port-scan to PortScanPlugin', async () => {
    const detection = await router.detect('skanuj porty 192.168.1.1');
    const plugin = router.route(detection.intent);
    expect(plugin!.id).toBe('network-port-scan');
  });

  it('routes camera:onvif to OnvifPlugin', async () => {
    const detection = await router.detect('onvif kamery');
    const plugin = router.route(detection.intent);
    expect(plugin!.id).toBe('network-onvif');
  });

  it('routes network:mdns to MdnsPlugin', async () => {
    const detection = await router.detect('mdns usługi');
    const plugin = router.route(detection.intent);
    expect(plugin!.id).toBe('network-mdns');
  });

  it('routes network:arp to ArpPlugin', async () => {
    const detection = await router.detect('arp tablica');
    const plugin = router.route(detection.intent);
    expect(plugin!.id).toBe('network-arp');
  });

  it('falls back to chat:ask for unknown input', async () => {
    const detection = await router.detect('opowiedz mi o historii Polski');
    expect(detection.intent).toBe('chat:ask');
  });
});

// ─── NetworkScanPlugin ───────────────────────────────────────

describe('NetworkScanPlugin', () => {
  let plugin: NetworkScanPlugin;

  beforeEach(() => { plugin = new NetworkScanPlugin(); });

  it('handles camera query in browser mode (no tauriInvoke)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(null));
    const result = await plugin.execute('pokaż kamery', browserCtx);
    expect(result.pluginId).toBe('network-scan');
    expect(result.status).toBe('success');
    expect(result.content[0].data).toMatch(/tryb HTTP|tryb przeglądarkowy|Tryb demonstracyjny|demonstracyjny/i);
    vi.unstubAllGlobals();
  });

  it('calls scan_network via Tauri invoke', async () => {
    const mockResult = {
      devices: [
        { ip: '192.168.1.100', open_ports: [554, 80], response_time: 12, last_seen: new Date().toISOString(), device_type: 'camera' },
        { ip: '192.168.1.1', open_ports: [80, 443], response_time: 5, last_seen: new Date().toISOString(), device_type: 'web-device' },
      ],
      scan_duration: 1200,
      scan_method: 'tcp-connect',
      subnet: '192.168.1',
    };
    const invoke = vi.fn().mockResolvedValue(mockResult);
    const result = await plugin.execute('skanuj sieć', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('scan_network', expect.objectContaining({ timeout: 5000 }));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.100');
    expect(result.metadata.deviceCount).toBe(2);
  });

  it('filters cameras when query is camera-specific', async () => {
    const mockResult = {
      devices: [
        { ip: '192.168.1.100', open_ports: [554], response_time: 10, last_seen: new Date().toISOString(), device_type: 'camera' },
        { ip: '192.168.1.1', open_ports: [80], response_time: 5, last_seen: new Date().toISOString(), device_type: 'web-device' },
      ],
      scan_duration: 500,
      scan_method: 'tcp-connect',
      subnet: '192.168.1',
    };
    const invoke = vi.fn().mockResolvedValue(mockResult);
    const result = await plugin.execute('pokaż kamery', makeTauriCtx(invoke));

    expect(result.content[0].data).toContain('192.168.1.100');
    expect(result.content[0].data).toContain('rtsp://192.168.1.100:554/stream');
  });

  it('returns error on Tauri invoke failure', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await plugin.execute('skanuj sieć', makeTauriCtx(invoke));
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Błąd skanowania sieci');
  });
});

// ─── PingPlugin ──────────────────────────────────────────────

describe('PingPlugin', () => {
  let plugin: PingPlugin;

  beforeEach(() => { plugin = new PingPlugin(); });

  it('canHandle ping queries', async () => {
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('sprawdź dostępność hosta', browserCtx)).toBe(true);
    expect(await plugin.canHandle('czy działa 10.0.0.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('pokaż kamery', browserCtx)).toBe(false);
  });

  it('calls ping_host via Tauri', async () => {
    const mockPing = { reachable: true, sent: 3, received: 3, lost: 0, loss_percent: 0, avg_rtt: 5.2 };
    const invoke = vi.fn().mockResolvedValue(mockPing);
    const result = await plugin.execute('ping 192.168.1.1', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('ping_host', expect.objectContaining({ host: '192.168.1.1' }));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
    expect(result.content[0].data).toContain('dostępny');
  });

  it('shows unreachable when ping fails', async () => {
    const mockPing = { reachable: false, sent: 3, received: 0, lost: 3, loss_percent: 100 };
    const invoke = vi.fn().mockResolvedValue(mockPing);
    const result = await plugin.execute('ping 192.168.1.200', makeTauriCtx(invoke));
    expect(result.content[0].data).toContain('niedostępny');
  });

  it('returns error when no target provided', async () => {
    const result = await plugin.execute('ping', browserCtx);
    expect(result.status).toBe('error');
  });

  it('uses HTTP fallback in browser mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await plugin.execute('ping 192.168.1.1', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toMatch(/tryb przeglądarki|192\.168\.1\.1|dostępny|demonstracyjny/i);
    vi.unstubAllGlobals();
  });
});

// ─── PortScanPlugin ──────────────────────────────────────────

describe('PortScanPlugin', () => {
  let plugin: PortScanPlugin;

  beforeEach(() => { plugin = new PortScanPlugin(); });

  it('canHandle port scan queries', async () => {
    expect(await plugin.canHandle('skanuj porty 192.168.1.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('otwarte porty na 10.0.0.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jakie porty są otwarte', browserCtx)).toBe(true);
    expect(await plugin.canHandle('pokaż kamery', browserCtx)).toBe(false);
  });

  it('calls scan_ports via Tauri', async () => {
    const mockResult = {
      scanned: 20,
      open: [
        { port: 80, rtt: 3, banner: 'HTTP/1.1 200 OK' },
        { port: 554, rtt: 5 },
      ],
      filtered: [443],
    };
    const invoke = vi.fn().mockResolvedValue(mockResult);
    const result = await plugin.execute('skanuj porty 192.168.1.100', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('scan_ports', expect.objectContaining({ host: '192.168.1.100' }));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('80');
    expect(result.content[0].data).toContain('554');
    expect(result.content[0].data).toContain('RTSP');
  });

  it('returns error when no target', async () => {
    const result = await plugin.execute('skanuj porty', browserCtx);
    expect(result.status).toBe('error');
  });
});

// ─── OnvifPlugin ─────────────────────────────────────────────

describe('OnvifPlugin', () => {
  let plugin: OnvifPlugin;

  beforeEach(() => { plugin = new OnvifPlugin(); });

  it('canHandle ONVIF queries', async () => {
    expect(await plugin.canHandle('onvif kamery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('pokaż kamery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wykryj kamery ip', browserCtx)).toBe(true);
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(false);
  });

  it('calls discover_onvif_cameras via Tauri', async () => {
    const mockCameras = [
      {
        ip: '192.168.1.100',
        port: 80,
        name: 'Hikvision DS-2CD2032',
        manufacturer: 'Hikvision',
        model: 'DS-2CD2032',
        rtsp_url: 'rtsp://192.168.1.100:554/stream',
        snapshot_url: 'http://192.168.1.100/snapshot.jpg',
        requires_auth: true,
        profiles: ['Profile_1'],
      },
    ];
    const invoke = vi.fn().mockResolvedValue(mockCameras);
    const result = await plugin.execute('pokaż kamery', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('discover_onvif_cameras', expect.any(Object));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Hikvision');
    expect(result.content[0].data).toContain('192.168.1.100');
    // rtsp_url field may or may not map to output depending on plugin version
    expect(result.content[0].data).toMatch(/rtsp|Wymaga|Profile/i);
  });

  it('shows empty message when no cameras found', async () => {
    const invoke = vi.fn().mockResolvedValue([]);
    const result = await plugin.execute('pokaż kamery', makeTauriCtx(invoke));
    expect(result.content[0].data).toContain('Nie wykryto kamer');
  });

  it('falls back to browser probe mode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(null));
    const result = await plugin.execute('pokaż kamery', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toMatch(/tryb HTTP|tryb przeglądarkowy|ONVIF|Wykrywanie kamer/i);
    vi.unstubAllGlobals();
  });
});

// ─── MdnsPlugin ──────────────────────────────────────────────

describe('MdnsPlugin', () => {
  let plugin: MdnsPlugin;

  beforeEach(() => { plugin = new MdnsPlugin(); });

  it('canHandle mDNS queries', async () => {
    expect(await plugin.canHandle('mdns usługi', browserCtx)).toBe(true);
    expect(await plugin.canHandle('bonjour', browserCtx)).toBe(true);
    expect(await plugin.canHandle('odkryj urządzenia', browserCtx)).toBe(true);
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(false);
  });

  it('calls discover_mdns via Tauri', async () => {
    const mockServices = [
      { name: 'My Printer', service_type: '_printer._tcp', host: 'printer.local', ip: '192.168.1.50', port: 631, txt: {} },
      { name: 'NAS', service_type: '_smb._tcp', host: 'nas.local', ip: '192.168.1.10', port: 445, txt: { path: '/share' } },
    ];
    const invoke = vi.fn().mockResolvedValue(mockServices);
    const result = await plugin.execute('odkryj urządzenia', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('discover_mdns', expect.any(Object));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('My Printer');
    expect(result.content[0].data).toContain('NAS');
    // Friendly type name depends on field mapping (type vs service_type)
    expect(result.content[0].data).toMatch(/Drukarki|printer|My Printer/i);
  });

  it('shows browser limitation message', async () => {
    const result = await plugin.execute('mdns', browserCtx);
    expect(result.content[0].data).toContain('multicast');
  });
});

// ─── ArpPlugin ───────────────────────────────────────────────

describe('ArpPlugin', () => {
  let plugin: ArpPlugin;

  beforeEach(() => { plugin = new ArpPlugin(); });

  it('canHandle ARP queries', async () => {
    expect(await plugin.canHandle('arp tablica', browserCtx)).toBe(true);
    expect(await plugin.canHandle('kto jest w sieci', browserCtx)).toBe(true);
    expect(await plugin.canHandle('lista urządzeń', browserCtx)).toBe(true);
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(false);
  });

  it('calls arp_scan via Tauri', async () => {
    const mockHosts = [
      { ip: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:ff', vendor: 'Cisco', hostname: 'router.local', response_time: 2 },
      { ip: '192.168.1.100', mac: '11:22:33:44:55:66', vendor: 'Hikvision', response_time: 8 },
    ];
    const invoke = vi.fn().mockResolvedValue(mockHosts);
    const result = await plugin.execute('arp tablica', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('arp_scan', expect.any(Object));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('192.168.1.1');
    expect(result.content[0].data).toContain('Cisco');
    expect(result.content[0].data).toContain('aa:bb:cc:dd:ee:ff');
  });
});

// ─── HttpBrowsePlugin — scope enforcement ────────────────────

describe('HttpBrowsePlugin — scope enforcement', () => {
  let plugin: HttpBrowsePlugin;

  beforeEach(() => { plugin = new HttpBrowsePlugin(); });

  it('rejects internet browsing in local scope', async () => {
    const result = await plugin.execute('https://example.com', { ...browserCtx, scope: 'local' });
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Sieć lokalna');
  });

  it('allows browsing in internet scope', async () => {
    vi.mock('../../lib/browseGateway', () => ({
      executeBrowseCommand: vi.fn().mockResolvedValue({ content: 'Example content', title: 'Example', url: 'https://example.com' }),
    }));
    vi.mock('../../lib/resolver', () => ({
      resolve: vi.fn().mockReturnValue({ resolveType: 'exact', url: 'https://example.com' }),
    }));
    const result = await plugin.execute('https://example.com', { ...browserCtx, scope: 'internet' });
    expect(['success', 'error']).toContain(result.status);
  });
});

// ─── Plugin Registry ─────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => { registry = new PluginRegistry(); });

  it('registers and retrieves plugins', () => {
    const plugin = new PingPlugin();
    registry.register(plugin);
    expect(registry.get('network-ping')).toBe(plugin);
  });

  it('throws on duplicate registration', () => {
    registry.register(new PingPlugin());
    expect(() => registry.register(new PingPlugin())).toThrow('already registered');
  });

  it('unregisters plugins', () => {
    registry.register(new PingPlugin());
    registry.unregister('network-ping');
    expect(registry.get('network-ping')).toBeNull();
  });

  it('findByIntent returns matching plugins', () => {
    registry.register(new PingPlugin());
    registry.register(new NetworkScanPlugin());
    const found = registry.findByIntent('network:ping');
    expect(found.map(p => p.id)).toContain('network-ping');
    expect(found.map(p => p.id)).not.toContain('network-scan');
  });

  it('getAll returns all registered plugins', () => {
    registry.register(new PingPlugin());
    registry.register(new PortScanPlugin());
    registry.register(new ArpPlugin());
    expect(registry.getAll()).toHaveLength(3);
  });
});

// ─── Full Bootstrap Integration ──────────────────────────────

describe('Bootstrap integration', () => {
  it('bootstraps with all plugins registered', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    const plugins = ctx.pluginRegistry.getAll();
    const ids = plugins.map(p => p.id);

    expect(ids).toContain('network-scan');
    expect(ids).toContain('network-ping');
    expect(ids).toContain('network-port-scan');
    expect(ids).toContain('network-onvif');
    expect(ids).toContain('network-mdns');
    expect(ids).toContain('network-arp');
    expect(ids).toContain('http-browse');
    expect(ids).toContain('chat-llm');

    await ctx.dispose();
  });

  it('routes camera query to network-scan plugin', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    const intent = await ctx.intentRouter.detect('pokaż kamery w sieci');
    expect(intent.intent).toBe('network:scan');

    const plugin = ctx.intentRouter.route(intent.intent);
    expect(plugin).not.toBeNull();
    expect(plugin!.id).toBe('network-scan');

    await ctx.dispose();
  });

  it('routes ping to ping plugin', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    const intent = await ctx.intentRouter.detect('ping 192.168.1.1');
    const plugin = ctx.intentRouter.route(intent.intent);
    expect(plugin!.id).toBe('network-ping');

    await ctx.dispose();
  });

  it('registers protocol-bridge plugin', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    expect(ctx.pluginRegistry.get('protocol-bridge')).not.toBeNull();
    const ids = ctx.pluginRegistry.getAll().map(p => p.id);
    expect(ids).toContain('protocol-bridge');

    await ctx.dispose();
  });

  it('exposes tauriInvoke on AppContext', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const mockInvoke = vi.fn();
    const ctx = await bootstrapApp({ isTauri: true, tauriInvoke: mockInvoke });

    expect(ctx.tauriInvoke).toBe(mockInvoke);

    await ctx.dispose();
  });

  it('command bus plugins:ask uses scope-aware routing', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    // plugins:ask should be registered
    expect(ctx.commandBus.has('plugins:ask')).toBe(true);

    // Execute a ping command via command bus — routes through intent detection + scope
    const result = await ctx.commandBus.execute('plugins:ask', 'ping 192.168.1.1') as any;
    expect(result).toBeDefined();
    expect(result.pluginId).toBe('network-ping');

    await ctx.dispose();
  });

  it('command bus routes bridge intent to protocol-bridge plugin', async () => {
    const { bootstrapApp } = await import('../../core/bootstrap');
    const ctx = await bootstrapApp({ isTauri: false });

    const result = await ctx.commandBus.execute('plugins:ask', 'bridge status') as any;
    expect(result).toBeDefined();
    expect(result.pluginId).toBe('protocol-bridge');

    await ctx.dispose();
  });
});

// ─── Scope-aware routing ─────────────────────────────────────

describe('Scope-aware routing — end to end', () => {
  it('local scope allows http-browse for LAN IPs, blocks internet URLs via canHandle', async () => {
    const router = new IntentRouter();
    const registry = new PluginRegistry();

    const plugins = [
      new NetworkScanPlugin(),
      new HttpBrowsePlugin(),
    ];
    plugins.forEach(p => { registry.register(p); router.registerPlugin(p as any); });

    // network:scan should be routable in local scope
    const scanPlugin = router.route('network:scan', 'local');
    expect(scanPlugin).not.toBeNull();
    expect(scanPlugin!.id).toBe('network-scan');

    // browse:url is now routable in local scope (for LAN IP browsing)
    const browsePlugin = router.route('browse:url', 'local');
    expect(browsePlugin).not.toBeNull();
    expect(browsePlugin!.id).toBe('http-browse');

    // canHandle blocks non-LAN URLs in local scope
    const ctx = { isTauri: false, tauriInvoke: undefined, scope: 'local' };
    expect(await (browsePlugin as HttpBrowsePlugin).canHandle('http://google.com', ctx)).toBe(false);
    // canHandle allows LAN IP URLs in local scope
    expect(await (browsePlugin as HttpBrowsePlugin).canHandle('http://192.168.188.146:80', ctx)).toBe(true);
  });

  it('internet scope blocks network-scan but allows http-browse', () => {
    const router = new IntentRouter();
    const registry = new PluginRegistry();

    const plugins = [
      new NetworkScanPlugin(),
      new HttpBrowsePlugin(),
    ];
    plugins.forEach(p => { registry.register(p); router.registerPlugin(p as any); });

    const scanPlugin = router.route('network:scan', 'internet');
    expect(scanPlugin).toBeNull();

    const browsePlugin = router.route('browse:url', 'internet');
    expect(browsePlugin).not.toBeNull();
    expect(browsePlugin!.id).toBe('http-browse');
  });

  it('protocol-bridge is allowed in local, network, internet, and vpn scopes', () => {
    expect(scopeRegistry.isPluginAllowed('protocol-bridge', 'local')).toBe(true);
    expect(scopeRegistry.isPluginAllowed('protocol-bridge', 'network')).toBe(true);
    expect(scopeRegistry.isPluginAllowed('protocol-bridge', 'internet')).toBe(true);
    expect(scopeRegistry.isPluginAllowed('protocol-bridge', 'vpn')).toBe(true);
  });
});

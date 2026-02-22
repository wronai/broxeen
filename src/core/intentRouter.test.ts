/**
 * Intent Router Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntentRouter } from './intentRouter';
import type { Plugin, PluginContext, PluginResult } from './types';

// Mock plugin for testing
class MockPlugin implements Plugin {
  readonly id: string;
  readonly name: string;
  readonly version = '1.0.0';
  readonly supportedIntents: string[];

  constructor(id: string, name: string, intents: string[]) {
    this.id = id;
    this.name = name;
    this.supportedIntents = intents;
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    return true;
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    return {
      status: 'success',
      content: [{ type: 'text', data: `Mock ${this.name} response` }],
    };
  }
}

describe('IntentRouter', () => {
  let router: IntentRouter;
  let mockPlugin1: MockPlugin;
  let mockPlugin2: MockPlugin;

  beforeEach(() => {
    router = new IntentRouter();
    mockPlugin1 = new MockPlugin('browse', 'Browse Plugin', ['browse:url', 'search:web']);
    mockPlugin2 = new MockPlugin('camera', 'Camera Plugin', ['camera:describe']);
  });

  it('should detect browse URL intent', async () => {
    const result = await router.detect('https://example.com');
    
    expect(result.intent).toBe('browse:url');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.url).toBe('https://example.com');
  });

  it('should detect browse domain intent', async () => {
    const result = await router.detect('www.onet.pl');
    
    expect(result.intent).toBe('browse:url');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.url).toBe('www.onet.pl');
  });

  it('should detect camera describe intent', async () => {
    const result = await router.detect('Co widać na kamerze wejściowej?');
    
    expect(result.intent).toBe('camera:describe');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.cameraId).toBe('cam-front');
  });

  it('should detect IoT read intent', async () => {
    const result = await router.detect('Jaka jest temperatura?');
    
    expect(result.intent).toBe('iot:read');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.sensorType).toBe('temperature');
  });

  it('should detect search intent', async () => {
    const result = await router.detect('Wyszukaj w internecie informacje o React');
    
    expect(result.intent).toBe('search:web');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should fallback to chat intent for unknown input', async () => {
    const result = await router.detect('random text that does not match anything');
    
    expect(result.intent).toBe('chat:ask');
    expect(result.confidence).toBe(0.5);
  });

  it('should route to correct plugin', () => {
    router.registerPlugin(mockPlugin1);
    router.registerPlugin(mockPlugin2);
    
    const browsePlugin = router.route('browse:url');
    const cameraPlugin = router.route('camera:describe');
    const nullPlugin = router.route('nonexistent:intent');
    
    expect(browsePlugin).toBe(mockPlugin1);
    expect(cameraPlugin).toBe(mockPlugin2);
    expect(nullPlugin).toBeNull();
  });

  it('should calculate confidence correctly', async () => {
    const highConfidence = await router.detect('https://www.example.com');
    const lowConfidence = await router.detect('random text');
    
    expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
  });

  it('should extract entities correctly', async () => {
    const urlResult = await router.detect('https://example.com');
    const cameraResult = await router.detect('Co widać na kamerze ogrod?');
    const iotResult = await router.detect('Jaka jest wilgotność?');
    
    expect(urlResult.entities.url).toBe('https://example.com');
    expect(cameraResult.entities.cameraId).toBe('cam-garden');
    expect(iotResult.entities.sensorType).toBe('humidity');
  });

  // ── Network plugin intents ──────────────────────────────

  it('should detect network:ping intent', async () => {
    const r1 = await router.detect('ping 192.168.1.1');
    expect(r1.intent).toBe('network:ping');
    expect(r1.entities.target).toBe('192.168.1.1');

    const r2 = await router.detect('sprawdź host router.local');
    expect(r2.intent).toBe('network:ping');
  });

  it('should detect network:port-scan intent', async () => {
    const r1 = await router.detect('skanuj porty 192.168.1.1');
    expect(r1.intent).toBe('network:port-scan');
    expect(r1.entities.target).toBe('192.168.1.1');

    const r2 = await router.detect('jakie porty ma serwer');
    expect(r2.intent).toBe('network:port-scan');
  });

  it('should detect network:arp intent', async () => {
    const r1 = await router.detect('tablica arp');
    expect(r1.intent).toBe('network:arp');

    const r2 = await router.detect('adresy mac urządzeń');
    expect(r2.intent).toBe('network:arp');
  });

  it('should detect network:wol intent', async () => {
    const r1 = await router.detect('wake on lan AA:BB:CC:DD:EE:FF');
    expect(r1.intent).toBe('network:wol');
    expect((r1.entities.mac as string).toUpperCase()).toBe('AA:BB:CC:DD:EE:FF');

    const r2 = await router.detect('obudź urządzenie');
    expect(r2.intent).toBe('network:wol');

    const r3 = await router.detect('włącz komputer');
    expect(r3.intent).toBe('network:wol');
  });

  it('should detect network:mdns intent', async () => {
    const r1 = await router.detect('mdns discovery');
    expect(r1.intent).toBe('network:mdns');

    const r2 = await router.detect('odkryj usługi bonjour');
    expect(r2.intent).toBe('network:mdns');
  });

  // ── Camera plugin intents ───────────────────────────────

  it('should detect camera:onvif intent', async () => {
    const r1 = await router.detect('onvif discover');
    expect(r1.intent).toBe('camera:onvif');

    const r2 = await router.detect('kamery ip');
    expect(r2.intent).toBe('camera:onvif');
  });

  it('should detect camera:health intent', async () => {
    const r1 = await router.detect('status kamery');
    expect(r1.intent).toBe('camera:health');

    const r2 = await router.detect('czy kamera działa');
    expect(r2.intent).toBe('camera:health');

    const r3 = await router.detect('sprawdź kamerę wejściową');
    expect(r3.intent).toBe('camera:health');
    expect(r3.entities.cameraId).toBe('cam-front');
  });

  it('should detect camera:ptz intent', async () => {
    const r1 = await router.detect('obróć kamerę w lewo');
    expect(r1.intent).toBe('camera:ptz');

    const r2 = await router.detect('zoom kamerę ogrodową');
    expect(r2.intent).toBe('camera:ptz');

    const r3 = await router.detect('ptz home');
    expect(r3.intent).toBe('camera:ptz');

    const r4 = await router.detect('przybliż obraz');
    expect(r4.intent).toBe('camera:ptz');
  });

  it('should detect camera:snapshot intent', async () => {
    const r1 = await router.detect('zrób zdjęcie kamerą');
    expect(r1.intent).toBe('camera:snapshot');

    const r2 = await router.detect('snapshot kamery ogrodowej');
    expect(r2.intent).toBe('camera:snapshot');
    expect(r2.entities.cameraId).toBe('cam-garden');

    const r3 = await router.detect('złap klatkę');
    expect(r3.intent).toBe('camera:snapshot');
  });

  // ── Marketplace intent ──────────────────────────────────

  it('should detect marketplace:browse intent', async () => {
    const r1 = await router.detect('marketplace');
    expect(r1.intent).toBe('marketplace:browse');

    const r2 = await router.detect('zainstaluj plugin UPnP');
    expect(r2.intent).toBe('marketplace:browse');

    const r3 = await router.detect('lista pluginów');
    expect(r3.intent).toBe('marketplace:browse');

    const r4 = await router.detect('odinstaluj plugin DNS');
    expect(r4.intent).toBe('marketplace:browse');
  });

  // ── Scope-aware routing ─────────────────────────────────

  it('should route all registered plugins correctly', () => {
    const plugins = [
      new MockPlugin('ping', 'Ping', ['network:ping']),
      new MockPlugin('portscan', 'Port Scan', ['network:port-scan']),
      new MockPlugin('arp', 'ARP', ['network:arp']),
      new MockPlugin('wol', 'WoL', ['network:wol']),
      new MockPlugin('mdns', 'mDNS', ['network:mdns']),
      new MockPlugin('onvif', 'ONVIF', ['camera:onvif']),
      new MockPlugin('cam-health', 'Cam Health', ['camera:health']),
      new MockPlugin('cam-ptz', 'Cam PTZ', ['camera:ptz']),
      new MockPlugin('cam-snap', 'Cam Snap', ['camera:snapshot']),
      new MockPlugin('marketplace', 'Marketplace', ['marketplace:browse']),
    ];

    for (const p of plugins) router.registerPlugin(p);

    expect(router.route('network:ping')?.id).toBe('ping');
    expect(router.route('network:port-scan')?.id).toBe('portscan');
    expect(router.route('network:arp')?.id).toBe('arp');
    expect(router.route('network:wol')?.id).toBe('wol');
    expect(router.route('network:mdns')?.id).toBe('mdns');
    expect(router.route('camera:onvif')?.id).toBe('onvif');
    expect(router.route('camera:health')?.id).toBe('cam-health');
    expect(router.route('camera:ptz')?.id).toBe('cam-ptz');
    expect(router.route('camera:snapshot')?.id).toBe('cam-snap');
    expect(router.route('marketplace:browse')?.id).toBe('marketplace');
  });
});

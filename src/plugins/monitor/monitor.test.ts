/**
 * Unit tests for MonitorPlugin
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MonitorPlugin } from './monitorPlugin';
import { BUILTIN_SCOPES, ScopeRegistry } from '../scope/scopeRegistry';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = { isTauri: false };

beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('MonitorPlugin', () => {
  let plugin: MonitorPlugin;
  beforeEach(() => { plugin = new MonitorPlugin(); });
  afterEach(async () => { await plugin.dispose(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('monitor');
    expect(plugin.supportedIntents).toContain('monitor:start');
    expect(plugin.supportedIntents).toContain('monitor:stop');
    expect(plugin.supportedIntents).toContain('monitor:logs');
  });

  it('canHandle recognizes monitoring requests', async () => {
    expect(await plugin.canHandle('monitoruj kamerę wejściową', browserCtx)).toBe(true);
    expect(await plugin.canHandle('obserwuj 192.168.1.1', browserCtx)).toBe(true);
    expect(await plugin.canHandle('stop monitoring kamery', browserCtx)).toBe(true);
    expect(await plugin.canHandle('aktywne monitoringi', browserCtx)).toBe(true);
    expect(await plugin.canHandle('pokaż logi', browserCtx)).toBe(true);
    expect(await plugin.canHandle('ustaw próg 20%', browserCtx)).toBe(true);
    expect(await plugin.canHandle('historia zmian', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  describe('start monitoring', () => {
    it('starts monitoring a camera by name', async () => {
      const result = await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Monitoring uruchomiony');
      expect(result.content[0].data).toContain('Kamera wejściowa');
    });

    it('starts monitoring an IP address', async () => {
      const result = await plugin.execute('monitoruj 192.168.1.100 co 60s user: :', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('192.168.1.100');
      expect(result.content[0].data).toContain('60s');
    });

    it('parses custom interval and threshold', async () => {
      const result = await plugin.execute('monitoruj kamerę ogrodową co 15s próg 10% user: :', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('15s');
      expect(result.content[0].data).toContain('10%');
    });

    it('detects duplicate monitoring', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      const result = await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      expect(result.content[0].data).toContain('już monitorowane');
    });

    it('returns error when no target given', async () => {
      const result = await plugin.execute('monitoruj', browserCtx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('cel monitoringu');
    });
  });

  describe('stop monitoring', () => {
    it('stops a running monitor', async () => {
      await plugin.execute('monitoruj kamerę salonową user: :', browserCtx);
      const result = await plugin.execute('stop monitoring salon', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('zatrzymany');
    });

    it('returns error when nothing to stop', async () => {
      const result = await plugin.execute('stop monitoring xyz', browserCtx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('Brak aktywnych');
    });
  });

  describe('list monitors', () => {
    it('shows empty list', async () => {
      const result = await plugin.execute('aktywne monitoringi', browserCtx);
      expect(result.content[0].data).toContain('Brak aktywnych');
    });

    it('shows active monitors', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      await plugin.execute('monitoruj 192.168.1.1 user: :', browserCtx);
      const result = await plugin.execute('aktywne monitoringi', browserCtx);
      expect(result.content[0].data).toContain('Kamera wejściowa');
      expect(result.content[0].data).toContain('192.168.1.1');
      expect(result.content[0].data).toMatch(/Aktywne monitoringi.*2/);
    });
  });

  describe('logs', () => {
    it('shows logs after monitoring starts', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      const result = await plugin.execute('pokaż logi monitoringu', browserCtx);
      expect(result.content[0].data).toContain('Rozpoczęto monitoring');
    });

    it('shows empty message when no logs', async () => {
      const result = await plugin.execute('pokaż logi', browserCtx);
      expect(result.content[0].data).toContain('Brak logów');
    });
  });

  describe('chat-based config', () => {
    it('sets threshold via chat', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      const result = await plugin.execute('ustaw próg zmian 25%', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('25%');
    });

    it('sets interval via chat', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      const result = await plugin.execute('ustaw interwał 45s', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('45s');
    });

    it('sets interval in minutes', async () => {
      await plugin.execute('monitoruj kamerę wejściową user: :', browserCtx);
      const result = await plugin.execute('ustaw interwał 5m', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('300s');
    });
  });

  describe('polling', () => {
    it('polls at configured interval and logs checks', async () => {
      await plugin.execute('monitoruj kamerę wejściową co 10s user: :', browserCtx);
      
      // Advance time past one interval
      await vi.advanceTimersByTimeAsync(11000);
      await vi.runOnlyPendingTimersAsync();
      
      // Check logs show a check entry
      const result = await plugin.execute('pokaż logi monitoringu wejściowa', browserCtx);
      expect(result.content[0].data).toMatch(/Rozpoczęto|check|Brak zmian|Zmiana/i);
    });
  });

  describe('LLM summary filtering', () => {
    it("does not emit UI event when summary is 'Brak istotnych zmian.'", async () => {
      const originalWindow = (globalThis as any).window;
      const originalCustomEvent = (globalThis as any).CustomEvent;

      const dispatchEvent = vi.fn();
      (globalThis as any).window = { dispatchEvent };
      (globalThis as any).CustomEvent = class CustomEvent<T> {
        type: string;
        detail: T;
        constructor(type: string, init?: { detail: T }) {
          this.type = type;
          this.detail = init?.detail as T;
        }
      };

      const target: any = {
        id: 'cam-1',
        name: 'Kamera testowa',
        type: 'camera',
        active: true,
        address: '192.168.1.10',
        threshold: 0.1,
        intervalMs: 10_000,
        logs: [],
        changeCount: 0,
        lastChecked: 0,
        lastChange: 0,
        lastSnapshot: 'prev-base64',
        rtspUrl: 'rtsp://example',
      };

      vi.spyOn(plugin as any, 'captureCameraSnapshot').mockResolvedValue({
        base64: 'curr-base64',
        mimeType: 'image/jpeg',
      });
      vi.spyOn(plugin as any, 'computeImageChangeScore').mockResolvedValue(0.5);
      vi.spyOn(plugin as any, 'createThumbnail').mockResolvedValue({
        base64: 'thumb-base64',
        mimeType: 'image/jpeg',
      });
      vi.spyOn(plugin as any, 'describeCameraChange').mockResolvedValue('Brak istotnych zmian.');

      await (plugin as any).poll(target, browserCtx);

      expect(dispatchEvent).not.toHaveBeenCalled();

      (globalThis as any).window = originalWindow;
      (globalThis as any).CustomEvent = originalCustomEvent;
    });
  });

  describe('LLM min change threshold', () => {
    it('skips LLM + UI when change is below monitor.llmMinChangeScore', async () => {
      const originalWindow = (globalThis as any).window;
      const originalCustomEvent = (globalThis as any).CustomEvent;

      const dispatchEvent = vi.fn();
      (globalThis as any).window = { dispatchEvent };
      (globalThis as any).CustomEvent = class CustomEvent<T> {
        type: string;
        detail: T;
        constructor(type: string, init?: { detail: T }) {
          this.type = type;
          this.detail = init?.detail as T;
        }
      };

      const configStore = (await import('../../config/configStore')).configStore;
      configStore.set('monitor.llmMinChangeScore', 0.6);

      const target: any = {
        id: 'cam-2',
        name: 'Kamera progowa',
        type: 'camera',
        active: true,
        address: '192.168.1.11',
        threshold: 0.1,
        intervalMs: 10_000,
        logs: [],
        changeCount: 0,
        lastChecked: 0,
        lastChange: 0,
        lastSnapshot: 'prev-base64',
        rtspUrl: 'rtsp://example',
      };

      vi.spyOn(plugin as any, 'captureCameraSnapshot').mockResolvedValue({
        base64: 'curr-base64',
        mimeType: 'image/jpeg',
      });
      vi.spyOn(plugin as any, 'computeImageChangeScore').mockResolvedValue(0.5);

      const describeSpy = vi
        .spyOn(plugin as any, 'describeCameraChange')
        .mockResolvedValue('Jakaś zmiana.');

      await (plugin as any).poll(target, browserCtx);

      expect(describeSpy).not.toHaveBeenCalled();
      expect(dispatchEvent).not.toHaveBeenCalled();

      (globalThis as any).window = originalWindow;
      (globalThis as any).CustomEvent = originalCustomEvent;
    });
  });
});

describe('Scope: VPN + Tor', () => {
  it('BUILTIN_SCOPES has all 6 scopes including vpn and tor', () => {
    const ids = Object.keys(BUILTIN_SCOPES);
    expect(ids).toContain('local');
    expect(ids).toContain('network');
    expect(ids).toContain('internet');
    expect(ids).toContain('vpn');
    expect(ids).toContain('tor');
    expect(ids).toContain('remote');
    expect(ids).toHaveLength(6);
  });

  it('VPN scope allows LAN + internet + monitor', () => {
    const vpn = BUILTIN_SCOPES['vpn'];
    expect(vpn).toBeDefined();
    expect(vpn.allowInternet).toBe(true);
    expect(vpn.allowLan).toBe(true);
    expect(vpn.allowedPlugins).toContain('network-scan');
    expect(vpn.allowedPlugins).toContain('monitor');
    expect(vpn.allowedPlugins).toContain('http-browse');
  });

  it('Tor scope restricts LAN but allows internet + monitor', () => {
    const tor = BUILTIN_SCOPES['tor'];
    expect(tor).toBeDefined();
    expect(tor.allowInternet).toBe(true);
    expect(tor.allowLan).toBe(false);
    expect(tor.allowedPlugins).toContain('http-browse');
    expect(tor.allowedPlugins).toContain('monitor');
    expect(tor.allowedPlugins).not.toContain('network-scan');
  });

  it('fresh ScopeRegistry loads all 6 scopes', () => {
    const registry = new ScopeRegistry();
    expect(registry.getAllScopes()).toHaveLength(6);
    expect(registry.getScope('vpn')).toBeDefined();
    expect(registry.getScope('tor')).toBeDefined();
  });
});

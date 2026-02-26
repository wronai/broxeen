/**
 * Unit tests for ToonicBridgePlugin
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ToonicBridgePlugin } from './toonicBridgePlugin';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = { isTauri: false };

const tauriCtx: PluginContext = {
  isTauri: true,
  tauriInvoke: vi.fn(),
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('ToonicBridgePlugin', () => {
  let plugin: ToonicBridgePlugin;
  beforeEach(() => { plugin = new ToonicBridgePlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('toonic-bridge');
    expect(plugin.supportedIntents).toContain('toonic:start');
    expect(plugin.supportedIntents).toContain('toonic:stop');
    expect(plugin.supportedIntents).toContain('toonic:status');
    expect(plugin.supportedIntents).toContain('toonic:watch');
  });

  describe('canHandle', () => {
    it('matches toonic commands', async () => {
      expect(await plugin.canHandle('toonic start', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic stop', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic status', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic watch rtsp://cam', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic events', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic sources', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic snapshot', browserCtx)).toBe(true);
      expect(await plugin.canHandle('toonic detect opisz co widzisz', browserCtx)).toBe(true);
    });

    it('matches Polish monitoring commands', async () => {
      expect(await plugin.canHandle('monitoruj stronę https://example.com', browserCtx)).toBe(true);
      expect(await plugin.canHandle('obserwuj pliki w katalogu', browserCtx)).toBe(true);
      expect(await plugin.canHandle('wykryj obiekt na kamerze', browserCtx)).toBe(true);
    });

    it('does not match unrelated commands', async () => {
      expect(await plugin.canHandle('skanuj sieć', browserCtx)).toBe(false);
      expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(false);
    });
  });

  describe('execute', () => {
    it('shows help for bare "toonic" command', async () => {
      const result = await plugin.execute('toonic', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Toonic Bridge');
      expect(result.content[0].data).toContain('toonic start');
    });

    it('returns error for toonic start in browser mode', async () => {
      const result = await plugin.execute('toonic start', browserCtx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('Tauri');
    });

    it('calls toonic_start in Tauri mode', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue({
          running: true,
          pid: 12345,
          port: 8900,
          url: 'http://127.0.0.1:8900',
          python: 'python3',
          toonic_path: '/home/user/toonic',
        }),
      } as any as PluginContext;

      const result = await plugin.execute('toonic start', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('uruchomiony');
      expect(ctx.tauriInvoke).toHaveBeenCalledWith('toonic_start', {});
    });

    it('calls toonic_stop in Tauri mode', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue('Toonic stopped (pid=123)'),
      } as any as PluginContext;

      const result = await plugin.execute('toonic stop', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('stopped');
      expect(ctx.tauriInvoke).toHaveBeenCalledWith('toonic_stop', {});
    });

    it('shows status in browser mode', async () => {
      const result = await plugin.execute('toonic status', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Tauri');
    });

    it('shows status in Tauri mode', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue({
          running: true,
          pid: 999,
          port: 8900,
          url: 'http://127.0.0.1:8900',
          python: 'python3',
          toonic_path: '/home/user/toonic',
        }),
      } as any as PluginContext;

      const result = await plugin.execute('toonic status', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('ONLINE');
    });

    it('returns error for watch without URL', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn(),
      } as any as PluginContext;

      const result = await plugin.execute('toonic watch', ctx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('URL');
    });

    it('calls proxy for watch with URL', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue(JSON.stringify({
          source_id: 'video:rtsp://cam',
          category: 'video',
          watcher_type: 'StreamWatcher',
          interval_s: 5,
        })),
      } as any as PluginContext;

      const result = await plugin.execute('toonic watch rtsp://admin:pass@192.168.1.100:554/stream', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Źródło dodane');
      expect(ctx.tauriInvoke).toHaveBeenCalledWith('toonic_proxy_post', expect.objectContaining({
        path: '/api/broxeen/watch',
      }));
    });

    it('shows sources', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue(JSON.stringify({
          sources: [
            { source_id: 'cam1', type: 'StreamWatcher', category: 'video', url: 'rtsp://cam1' },
          ],
        })),
      } as any as PluginContext;

      const result = await plugin.execute('toonic sources', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('cam1');
    });

    it('shows empty sources', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue(JSON.stringify({ sources: [] })),
      } as any as PluginContext;

      const result = await plugin.execute('toonic sources', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Brak aktywnych');
    });

    it('shows events', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockResolvedValue(JSON.stringify({
          events: [
            { type: 'trigger', timestamp: Date.now() / 1000, source_id: 'cam1', reason: 'person detected' },
          ],
          server_time: Date.now() / 1000,
        })),
      } as any as PluginContext;

      const result = await plugin.execute('toonic events', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Zdarzenia toonic');
    });

    it('handles errors gracefully', async () => {
      const ctx = {
        isTauri: true,
        tauriInvoke: vi.fn().mockRejectedValue(new Error('connection refused')),
      } as any as PluginContext;

      const result = await plugin.execute('toonic sources', ctx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('connection refused');
    });
  });
});

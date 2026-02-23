/**
 * Unit tests for MonitorPlugin
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MonitorPlugin } from './monitorPlugin';
import { BUILTIN_SCOPES, ScopeRegistry } from '../scope/scopeRegistry';
import type { PluginContext } from '../../core/types';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { ConfiguredDeviceRepository } from '../../persistence/configuredDeviceRepository';
import type { ConfiguredDevice } from '../../persistence/configuredDeviceRepository';
import { DatabaseManager } from '../../persistence/databaseManager';
import { InMemoryDbAdapter } from '../../persistence/databaseManager';
import { processRegistry } from '../../core/processRegistry';
import { configStore } from '../../config/configStore';

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

  describe('routing (canHandle)', () => {
    it('matches conflict resolution command: zachowaj monitoring <id>', async () => {
      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      const can = await plugin.canHandle('zachowaj monitoring cd_1771855535008_dddi9s', ctx);
      expect(can).toBe(true);
    });
  });

  describe('toggle monitoring (DB)', () => {
    it('disables monitoring in DB and stops active monitoring for that IP', async () => {
      processRegistry.clear();

      vi.spyOn(ConfiguredDeviceRepository.prototype, 'getByIp').mockResolvedValue({
        id: 'cd_t1',
        device_id: null,
        label: 'Kamera Toggle',
        ip: '192.168.1.77',
        device_type: 'camera',
        rtsp_url: null,
        http_url: null,
        username: null,
        password: null,
        stream_path: null,
        monitor_enabled: true,
        monitor_interval_ms: 2000,
        monitor_change_threshold: 0.15,
        last_snapshot_at: null,
        notes: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as any);

      const setSpy = vi
        .spyOn(ConfiguredDeviceRepository.prototype, 'setMonitorEnabled')
        .mockResolvedValue(undefined as any);

      const pollSpy = vi.spyOn(plugin as any, 'poll').mockResolvedValue(undefined);

      const ctx = {
        isTauri: false,
        databaseManager: { getDevicesDb: () => ({}) as any },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      // Start a monitor so we can verify it stops
      await plugin.execute('monitoruj 192.168.1.77 co 2s user: :', ctx);
      expect(processRegistry.listActive().some(p => p.id === 'monitor:camera-192.168.1.77')).toBe(true);

      const res = await plugin.execute('wyłącz monitoring 192.168.1.77', ctx);
      expect(res.status).toBe('success');
      expect(res.content[0].data).toContain('Wyłączono monitoring');
      expect(setSpy).toHaveBeenCalledWith('cd_t1', false);

      // ensure polling no longer runs
      await vi.advanceTimersByTimeAsync(2500);
      await vi.runOnlyPendingTimersAsync();
      expect(pollSpy).not.toHaveBeenCalled();
    });

    it('enables monitoring in DB and starts monitoring if not already running', async () => {
      processRegistry.clear();

      vi.spyOn(ConfiguredDeviceRepository.prototype, 'getById').mockResolvedValue({
        id: 'cd_t2',
        device_id: null,
        label: 'Kamera Enable',
        ip: '192.168.1.88',
        device_type: 'camera',
        rtsp_url: null,
        http_url: null,
        username: null,
        password: null,
        stream_path: null,
        monitor_enabled: false,
        monitor_interval_ms: 1000,
        monitor_change_threshold: 0.15,
        last_snapshot_at: null,
        notes: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as any);

      const setSpy = vi
        .spyOn(ConfiguredDeviceRepository.prototype, 'setMonitorEnabled')
        .mockResolvedValue(undefined as any);

      const pollSpy = vi.spyOn(plugin as any, 'poll').mockResolvedValue(undefined);

      const ctx = {
        isTauri: false,
        databaseManager: { getDevicesDb: () => ({}) as any },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      const res = await plugin.execute('włącz monitoring cd_t2', ctx);
      expect(res.status).toBe('success');
      expect(res.content[0].data).toContain('Włączono monitoring');
      expect(setSpy).toHaveBeenCalledWith('cd_t2', true);
      expect(processRegistry.listActive().some(p => p.id === 'monitor:camera-192.168.1.88')).toBe(true);

      await vi.advanceTimersByTimeAsync(1100);
      await vi.runOnlyPendingTimersAsync();
      expect(pollSpy).toHaveBeenCalled();
    });
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

    it('resolves Raspberry Pi target from persisted devices when user says "monitoruj rpi"', async () => {
      vi.spyOn(DeviceRepository.prototype, 'listDevices').mockResolvedValue([
        {
          id: 'rpi-1',
          ip: '192.168.50.10',
          hostname: 'raspberrypi',
          mac: 'AA:BB:CC:DD:EE:FF',
          vendor: 'Raspberry Pi',
          last_seen: Date.now(),
        },
      ]);

      const ctx = {
        isTauri: false,
        databaseManager: {
          isReady: () => true,
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      const result = await plugin.execute('monitoruj rpi co 60s', ctx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('192.168.50.10');
    });
  });

  describe('initialize: monitored devices from DB', () => {
    it('loads monitored configured_devices and schedules polling', async () => {
      processRegistry.clear();

      vi.spyOn(ConfiguredDeviceRepository.prototype, 'listMonitored').mockResolvedValue([
        {
          id: 'cd_1',
          device_id: null,
          label: 'Kamera DB',
          ip: '192.168.1.200',
          device_type: 'camera',
          rtsp_url: 'rtsp://192.168.1.200:554/stream',
          http_url: 'http://192.168.1.200/snap.jpg',
          username: 'admin',
          password: 'pass',
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 5_000,
          monitor_change_threshold: 0.12,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ] as any);

      const pollSpy = vi.spyOn(plugin as any, 'poll').mockResolvedValue(undefined);

      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      expect((plugin as any).targets?.has('camera-192.168.1.200')).toBe(true);
      expect(
        processRegistry
          .listActive()
          .some((p) => p.id === 'monitor:camera-192.168.1.200' || p.id === 'monitor:cd_1'),
      ).toBe(true);

      await vi.advanceTimersByTimeAsync(5_100);
      await vi.runOnlyPendingTimersAsync();

      expect(pollSpy).toHaveBeenCalled();
    });

    it('detects duplicate monitored rows for same IP and asks user to choose', async () => {
      processRegistry.clear();

      vi.spyOn(ConfiguredDeviceRepository.prototype, 'listMonitored').mockResolvedValue([
        {
          id: 'cd_a',
          device_id: null,
          label: 'Kamera A',
          ip: '192.168.1.50',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 2000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'cd_b',
          device_id: null,
          label: 'Kamera B',
          ip: '192.168.1.50',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 5000,
          monitor_change_threshold: 0.2,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ] as any);

      const pollSpy = vi.spyOn(plugin as any, 'poll').mockResolvedValue(undefined);

      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      // No monitor should be started automatically for this IP
      expect(processRegistry.listActive().some(p => p.id.includes('192.168.1.50'))).toBe(false);

      const list = await plugin.execute('aktywne monitoringi', ctx);
      expect(list.content[0].data).toContain('Wykryto duplikaty');
      expect(list.content[0].data).toContain('192.168.1.50');
      expect(list.content[0].data).toContain('zachowaj monitoring cd_a');
      expect(list.content[0].data).toContain('zachowaj monitoring cd_b');

      // Ensure no polling was scheduled
      await vi.advanceTimersByTimeAsync(6000);
      await vi.runOnlyPendingTimersAsync();
      expect(pollSpy).not.toHaveBeenCalled();
    });

    it('resolves DB duplicate conflict via chat command and starts monitoring for kept entry', async () => {
      processRegistry.clear();

      vi.spyOn(ConfiguredDeviceRepository.prototype, 'listMonitored').mockResolvedValue([
        {
          id: 'cd_a',
          device_id: null,
          label: 'Kamera A',
          ip: '192.168.1.50',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 2000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'cd_b',
          device_id: null,
          label: 'Kamera B',
          ip: '192.168.1.50',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 5000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ] as any);

      const setMonitorEnabledSpy = vi
        .spyOn(ConfiguredDeviceRepository.prototype, 'setMonitorEnabled')
        .mockResolvedValue(undefined as any);

      const pollSpy = vi.spyOn(plugin as any, 'poll').mockResolvedValue(undefined);

      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      const resolve = await plugin.execute('zachowaj monitoring cd_a', ctx);
      expect(resolve.status).toBe('success');
      expect(resolve.content[0].data).toContain('Zachowano wpis');
      expect(resolve.content[0].data).toContain('cd_a');

      // Should disable cd_b and ensure cd_a stays enabled
      expect(setMonitorEnabledSpy).toHaveBeenCalledWith('cd_b', false);
      expect(setMonitorEnabledSpy).toHaveBeenCalledWith('cd_a', true);

      expect(processRegistry.listActive().some(p => p.id === 'monitor:camera-192.168.1.50')).toBe(true);

      await vi.advanceTimersByTimeAsync(2100);
      await vi.runOnlyPendingTimersAsync();
      expect(pollSpy).toHaveBeenCalled();
    });

    it('does not re-trigger conflict after duplicates were disabled (only enabled rows count as conflict)', async () => {
      processRegistry.clear();

      // Simulate DB: 3 rows for same IP, but only one remains enabled after resolution.
      vi.spyOn(ConfiguredDeviceRepository.prototype, 'listByIp').mockResolvedValue([
        {
          id: 'cd_keep',
          device_id: null,
          label: 'Kamera KEEP',
          ip: '192.168.1.55',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: 2000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'cd_old1',
          device_id: null,
          label: 'Kamera OLD1',
          ip: '192.168.1.55',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: false,
          monitor_interval_ms: 2000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
        {
          id: 'cd_old2',
          device_id: null,
          label: 'Kamera OLD2',
          ip: '192.168.1.55',
          device_type: 'camera',
          rtsp_url: null,
          http_url: null,
          username: null,
          password: null,
          stream_path: null,
          monitor_enabled: false,
          monitor_interval_ms: 2000,
          monitor_change_threshold: 0.15,
          last_snapshot_at: null,
          notes: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ] as any);

      const saveSpy = vi
        .spyOn(ConfiguredDeviceRepository.prototype, 'save')
        .mockResolvedValue('cd_keep' as any);

      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => ({}) as any,
        },
      } as any as PluginContext;

      await plugin.initialize(ctx);

      const res = await plugin.execute('monitoruj 192.168.1.55 co 2s', ctx);
      expect(res.status).toBe('success');
      expect(res.content[0].data).toContain('Monitoring uruchomiony');
      // Should not show duplicate conflict prompt
      expect(res.content[0].data).not.toContain('Duplikaty');
      expect(saveSpy).toHaveBeenCalled();
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
      expect(result.status).toBe('success');
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

    it('updates running monitor threshold when monitor.defaultChangeThreshold changes in configStore', async () => {
      const ctx = { isTauri: false } as PluginContext;

      await plugin.initialize(ctx);
      await plugin.execute('monitoruj 192.168.1.123 co 2s user: :', ctx);

      // Change the global default threshold (0.05 = 5%)
      configStore.set('monitor.defaultChangeThreshold', 0.05);

      const list = await plugin.execute('aktywne monitoringi', ctx);
      expect(list.status).toBe('success');
      expect(list.content[0].data).toContain('**Próg:** 5%');

      // Prevent leaking config into other tests
      configStore.set('monitor.defaultChangeThreshold', 0.15);
    });

    it('sets threshold only for a selected monitor when using "dla" and persists to DB when configuredDeviceId exists', async () => {
      processRegistry.clear();

      const devicesDb = new InMemoryDbAdapter(':memory:');
      const ctx = {
        isTauri: false,
        databaseManager: {
          getDevicesDb: () => devicesDb,
        },
      } as any as PluginContext;

      // Avoid relying on migrations/schema; we only assert that repository setter is called.
      vi.spyOn(ConfiguredDeviceRepository.prototype, 'save').mockResolvedValue('cd_cam_1' as any);
      const setThresholdSpy = vi
        .spyOn(ConfiguredDeviceRepository.prototype, 'setMonitorChangeThreshold')
        .mockResolvedValue(undefined as any);

      await plugin.initialize(ctx);

      await plugin.execute('monitoruj 192.168.1.10 co 2s user: :', ctx);
      await plugin.execute('monitoruj 192.168.1.11 co 2s user: :', ctx);

      const res = await plugin.execute('ustaw próg zmian 5% dla 192.168.1.10', ctx);
      expect(res.status).toBe('success');

      const list = await plugin.execute('aktywne monitoringi', ctx);
      expect(list.content[0].data).toContain('192.168.1.10');
      expect(list.content[0].data).toContain('**Próg:** 5%');

      // Ensure only one persistence call (only the targeted monitor)
      expect(setThresholdSpy).toHaveBeenCalledTimes(1);
      expect(setThresholdSpy).toHaveBeenCalledWith('cd_cam_1', 0.05);
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
        capture: { method: 'http', frameBytes: 1024, captureMs: 50 },
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
        capture: { method: 'http', frameBytes: 1024, captureMs: 50 },
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

  describe('persistence and restore', () => {
    let plugin: MonitorPlugin;
    
    beforeEach(async () => { 
      plugin = new MonitorPlugin();
    });
    
    afterEach(async () => { 
      await plugin.dispose(); 
    });

    it('handles database errors gracefully during initialize', async () => {
      const ctx: PluginContext = {
        isTauri: false,
        databaseManager: {
          isReady: () => true,
          getDevicesDb: () => {
            throw new Error('Database connection failed');
          },
        },
      };

      // Should not throw, should handle error gracefully
      await expect(plugin.initialize(ctx)).resolves.not.toThrow();
      expect(plugin['targets'].size).toBe(0);
    });

    it('does not initialize when no database manager available', async () => {
      const ctx: PluginContext = {
        isTauri: false,
      };

      // Should not throw when no database manager
      await expect(plugin.initialize(ctx)).resolves.not.toThrow();
      expect(plugin['targets'].size).toBe(0);
    });
  });
});

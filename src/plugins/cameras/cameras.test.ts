/**
 * Unit tests for all Camera plugins
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CameraHealthPlugin } from './cameraHealthPlugin';
import { CameraPtzPlugin } from './cameraPtzPlugin';
import { CameraSnapshotPlugin } from './cameraSnapshotPlugin';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = { isTauri: false };
const tauriCtx: PluginContext = {
  isTauri: true,
  tauriInvoke: vi.fn(),
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── CameraHealthPlugin ──────────────────────────────────────

describe('CameraHealthPlugin', () => {
  let plugin: CameraHealthPlugin;
  beforeEach(() => { plugin = new CameraHealthPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('camera-health');
    expect(plugin.supportedIntents).toContain('camera:health');
    expect(plugin.supportedIntents).toContain('camera:status');
  });

  it('canHandle recognizes camera health requests', async () => {
    expect(await plugin.canHandle('status kamer', browserCtx)).toBe(true);
    expect(await plugin.canHandle('stan kamery ogrodowej', browserCtx)).toBe(true);
    expect(await plugin.canHandle('czy kamera działa', browserCtx)).toBe(true);
    expect(await plugin.canHandle('sprawdź kamerę wejściową', browserCtx)).toBe(true);
    expect(await plugin.canHandle('health camera', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns demo statuses in browser mode', async () => {
    const result = await plugin.execute('status kamer', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Stan kamer');
    expect(result.content[0].data).toContain('online');
    expect(result.content[0].data).toContain('offline');
    expect(result.metadata.deviceCount).toBe(3);
  });

  it('filters by camera name', async () => {
    const result = await plugin.execute('czy kamera wejściowa działa', browserCtx);
    expect(result.status).toBe('success');
    expect(result.metadata.deviceCount).toBe(1);
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const statuses = [{
      id: 'cam-1', name: 'Test Cam', ip: '10.0.0.1',
      online: true, latency_ms: 10, uptime: '1d',
    }];
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(statuses) };
    const result = await plugin.execute('status kamer', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('camera_health_check', { cameraId: null });
    expect(result.status).toBe('success');
    expect(result.metadata.deviceCount).toBe(1);
  });

  it('handles Tauri invoke failure', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockRejectedValue(new Error('no cams')) };
    const result = await plugin.execute('status kamer', ctx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('no cams');
  });
});

// ── CameraPtzPlugin ─────────────────────────────────────────

describe('CameraPtzPlugin', () => {
  let plugin: CameraPtzPlugin;
  beforeEach(() => { plugin = new CameraPtzPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('camera-ptz');
    expect(plugin.supportedIntents).toContain('camera:ptz');
    expect(plugin.supportedIntents).toContain('camera:move');
  });

  it('canHandle recognizes PTZ requests', async () => {
    expect(await plugin.canHandle('obróć kamerę w lewo', browserCtx)).toBe(true);
    expect(await plugin.canHandle('przybliż kamerę ogród', browserCtx)).toBe(true);
    expect(await plugin.canHandle('kamera salon w prawo', browserCtx)).toBe(true);
    expect(await plugin.canHandle('ptz home', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns demo PTZ result for left direction', async () => {
    const result = await plugin.execute('kamera salon w lewo', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('W lewo');
    expect(result.content[0].data).toContain('cam-salon');
  });

  it('recognizes zoom-in command', async () => {
    const result = await plugin.execute('przybliż kamerę ogród', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Przybliżenie');
    expect(result.content[0].data).toContain('cam-garden');
  });

  it('recognizes preset command', async () => {
    const result = await plugin.execute('preset 3 kamera wejście', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Preset');
  });

  it('returns error for unrecognized PTZ command', async () => {
    const result = await plugin.execute('random text about camera', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Nie rozpoznano');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(undefined) };
    const result = await plugin.execute('kamera w lewo', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('camera_ptz_move', expect.objectContaining({
      direction: 'left',
    }));
    expect(result.status).toBe('success');
  });

  it('handles Tauri invoke failure', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockRejectedValue(new Error('PTZ failed')) };
    const result = await plugin.execute('kamera w prawo', ctx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('PTZ failed');
  });
});

// ── CameraSnapshotPlugin ────────────────────────────────────

describe('CameraSnapshotPlugin', () => {
  let plugin: CameraSnapshotPlugin;
  beforeEach(() => { plugin = new CameraSnapshotPlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('camera-snapshot');
    expect(plugin.supportedIntents).toContain('camera:snapshot');
    expect(plugin.supportedIntents).toContain('camera:capture');
  });

  it('canHandle recognizes snapshot requests', async () => {
    expect(await plugin.canHandle('zrób zdjęcie kamerą', browserCtx)).toBe(true);
    expect(await plugin.canHandle('snapshot kamery ogrodowej', browserCtx)).toBe(true);
    expect(await plugin.canHandle('capture camera', browserCtx)).toBe(true);
    expect(await plugin.canHandle('złap klatkę', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  it('returns demo result in browser mode', async () => {
    const result = await plugin.execute('zrób zdjęcie kamerą wejściową', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Snapshot');
    expect(result.content[0].data).toContain('Kamera Wejście');
  });

  it('returns default camera label when no camera specified', async () => {
    const result = await plugin.execute('snapshot kamerą', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Domyślna kamera');
  });

  it('calls tauriInvoke in Tauri mode', async () => {
    const snapshot = { base64: 'abc123', width: 1920, height: 1080, cameraName: 'Cam 1', timestamp: Date.now() };
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockResolvedValue(snapshot) };
    const result = await plugin.execute('snapshot kamery', ctx);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('camera_snapshot', { cameraId: 'default' });
    expect(result.status).toBe('success');
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('image');
    expect(result.content[1].type).toBe('text');
  });

  it('handles Tauri invoke failure', async () => {
    const ctx = { ...tauriCtx, tauriInvoke: vi.fn().mockRejectedValue(new Error('cam offline')) };
    const result = await plugin.execute('snapshot kamery', ctx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('cam offline');
  });
});

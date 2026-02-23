import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MotionDetectionPlugin } from './motionDetectionPlugin';
import type { PluginContext } from '../../core/types';

const unlistenSpy = vi.fn();
const listenMock = vi.fn(async () => unlistenSpy);

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('../../config/configStore', () => ({
  configStore: {
    get: vi.fn((key: string) => {
      if (key === 'llm.apiKey') return 'test-key';
      return undefined;
    }),
    getAll: vi.fn(() => ({
      motionDetection: {
        pythonPath: 'python3',
        pipelinePath: 'scripts/motion_pipeline.py',
        processEveryNFrames: 5,
        minContourArea: 2000,
        maxContourArea: 200000,
        varThreshold: 50,
        bgHistory: 500,
        llmConfidenceThreshold: 0.6,
        cooldownSec: 10,
        maxCropPx: 500,
        detectionsDbPath: 'detections.db',
        llmVerifyModel: 'anthropic/claude-haiku-4-5',
        platform: 'auto',
        nightModePersonAlwaysLlm: true,
      },
    })),
  },
}));

const makeTauriCtx = (invokeImpl?: (cmd: string, args?: any) => Promise<any>): PluginContext => ({
  isTauri: true,
  tauriInvoke: vi.fn(invokeImpl ?? (async () => 'ok')) as any,
  cameras: [],
});

const makeBrowserCtx = (): PluginContext => ({
  isTauri: false,
  cameras: [],
});

describe('MotionDetectionPlugin', () => {
  let plugin: MotionDetectionPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    listenMock.mockImplementation(async () => unlistenSpy);
    plugin = new MotionDetectionPlugin();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── canHandle ──────────────────────────────────────────────────────────────

  it('canHandle: detekcja ruchu', async () => {
    expect(await plugin.canHandle('detekcja ruchu rtsp://cam', makeTauriCtx())).toBe(true);
  });

  it('canHandle: motion detect', async () => {
    expect(await plugin.canHandle('motion detect rtsp://cam', makeTauriCtx())).toBe(true);
  });

  it('canHandle: stop detekcji', async () => {
    expect(await plugin.canHandle('stop detekcji cam01', makeTauriCtx())).toBe(true);
  });

  it('canHandle: status detekcji ruchu', async () => {
    expect(await plugin.canHandle('status detekcji ruchu', makeTauriCtx())).toBe(true);
  });

  it('canHandle: statystyki detekcji', async () => {
    expect(await plugin.canHandle('statystyki detekcji cam01', makeTauriCtx())).toBe(true);
  });

  it('canHandle: wykrycia cam01', async () => {
    expect(await plugin.canHandle('wykrycia cam01', makeTauriCtx())).toBe(true);
  });

  it('canHandle: yolov8', async () => {
    expect(await plugin.canHandle('jak działa yolov8', makeTauriCtx())).toBe(true);
  });

  it('canHandle: unrelated query returns false', async () => {
    expect(await plugin.canHandle('jaka jest pogoda', makeTauriCtx())).toBe(false);
  });

  // ── Browser mode ───────────────────────────────────────────────────────────

  it('returns error in browser mode', async () => {
    const result = await plugin.execute('detekcja ruchu rtsp://cam', makeBrowserCtx());
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Tauri');
  });

  // ── Start pipeline ─────────────────────────────────────────────────────────

  it('start: calls motion_pipeline_start with correct args', async () => {
    const invoke = vi.fn(async () => 'ok');
    const ctx = makeTauriCtx(invoke);

    const result = await plugin.execute(
      'detekcja ruchu rtsp://admin:pass@192.168.1.100:554/stream cam01',
      ctx,
    );

    expect(invoke).toHaveBeenCalledWith(
      'motion_pipeline_start',
      expect.objectContaining({
        camera_id: 'cam01',
        rtsp_url: 'rtsp://admin:pass@192.168.1.100:554/stream',
        platform: 'auto',
        process_every: 5,
      }),
    );
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Pipeline detekcji ruchu uruchomiony');
  });

  it('start: extracts camera id from IP when no explicit id given', async () => {
    const invoke = vi.fn(async () => 'ok');
    const ctx = makeTauriCtx(invoke);

    await plugin.execute('detekcja ruchu rtsp://192.168.1.100:554/stream', ctx);

    expect(invoke).toHaveBeenCalledWith(
      'motion_pipeline_start',
      expect.objectContaining({
        camera_id: 'cam-192-168-1-100',
      }),
    );
  });

  it('start: returns error when no RTSP URL given', async () => {
    const result = await plugin.execute('detekcja ruchu', makeTauriCtx());
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('rtsp://');
  });

  it('start: returns error when pipeline_start throws', async () => {
    const invoke = vi.fn(async () => { throw new Error('python3 not found'); });
    const result = await plugin.execute(
      'detekcja ruchu rtsp://192.168.1.100:554/stream cam01',
      makeTauriCtx(invoke),
    );
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('python3 not found');
  });

  it('start: n5105 platform uses processEvery ≤ 3', async () => {
    const { configStore } = await import('../../config/configStore');
    vi.mocked(configStore.getAll).mockReturnValueOnce({
      motionDetection: {
        pythonPath: 'python3',
        pipelinePath: 'scripts/motion_pipeline.py',
        processEveryNFrames: 5,
        minContourArea: 2000,
        maxContourArea: 200000,
        varThreshold: 50,
        bgHistory: 500,
        llmConfidenceThreshold: 0.6,
        cooldownSec: 10,
        maxCropPx: 500,
        detectionsDbPath: 'detections.db',
        llmVerifyModel: 'anthropic/claude-haiku-4-5',
        platform: 'n5105',
        nightModePersonAlwaysLlm: true,
      },
    } as any);

    const invoke = vi.fn(async () => 'ok');
    await plugin.execute('detekcja ruchu rtsp://192.168.1.100:554/stream cam01', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith(
      'motion_pipeline_start',
      expect.objectContaining({ process_every: 3 }),
    );
  });

  // ── Stop pipeline ──────────────────────────────────────────────────────────

  it('stop: calls motion_pipeline_stop with camera_id', async () => {
    const invoke = vi.fn(async () => 'ok');
    const result = await plugin.execute('stop detekcji cam01', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('motion_pipeline_stop', { camera_id: 'cam01' });
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('cam01');
  });

  it('stop: returns error when no camera id given', async () => {
    const result = await plugin.execute('stop detekcji', makeTauriCtx());
    expect(result.status).toBe('error');
  });

  // ── Status ─────────────────────────────────────────────────────────────────

  it('status: shows empty state with config prompt when no pipelines', async () => {
    const invoke = vi.fn(async () => ({ pipelines: [], count: 0 }));
    const result = await plugin.execute('status detekcji ruchu', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('motion_pipeline_status');
    expect(result.status).toBe('success');
    expect(result.content.some(c => c.type === 'config_prompt')).toBe(true);
  });

  it('status: shows active pipelines', async () => {
    const invoke = vi.fn(async () => ({
      pipelines: [{ camera_id: 'cam01', rtsp_url: 'rtsp://x', started_at: Date.now() - 5000, running: true }],
      count: 1,
    }));
    const result = await plugin.execute('status detekcji ruchu', makeTauriCtx(invoke));

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('cam01');
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  it('stats: calls motion_pipeline_stats and formats output', async () => {
    const invoke = vi.fn(async () => ({
      total: 100,
      by_class: { person: 60, car: 30, dog: 10 },
      by_hour: { '08': 20, '12': 40 },
      unique_events_30s: 45,
      llm_sent: 15,
      llm_reduction_pct: 85.0,
    }));
    const result = await plugin.execute('statystyki detekcji cam01', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('motion_pipeline_stats', expect.objectContaining({
      camera_id: 'cam01',
    }));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('85');
    expect(result.content[0].data).toContain('person');
  });

  // ── Detections ─────────────────────────────────────────────────────────────

  it('detections: calls motion_pipeline_detections and formats rows', async () => {
    const invoke = vi.fn(async () => ([
      {
        id: 1, timestamp: '2024-01-01T10:00:00',
        camera_id: 'cam01', label: 'person', confidence: 0.85,
        llm_label: 'person', llm_description: 'A person walking',
        area: 5000, sent_to_llm: true,
      },
    ]));
    const result = await plugin.execute('wykrycia cam01', makeTauriCtx(invoke));

    expect(invoke).toHaveBeenCalledWith('motion_pipeline_detections', expect.objectContaining({
      camera_id: 'cam01',
    }));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('person');
    expect(result.content[0].data).toContain('A person walking');
  });

  it('detections: shows empty state when no rows', async () => {
    const invoke = vi.fn(async () => ([]));
    const result = await plugin.execute('wykrycia cam01', makeTauriCtx(invoke));
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak wykryć');
  });

  // ── Config ─────────────────────────────────────────────────────────────────

  it('config: returns config prompt with platform options', async () => {
    const result = await plugin.execute('konfiguruj detekcję ruchu', makeTauriCtx());
    expect(result.status).toBe('success');
    expect(result.content.some(c => c.type === 'config_prompt')).toBe(true);
    expect(result.content[0].data).toContain('RPi 5');
    expect(result.content[0].data).toContain('N5105');
  });

  // ── initialize / dispose ───────────────────────────────────────────────────

  it('initialize: registers tauri event listener', async () => {
    await plugin.initialize(makeTauriCtx());
    expect(listenMock).toHaveBeenCalledWith('broxeen:motion_event', expect.any(Function));
  });

  it('initialize: skips in browser mode', async () => {
    await plugin.initialize(makeBrowserCtx());
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('dispose: calls unlisten', async () => {
    await plugin.initialize(makeTauriCtx());
    await plugin.dispose();
    expect(unlistenSpy).toHaveBeenCalled();
  });
});

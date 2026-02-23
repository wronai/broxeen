import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrigateEventsPlugin } from './frigateEventsPlugin';
import type { PluginContext } from '../../core/types';
import * as llmClient from '../../lib/llmClient';

const tauriCtx = (overrides?: Partial<PluginContext>): PluginContext => ({
  isTauri: true,
  tauriInvoke: vi.fn(async () => 'ok') as any,
  ...overrides,
});

describe('FrigateEventsPlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters non-new events and does not call LLM', async () => {
    const plugin = new FrigateEventsPlugin();

    const describeSpy = vi.spyOn(llmClient, 'describeImageChange').mockResolvedValue('x');

    const emitSpy = vi.fn();
    (globalThis as any).window = { dispatchEvent: emitSpy };
    (globalThis as any).CustomEvent = class CustomEvent<T> {
      type: string;
      detail: T;
      constructor(type: string, init?: { detail: T }) {
        this.type = type;
        this.detail = init?.detail as T;
      }
    };

    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'update', after: { label: 'person', camera: 'front', id: '1' } }),
      timestamp: Date.now(),
    });

    expect(describeSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('applies cooldown per camera+label and emits only once', async () => {
    const plugin = new FrigateEventsPlugin();

    const describeSpy = vi.spyOn(llmClient, 'describeImageChange').mockResolvedValue('Ktoś wszedł.');

    // Mock snapshot fetch
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
    }));
    (globalThis as any).fetch = fetchSpy;

    // Mock FileReader to deterministic base64
    class MockFileReader {
      public result: string | ArrayBuffer | null = null;
      public onloadend: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      public error: any = null;
      readAsDataURL(_blob: Blob) {
        this.result = 'data:image/jpeg;base64,AAA=';
        this.onloadend?.();
      }
    }
    (globalThis as any).FileReader = MockFileReader as any;

    const emitSpy = vi.fn();
    (globalThis as any).window = { dispatchEvent: emitSpy };
    (globalThis as any).CustomEvent = class CustomEvent<T> {
      type: string;
      detail: T;
      constructor(type: string, init?: { detail: T }) {
        this.type = type;
        this.detail = init?.detail as T;
      }
    };

    // First event: stores snapshot but no previous -> no emit
    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'new', after: { label: 'person', camera: 'front', id: 'e1' } }),
      timestamp: Date.now(),
    });

    // Second event: within cooldown but now has previous snapshot -> should be blocked by cooldown
    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'new', after: { label: 'person', camera: 'front', id: 'e2' } }),
      timestamp: Date.now(),
    });

    expect(describeSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();

    // Force cooldown to pass by mutating internal map
    (plugin as any).lastAlertAtByKey.set('front:person', Date.now() - 999999);

    // Third event: should now call LLM and emit (previous snapshot exists)
    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'new', after: { label: 'person', camera: 'front', id: 'e3' } }),
      timestamp: Date.now(),
    });

    expect(describeSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('initialize starts mqtt in tauri via invoke', async () => {
    const plugin = new FrigateEventsPlugin();

    vi.mock('@tauri-apps/api/event', () => ({
      listen: vi.fn(async () => () => {}),
    }));

    const ctx = tauriCtx();
    await plugin.initialize(ctx);

    expect(ctx.tauriInvoke).toHaveBeenCalledWith('frigate_mqtt_start', expect.any(Object));
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FrigateEventsPlugin } from './frigateEventsPlugin';
import type { PluginContext } from '../../core/types';
import * as llmClient from '../../lib/llmClient';

const unlistenSpy = vi.fn();
const listenMock = vi.fn(async () => unlistenSpy);

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

const tauriCtx = (overrides?: Partial<PluginContext>): PluginContext => ({
  isTauri: true,
  tauriInvoke: vi.fn(async () => 'ok') as any,
  ...overrides,
});

describe('FrigateEventsPlugin', () => {
  let originalWindow: any;
  let originalCustomEvent: any;
  let originalFetch: any;
  let originalFileReader: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    unlistenSpy.mockClear();
    listenMock.mockImplementation(async () => unlistenSpy);

    originalWindow = (globalThis as any).window;
    originalCustomEvent = (globalThis as any).CustomEvent;
    originalFetch = (globalThis as any).fetch;
    originalFileReader = (globalThis as any).FileReader;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
    (globalThis as any).fetch = originalFetch;
    (globalThis as any).FileReader = originalFileReader;
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

  it('deduplicates by event id (LLM once per incident id)', async () => {
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

    // Second event: same incident id -> should be ignored (no fetch, no LLM)
    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'new', after: { label: 'person', camera: 'front', id: 'e1' } }),
      timestamp: Date.now(),
    });

    expect(describeSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();

    // Third event: new incident id -> should now call LLM and emit (previous snapshot exists)
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

    const ctx = tauriCtx();
    await plugin.initialize(ctx);

    expect(ctx.tauriInvoke).toHaveBeenCalledWith('frigate_mqtt_start', expect.any(Object));
  });

  it('dispose stops mqtt when started', async () => {
    const plugin = new FrigateEventsPlugin();

    const ctx = tauriCtx();
    await plugin.initialize(ctx);

    await plugin.dispose();

    expect(unlistenSpy).toHaveBeenCalledTimes(1);
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('frigate_mqtt_stop');
  });

  it('execute returns status when no start/stop keyword', async () => {
    const plugin = new FrigateEventsPlugin();
    const ctx = tauriCtx();
    const result = await plugin.execute('frigate status', ctx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Frigate Events');
    expect(result.content[0].data).toContain('stopped');
  });

  it('execute start calls initialize and returns success', async () => {
    const plugin = new FrigateEventsPlugin();
    const ctx = tauriCtx();
    const result = await plugin.execute('frigate start', ctx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Uruchomiono');
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('frigate_mqtt_start', expect.any(Object));
  });

  it('execute stop calls frigate_mqtt_stop and returns success', async () => {
    const plugin = new FrigateEventsPlugin();
    const ctx = tauriCtx();
    const result = await plugin.execute('frigate stop', ctx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Zatrzymano');
    expect(ctx.tauriInvoke).toHaveBeenCalledWith('frigate_mqtt_stop');
  });

  it('execute returns error in non-tauri context', async () => {
    const plugin = new FrigateEventsPlugin();
    const ctx: PluginContext = { isTauri: false };
    const result = await plugin.execute('frigate status', ctx);
    expect(result.status).toBe('error');
  });

  it('end event clears active key and does not emit', async () => {
    const plugin = new FrigateEventsPlugin();

    const emitSpy = vi.fn();
    (globalThis as any).window = { dispatchEvent: emitSpy };
    (globalThis as any).CustomEvent = class CustomEvent<T> {
      type: string; detail: T;
      constructor(type: string, init?: { detail: T }) { this.type = type; this.detail = init?.detail as T; }
    };

    // Manually set active event
    (plugin as any).activeEventIdByKey.set('front:person', 'e1');
    (plugin as any).processedEventIds.add('e1');

    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'end', after: { label: 'person', camera: 'front', id: 'e1' } }),
      timestamp: Date.now(),
    });

    expect((plugin as any).activeEventIdByKey.has('front:person')).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('uses cooldown fallback when event has no id', async () => {
    const plugin = new FrigateEventsPlugin();

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
    }));
    (globalThis as any).fetch = fetchSpy;

    class MockFileReader {
      result: string | null = null;
      onloadend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error: any = null;
      readAsDataURL(_blob: Blob) { this.result = 'data:image/jpeg;base64,AAA='; this.onloadend?.(); }
    }
    (globalThis as any).FileReader = MockFileReader as any;

    const emitSpy = vi.fn();
    (globalThis as any).window = { dispatchEvent: emitSpy };
    (globalThis as any).CustomEvent = class CustomEvent<T> {
      type: string; detail: T;
      constructor(type: string, init?: { detail: T }) { this.type = type; this.detail = init?.detail as T; }
    };

    const payload = JSON.stringify({ type: 'new', after: { label: 'person', camera: 'back' } });

    // First call: stores snapshot, no previous → no emit
    await (plugin as any).handleMqttEvent({ topic: 'frigate/events', payload, timestamp: Date.now() });
    expect(emitSpy).not.toHaveBeenCalled();

    // Second call immediately: within cooldown → blocked
    await (plugin as any).handleMqttEvent({ topic: 'frigate/events', payload, timestamp: Date.now() });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // second call blocked before fetch
  });

  it('no snapshot → no LLM and no emit', async () => {
    const plugin = new FrigateEventsPlugin();

    const fetchSpy = vi.fn(async () => ({ ok: false, blob: async () => new Blob() }));
    (globalThis as any).fetch = fetchSpy;

    const describeSpy = vi.spyOn(llmClient, 'describeImageChange').mockResolvedValue('x');
    const emitSpy = vi.fn();
    (globalThis as any).window = { dispatchEvent: emitSpy };
    (globalThis as any).CustomEvent = class CustomEvent<T> {
      type: string; detail: T;
      constructor(type: string, init?: { detail: T }) { this.type = type; this.detail = init?.detail as T; }
    };

    await (plugin as any).handleMqttEvent({
      topic: 'frigate/events',
      payload: JSON.stringify({ type: 'new', after: { label: 'person', camera: 'side', id: 'ev99' } }),
      timestamp: Date.now(),
    });

    expect(describeSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertBridge } from './alertBridge';
import { EventStore } from '../domain/eventStore';
import type { WatchManager } from './watchManager';
import type { ChangeDetectedEvent, WatchManagerEvent } from './types';

function makeStore(): EventStore {
  return new EventStore();
}

function captureMessages(store: EventStore) {
  const messages: any[] = [];
  store.on('message_added', (e) => messages.push(e.payload));
  return messages;
}

describe('AlertBridge', () => {
  let store: EventStore;
  let bridge: AlertBridge;

  beforeEach(() => {
    store = makeStore();
    bridge = new AlertBridge(store, { dedupeWindowMs: 0 });
  });

  // ── WatchManager integration ───────────────────────────────────────────────

  it('injects assistant message on change_detected event', () => {
    const messages = captureMessages(store);

    const listeners: Array<(e: WatchManagerEvent) => void> = [];
    const mockWm = {
      addEventListener: vi.fn((cb) => listeners.push(cb)),
      removeEventListener: vi.fn(),
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);

    const changeEvent: ChangeDetectedEvent = {
      id: 'evt-1',
      watchRuleId: 'rule-1',
      targetId: '192.168.1.100',
      targetType: 'device',
      changeType: 'content',
      changeScore: 0.8,
      currentContent: 'new content here',
      detectedAt: new Date(),
      summary: 'Strona zmieniła się o 80%',
    };

    listeners[0]!({ type: 'change_detected', timestamp: new Date(), data: changeEvent });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].text).toContain('192.168.1.100');
    expect(messages[0].text).toContain('80%');
    expect(messages[0].text).toContain('Strona zmieniła się');
  });

  it('ignores non-change_detected events', () => {
    const messages = captureMessages(store);

    const listeners: Array<(e: WatchManagerEvent) => void> = [];
    const mockWm = {
      addEventListener: vi.fn((cb) => listeners.push(cb)),
      removeEventListener: vi.fn(),
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);
    listeners[0]!({ type: 'watch_started', timestamp: new Date(), data: {} });

    expect(messages).toHaveLength(0);
  });

  it('detachWatchManager calls removeEventListener', () => {
    const removeListener = vi.fn();
    const mockWm = {
      addEventListener: vi.fn(),
      removeEventListener: removeListener,
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);
    bridge.detachWatchManager();

    expect(removeListener).toHaveBeenCalled();
  });

  it('replaces previous WatchManager on re-attach', () => {
    const remove1 = vi.fn();
    const wm1 = { addEventListener: vi.fn(), removeEventListener: remove1 } as unknown as WatchManager;
    const wm2 = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as WatchManager;

    bridge.attachWatchManager(wm1);
    bridge.attachWatchManager(wm2);

    expect(remove1).toHaveBeenCalled();
  });

  // ── Device status alerts ───────────────────────────────────────────────────

  it('injects message on device going offline', () => {
    const messages = captureMessages(store);

    bridge.notifyDeviceStatusChange({
      ip: '192.168.1.50',
      deviceType: 'camera',
      previousStatus: 'online',
      currentStatus: 'offline',
      detectedAt: new Date(),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].text).toContain('192.168.1.50');
    expect(messages[0].text).toContain('OFFLINE');
    expect(messages[0].text).toContain('ping');
  });

  it('injects message on device coming online', () => {
    const messages = captureMessages(store);

    bridge.notifyDeviceStatusChange({
      ip: '192.168.1.50',
      hostname: 'cam-front',
      previousStatus: 'offline',
      currentStatus: 'online',
      detectedAt: new Date(),
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('ONLINE');
    expect(messages[0].text).toContain('cam-front');
  });

  it('deduplicates device status alerts within window', () => {
    const bridgeWithDedupe = new AlertBridge(store, { dedupeWindowMs: 60_000 });
    const messages = captureMessages(store);

    const change = {
      ip: '192.168.1.50',
      previousStatus: 'online' as const,
      currentStatus: 'offline' as const,
      detectedAt: new Date(),
    };

    bridgeWithDedupe.notifyDeviceStatusChange(change);
    bridgeWithDedupe.notifyDeviceStatusChange(change);

    expect(messages).toHaveLength(1);
    bridgeWithDedupe.dispose();
  });

  // ── Motion detection alerts ────────────────────────────────────────────────

  it('injects message on motion detection', () => {
    const messages = captureMessages(store);

    bridge.notifyMotionDetection('cam01', 'person', 0.45, 'person');

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('cam01');
    expect(messages[0].text).toContain('person');
    expect(messages[0].text).toContain('45%');
  });

  it('deduplicates motion alerts within window', () => {
    const bridgeWithDedupe = new AlertBridge(store, { dedupeWindowMs: 60_000 });
    const messages = captureMessages(store);

    bridgeWithDedupe.notifyMotionDetection('cam01', 'car', 0.9);
    bridgeWithDedupe.notifyMotionDetection('cam01', 'car', 0.9);

    expect(messages).toHaveLength(1);
    bridgeWithDedupe.dispose();
  });

  it('allows different labels without deduplication', () => {
    const bridgeWithDedupe = new AlertBridge(store, { dedupeWindowMs: 60_000 });
    const messages = captureMessages(store);

    bridgeWithDedupe.notifyMotionDetection('cam01', 'car', 0.9);
    bridgeWithDedupe.notifyMotionDetection('cam01', 'person', 0.9);

    expect(messages).toHaveLength(2);
    bridgeWithDedupe.dispose();
  });

  // ── Throttling ─────────────────────────────────────────────────────────────

  it('throttles when maxAlertsPerMinute exceeded', () => {
    const throttledBridge = new AlertBridge(store, {
      dedupeWindowMs: 0,
      maxAlertsPerMinute: 3,
    });
    const messages = captureMessages(store);

    for (let i = 0; i < 10; i++) {
      throttledBridge.notifyDeviceStatusChange({
        ip: `192.168.1.${i}`,
        previousStatus: 'online',
        currentStatus: 'offline',
        detectedAt: new Date(),
      });
    }

    expect(messages.length).toBeLessThanOrEqual(3);
    throttledBridge.dispose();
  });

  // ── Severity ───────────────────────────────────────────────────────────────

  it('includes 🚨 icon for high-score changes', () => {
    const messages = captureMessages(store);

    const listeners: Array<(e: WatchManagerEvent) => void> = [];
    const mockWm = {
      addEventListener: vi.fn((cb) => listeners.push(cb)),
      removeEventListener: vi.fn(),
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);
    listeners[0]!({
      type: 'change_detected',
      timestamp: new Date(),
      data: {
        id: 'e2', watchRuleId: 'r2', targetId: 'host', targetType: 'device',
        changeType: 'content', changeScore: 0.95,
        detectedAt: new Date(), summary: 'Major change',
      } as ChangeDetectedEvent,
    });

    expect(messages[0].text).toContain('🚨');
  });

  it('includes ⚠️ icon for medium-score changes', () => {
    const messages = captureMessages(store);

    const listeners: Array<(e: WatchManagerEvent) => void> = [];
    const mockWm = {
      addEventListener: vi.fn((cb) => listeners.push(cb)),
      removeEventListener: vi.fn(),
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);
    listeners[0]!({
      type: 'change_detected',
      timestamp: new Date(),
      data: {
        id: 'e3', watchRuleId: 'r3', targetId: 'host', targetType: 'service',
        changeType: 'status', changeScore: 0.55,
        detectedAt: new Date(), summary: 'Medium change',
      } as ChangeDetectedEvent,
    });

    expect(messages[0].text).toContain('⚠️');
  });

  // ── Dispose ────────────────────────────────────────────────────────────────

  it('dispose detaches WatchManager and clears state', () => {
    const removeListener = vi.fn();
    const mockWm = {
      addEventListener: vi.fn(),
      removeEventListener: removeListener,
    } as unknown as WatchManager;

    bridge.attachWatchManager(mockWm);
    bridge.dispose();

    expect(removeListener).toHaveBeenCalled();
  });
});

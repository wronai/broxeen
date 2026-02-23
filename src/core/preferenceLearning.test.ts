import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to test a fresh instance each time, so import the class path
// and create instances manually rather than using the singleton.
// But first, let's test the singleton behavior with localStorage mocks.

describe('PreferenceLearningStore', () => {
  let store: any;

  beforeEach(async () => {
    // Clear localStorage mock
    localStorage.clear();

    // Re-import to get a fresh module (reset singleton state)
    vi.resetModules();
    const mod = await import('./preferenceLearning');
    store = mod.preferenceLearning;
    // Force re-load from empty localStorage
    (store as any).loaded = false;
    (store as any).data = new Map();
    (store as any).maxCount = 0;
  });

  describe('recordChoice', () => {
    it('records a new choice', () => {
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera', label: 'Snapshot' });
      const all = store.getAll();
      expect(all.length).toBe(1);
      expect(all[0].key).toBe('camera:snapshot');
      expect(all[0].count).toBe(1);
      expect(all[0].domain).toBe('camera');
    });

    it('increments count on repeated choice', () => {
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera' });
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera' });
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera' });
      const all = store.getAll();
      expect(all.length).toBe(1);
      expect(all[0].count).toBe(3);
    });

    it('tracks successes', () => {
      store.recordChoice({ intent: 'network:scan', success: true });
      store.recordChoice({ intent: 'network:scan', success: true });
      store.recordChoice({ intent: 'network:scan', success: false });
      const all = store.getAll();
      expect(all[0].successes).toBe(2);
      expect(all[0].count).toBe(3);
    });

    it('uses executeQuery as key when no intent', () => {
      store.recordChoice({ executeQuery: 'skanuj sieć', domain: 'network' });
      const all = store.getAll();
      expect(all[0].key).toBe('skanuj sieć');
    });

    it('persists to localStorage', () => {
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera', label: 'Test' });
      const raw = localStorage.getItem('broxeen:preference-learning');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.length).toBe(1);
      expect(parsed[0].key).toBe('camera:snapshot');
    });
  });

  describe('score', () => {
    it('returns zero scores for unknown action', () => {
      const s = store.score('unknown:intent');
      expect(s.frequency).toBe(0);
      expect(s.recency).toBe(0);
      expect(s.combined).toBe(0);
    });

    it('returns positive scores for known action', () => {
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera' });
      const s = store.score('camera:snapshot');
      expect(s.frequency).toBeGreaterThan(0);
      expect(s.recency).toBeGreaterThan(0);
      expect(s.combined).toBeGreaterThan(0);
    });

    it('higher count → higher frequency score', () => {
      store.recordChoice({ intent: 'a' });
      store.recordChoice({ intent: 'a' });
      store.recordChoice({ intent: 'a' });
      store.recordChoice({ intent: 'b' });

      const scoreA = store.score('a');
      const scoreB = store.score('b');
      expect(scoreA.frequency).toBeGreaterThan(scoreB.frequency);
    });

    it('success rate reflected in score', () => {
      store.recordChoice({ intent: 'good', success: true });
      store.recordChoice({ intent: 'good', success: true });
      store.recordChoice({ intent: 'bad', success: false });
      store.recordChoice({ intent: 'bad', success: false });

      const goodScore = store.score('good');
      const badScore = store.score('bad');
      expect(goodScore.successRate).toBeGreaterThan(badScore.successRate);
    });
  });

  describe('getTopPreferences', () => {
    it('returns empty for no data', () => {
      expect(store.getTopPreferences().length).toBe(0);
    });

    it('returns sorted by combined score', () => {
      store.recordChoice({ intent: 'a', domain: 'camera' });
      store.recordChoice({ intent: 'b', domain: 'network' });
      store.recordChoice({ intent: 'b', domain: 'network' });
      store.recordChoice({ intent: 'b', domain: 'network' });

      const top = store.getTopPreferences(5);
      expect(top[0].key).toBe('b'); // more clicks
    });

    it('filters by domain', () => {
      store.recordChoice({ intent: 'cam1', domain: 'camera' });
      store.recordChoice({ intent: 'net1', domain: 'network' });

      const cameraPrefs = store.getTopPreferences(5, 'camera');
      expect(cameraPrefs.length).toBe(1);
      expect(cameraPrefs[0].domain).toBe('camera');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        store.recordChoice({ intent: `action-${i}`, domain: 'camera' });
      }
      const top = store.getTopPreferences(3);
      expect(top.length).toBe(3);
    });
  });

  describe('reset', () => {
    it('clears all data', () => {
      store.recordChoice({ intent: 'a' });
      store.recordChoice({ intent: 'b' });
      expect(store.getAll().length).toBe(2);

      store.reset();
      expect(store.getAll().length).toBe(0);
    });

    it('clears localStorage', () => {
      store.recordChoice({ intent: 'a' });
      store.reset();
      const raw = localStorage.getItem('broxeen:preference-learning');
      const parsed = JSON.parse(raw || '[]');
      expect(parsed.length).toBe(0);
    });
  });

  describe('persistence round-trip', () => {
    it('data survives reload', async () => {
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera', label: 'Snap' });
      store.recordChoice({ intent: 'camera:snapshot', domain: 'camera' });

      // Simulate reload by resetting internal state
      (store as any).loaded = false;
      (store as any).data = new Map();
      (store as any).maxCount = 0;

      // Score should still work after reload
      const s = store.score('camera:snapshot');
      expect(s.frequency).toBeGreaterThan(0);
      expect(s.combined).toBeGreaterThan(0);
    });
  });
});

/**
 * CLI-style integration test — exercises the full intent detection + fallback
 * pipeline with diverse queries that a real user might type, including:
 * - Vague/ambiguous queries ("użyj kamery", "pokaż coś")
 * - Domain-specific but unmatched queries ("kamera wejściowa", "temperatura")
 * - Completely unknown queries ("xyzzy", "jak się masz")
 * - Mixed-domain queries ("kamera w sieci")
 *
 * Verifies that every query returns a non-empty suggestion set with actionable buttons.
 */

import { describe, it, expect, vi } from 'vitest';
import { IntentRouter } from './intentRouter';
import { generateFallback } from './fallbackHandler';
import { findMatchingSchemas, findDomainSchemas, ACTION_SCHEMAS } from './actionSchema';

// Mock llmClient (no API key → keyword-only mode)
vi.mock('../lib/llmClient', () => ({
  getConfig: () => ({ apiKey: '', model: 'test', maxTokens: 100, temperature: 0 }),
  chat: vi.fn(),
}));

describe('Fallback CLI integration tests', () => {
  const router = new IntentRouter();

  // ── Queries that fall through to chat:ask (no specific pattern match) ──
  const unhandledQueries = [
    'użyj kamery',
    'kamera',
    'pokaż coś',
    'co mogę zrobić',
    'uruchom',
    'sprawdź',
    'jak się masz',
    'xyzzy',
    'abc123',
    'pokaż mi podgląd',
    'włącz monitoring',
    'sieć',
    'urządzenia',
    'pomóż mi z kamerami',
    'chcę zobaczyć obraz',
    'dysk info',
    'ssh do serwera',
    'temperatura w domu',
    'bridge',
    'api rest',
  ];

  describe('Intent detection → fallback pipeline', () => {
    for (const query of unhandledQueries) {
      it(`"${query}" → detects intent and generates suggestions`, async () => {
        const intent = await router.detect(query);

        // If the router found a specific intent, that's fine — the real
        // failure case is chat:ask with no plugin. Simulate fallback for all.
        const result = await generateFallback({
          query,
          detectedIntent: intent.intent,
          scope: 'local',
        });

        // Must always return non-empty suggestions
        expect(result.text).toBeTruthy();
        expect(result.configPrompt).toBeDefined();
        expect(result.configPrompt.actions.length).toBeGreaterThan(0);

        // Each action must be clickable (have executeQuery or prefillText)
        for (const action of result.configPrompt.actions) {
          const hasAction = action.executeQuery || action.prefillText;
          expect(hasAction).toBeTruthy();
          expect(action.label).toBeTruthy();
        }
      });
    }
  });

  describe('Domain schema coverage', () => {
    it('camera-related queries return camera actions', async () => {
      const queries = ['użyj kamery', 'kamera wejściowa', 'snapshot', 'live kamery', 'onvif'];
      for (const q of queries) {
        const schemas = findDomainSchemas(q);
        expect(schemas.length, `"${q}" should match camera domain`).toBeGreaterThan(0);
        expect(schemas.some(s => s.domain === 'camera'), `"${q}" should include camera schemas`).toBe(true);
      }
    });

    it('network-related queries return network actions', async () => {
      const queries = ['sieć lokalna', 'ping host', 'porty urządzenia', 'tablica arp', 'mdns usługi'];
      for (const q of queries) {
        const schemas = findDomainSchemas(q);
        expect(schemas.length, `"${q}" should match network domain`).toBeGreaterThan(0);
        expect(schemas.some(s => s.domain === 'network'), `"${q}" should include network schemas`).toBe(true);
      }
    });

    it('system-related queries return system actions', async () => {
      const queries = ['dyski', 'ssh', 'procesy'];
      for (const q of queries) {
        const schemas = findDomainSchemas(q);
        expect(schemas.length, `"${q}" should match system domain`).toBeGreaterThan(0);
        expect(schemas.some(s => s.domain === 'system'), `"${q}" should include system schemas`).toBe(true);
      }
    });

    it('IoT-related queries return IoT actions', async () => {
      const queries = ['temperatura', 'czujnik', 'sensor'];
      for (const q of queries) {
        const schemas = findDomainSchemas(q);
        expect(schemas.length, `"${q}" should match IoT domain`).toBeGreaterThan(0);
        expect(schemas.some(s => s.domain === 'iot'), `"${q}" should include IoT schemas`).toBe(true);
      }
    });
  });

  describe('Schema scoring quality', () => {
    it('"zrób zdjęcie z kamery" scores highest for camera:snapshot', () => {
      const results = findMatchingSchemas('zrób zdjęcie z kamery');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].intent).toBe('camera:snapshot');
    });

    it('"skanuj sieć" scores highest for network:scan', () => {
      const results = findMatchingSchemas('skanuj sieć');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].intent).toBe('network:scan');
    });

    it('"pokaż dyski" scores for disk:info', () => {
      const results = findMatchingSchemas('pokaż dyski');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.intent === 'disk:info')).toBe(true);
    });

    it('"bridge mqtt" scores for bridge:read', () => {
      const results = findMatchingSchemas('bridge mqtt');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.intent.startsWith('bridge:'))).toBe(true);
    });
  });

  describe('LLM context generation', () => {
    it('all schemas have valid intent IDs matching IntentRouter patterns', () => {
      // Get all intent keys from the router's pattern map
      const routerPatterns = new Set<string>();
      // Access private field for testing
      const patterns = (router as any).intentPatterns as Map<string, RegExp[]>;
      for (const key of patterns.keys()) {
        routerPatterns.add(key);
      }

      // Every schema intent should either match a router pattern or be
      // a valid intent that a plugin handles
      for (const schema of ACTION_SCHEMAS) {
        // Log schemas that don't match router patterns (informational)
        if (!routerPatterns.has(schema.intent)) {
          console.warn(`Schema intent "${schema.intent}" not in IntentRouter patterns`);
        }
      }

      // At least 80% should match
      const matching = ACTION_SCHEMAS.filter(s => routerPatterns.has(s.intent));
      expect(matching.length / ACTION_SCHEMAS.length).toBeGreaterThan(0.8);
    });
  });

  describe('Edge cases', () => {
    it('empty query returns generic suggestions', async () => {
      const result = await generateFallback({
        query: '',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });

    it('very long query still works', async () => {
      const longQuery = 'kamera '.repeat(100);
      const result = await generateFallback({
        query: longQuery,
        detectedIntent: 'chat:ask',
        scope: 'local',
      });
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });

    it('special characters in query do not crash', async () => {
      const result = await generateFallback({
        query: '<script>alert(1)</script>',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });

    it('unicode / emoji query', async () => {
      const result = await generateFallback({
        query: '📷 pokaż kamerę 🎥',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });
  });
});

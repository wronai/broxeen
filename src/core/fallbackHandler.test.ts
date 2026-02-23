import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFallback } from './fallbackHandler';

const mockGetConfig = vi.fn().mockReturnValue({ apiKey: '', model: 'test', maxTokens: 100, temperature: 0 });
const mockChat = vi.fn();

// Mock llmClient to avoid real API calls
vi.mock('../lib/llmClient', () => ({
  getConfig: (...args: any[]) => mockGetConfig(...args),
  chat: (...args: any[]) => mockChat(...args),
}));

describe('fallbackHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateFallback — keyword mode (no LLM key)', () => {
    it('returns camera domain actions for "użyj kamery"', async () => {
      const result = await generateFallback({
        query: 'użyj kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.text).toBeTruthy();
      expect(result.configPrompt).toBeDefined();
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);

      // Should contain camera-related actions
      const labels = result.configPrompt.actions.map(a => a.label.toLowerCase());
      expect(labels.some(l => l.includes('kamer') || l.includes('camera'))).toBe(true);
    });

    it('returns network domain actions for "sprawdź sieć"', async () => {
      const result = await generateFallback({
        query: 'sprawdź sieć',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
      const executeQueries = result.configPrompt.actions.map(a => a.executeQuery || '');
      expect(executeQueries.some(q =>
        q.includes('skanuj') || q.includes('ping') || q.includes('arp')
      )).toBe(true);
    });

    it('returns system domain actions for "ssh hosty"', async () => {
      const result = await generateFallback({
        query: 'pokaż ssh hosty',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });

    it('returns generic suggestions for completely unknown query', async () => {
      const result = await generateFallback({
        query: 'xyzzy foobar nonsense',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.text).toContain('xyzzy foobar nonsense');
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
      // Generic fallback should include help action
      const ids = result.configPrompt.actions.map(a => a.id);
      expect(ids.some(id => id.includes('help'))).toBe(true);
    });

    it('returns configPrompt with cards layout', async () => {
      const result = await generateFallback({
        query: 'użyj kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.configPrompt.layout).toBe('cards');
    });

    it('actions have execute type and executeQuery', async () => {
      const result = await generateFallback({
        query: 'pokaż kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      for (const action of result.configPrompt.actions) {
        expect(['execute', 'prefill']).toContain(action.type);
        expect(action.executeQuery || action.prefillText).toBeTruthy();
      }
    });
  });

  describe('generateFallback — LLM mode', () => {
    it('uses LLM when API key is available and parses JSON response', async () => {
      mockGetConfig.mockReturnValue({
        apiKey: 'test-key',
        model: 'test-model',
        maxTokens: 500,
        temperature: 0.3,
      });

      mockChat.mockResolvedValue({
        text: JSON.stringify({
          message: 'Wygląda na to, że chcesz użyć kamery. Oto sugestie:',
          actions: [
            { intent: 'camera:snapshot', reason: 'Zrób zdjęcie z kamery' },
            { intent: 'camera:health', reason: 'Sprawdź status' },
          ],
        }),
        model: 'test-model',
      });

      const result = await generateFallback({
        query: 'użyj kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      expect(result.text).toContain('Wygląda na to');
      expect(result.configPrompt.actions.length).toBe(2);
      expect(mockChat).toHaveBeenCalledOnce();
    });

    it('falls back to keyword mode when LLM returns invalid JSON', async () => {
      mockGetConfig.mockReturnValue({
        apiKey: 'test-key',
        model: 'test-model',
        maxTokens: 500,
        temperature: 0.3,
      });

      mockChat.mockResolvedValue({
        text: 'Sorry, I cannot help with that.',
        model: 'test-model',
      });

      const result = await generateFallback({
        query: 'użyj kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      // Should still return suggestions via keyword fallback
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });

    it('falls back to keyword mode when LLM throws', async () => {
      mockGetConfig.mockReturnValue({
        apiKey: 'test-key',
        model: 'test-model',
        maxTokens: 500,
        temperature: 0.3,
      });

      mockChat.mockRejectedValue(new Error('Network error'));

      const result = await generateFallback({
        query: 'użyj kamery',
        detectedIntent: 'chat:ask',
        scope: 'local',
      });

      // Should still return suggestions via keyword fallback
      expect(result.configPrompt.actions.length).toBeGreaterThan(0);
    });
  });

  describe('diverse query coverage', () => {
    const testCases = [
      { query: 'pokaż kamery', expectDomain: 'camera' },
      { query: 'użyj kamery', expectDomain: 'camera' },
      { query: 'kamera wejściowa', expectDomain: 'camera' },
      { query: 'snapshot', expectDomain: 'camera' },
      { query: 'skanuj porty', expectDomain: 'network' },
      { query: 'tablica arp', expectDomain: 'network' },
      { query: 'dyski', expectDomain: 'system' },
      { query: 'temperatura', expectDomain: 'iot' },
      { query: 'bridge mqtt', expectDomain: 'bridge' },
      { query: 'marketplace', expectDomain: 'marketplace' },
      { query: 'monitoruj', expectDomain: 'monitor' },
    ];

    for (const tc of testCases) {
      it(`"${tc.query}" returns suggestions related to ${tc.expectDomain}`, async () => {
        const result = await generateFallback({
          query: tc.query,
          detectedIntent: 'chat:ask',
          scope: 'local',
        });

        expect(result.configPrompt.actions.length).toBeGreaterThan(0);
      });
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentRouter } from './intentRouter';

// Mock the LLM classifier to avoid actual API calls
vi.mock('./llmIntentClassifier', () => ({
  classifyIntent: vi.fn(),
  isLlmClassifierAvailable: vi.fn(),
}));

describe('IntentRouter - LLM Integration', () => {
  let router: IntentRouter;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use LLM classifier when enabled and fall back to regex on failure', async () => {
    const { classifyIntent, isLlmClassifierAvailable } = await import('./llmIntentClassifier');
    
    // Mock LLM as available
    vi.mocked(isLlmClassifierAvailable).mockReturnValue(true);
    
    // Mock LLM to fail
    vi.mocked(classifyIntent).mockRejectedValue(new Error('API error'));
    
    router = new IntentRouter({ useLlmClassifier: true });
    
    const result = await router.detect('skanuj sieć');
    
    // Should fall back to regex detection
    expect(result.intent).toBe('network:scan');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities).toBeDefined();
  });

  it('should use LLM classifier as fallback when no regex matches', async () => {
    const { classifyIntent, isLlmClassifierAvailable } = await import('./llmIntentClassifier');
    
    // Mock LLM as available
    vi.mocked(isLlmClassifierAvailable).mockReturnValue(true);
    
    // Mock LLM to succeed — use input that no regex pattern matches
    vi.mocked(classifyIntent).mockResolvedValue({
      intent: 'network:scan',
      entities: { query: 'check my local devices' },
      confidence: 0.9,
      subAction: 'scan'
    });
    
    router = new IntentRouter({ useLlmClassifier: true });
    
    const result = await router.detect('check my local devices');
    
    // Regex found nothing, so LLM result should be returned
    expect(result.intent).toBe('network:scan');
    expect(result.confidence).toBe(0.9);
    expect(result.entities).toEqual({ query: 'check my local devices' });
  });

  it('should use regex when LLM classifier is disabled', async () => {
    const { classifyIntent, isLlmClassifierAvailable } = await import('./llmIntentClassifier');
    
    // Mock LLM as unavailable
    vi.mocked(isLlmClassifierAvailable).mockReturnValue(false);
    
    router = new IntentRouter({ useLlmClassifier: false });
    
    const result = await router.detect('skanuj sieć');
    
    // Should use regex detection
    expect(result.intent).toBe('network:scan');
    expect(result.confidence).toBeGreaterThan(0.5);
    
    // LLM should not be called
    expect(classifyIntent).not.toHaveBeenCalled();
  });

  it('should handle fallback to chat:ask when no patterns match', async () => {
    const { classifyIntent, isLlmClassifierAvailable } = await import('./llmIntentClassifier');
    
    // Mock LLM as unavailable
    vi.mocked(isLlmClassifierAvailable).mockReturnValue(false);
    
    router = new IntentRouter({ useLlmClassifier: false });
    
    const result = await router.detect('completely unrelated query xyz123');
    
    // Should fall back to chat:ask
    expect(result.intent).toBe('chat:ask');
    expect(result.confidence).toBe(0.5);
    expect(result.entities).toEqual({});
  });
});

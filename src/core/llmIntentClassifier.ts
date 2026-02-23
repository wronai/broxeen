/**
 * LLM Intent Classifier — Uses LLM + ACTION_SCHEMAS to classify user intent
 * and extract entities from natural language input.
 *
 * Architecture (inspired by nlp2cmd):
 *   User NL → LLM (constrained by schema, temperature=0) → { intent, entities, confidence }
 *
 * Features:
 * - Schema-constrained output: LLM can only return known intents
 * - Entity extraction: LLM extracts structured entities (IP, URL, host, etc.)
 * - Memoization cache: identical inputs return cached results
 * - Timeout + graceful fallback: returns null on failure (caller uses regex)
 */

import { ACTION_SCHEMAS, schemasToLlmContext, type ActionSchema } from './actionSchema';
import { buildSystemContextPrompt } from './systemContext';
import { logger } from '../lib/logger';

const log = logger.scope('intent:llm');

// ── Types ────────────────────────────────────────────────────

export interface LlmIntentResult {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  /** Which sub-action within the plugin (e.g. 'stop', 'start', 'list') */
  subAction?: string;
}

interface LlmResponse {
  intent: string;
  entities: Record<string, unknown>;
  confidence: number;
  subAction?: string;
  reasoning?: string;
}

// ── Cache ─────────────────────────────────────────────────────

const intentCache = new Map<string, LlmIntentResult>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000;

function getCacheKey(query: string): string {
  return query.toLowerCase().trim().slice(0, 100);
}

function cacheSet(key: string, result: LlmIntentResult): void {
  if (intentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = intentCache.keys().next().value;
    if (firstKey !== undefined) intentCache.delete(firstKey);
  }
  intentCache.set(key, result);
  
  // Auto-evict after TTL
  setTimeout(() => {
    intentCache.delete(key);
  }, CACHE_TTL_MS);
}

function cacheGet(key: string): LlmIntentResult | null {
  return intentCache.get(key) || null;
}

// ── LLM Classification ───────────────────────────────────────────

/**
 * Build system prompt for LLM intent classification
 */
function buildIntentPrompt(schemas: ActionSchema[]): string {
  const context = schemasToLlmContext(schemas);
  const systemContext = buildSystemContextPrompt();

  return `You are an intent classifier for a smart home/network monitoring application.

AVAILABLE INTENTS:
${context}

${systemContext}

RULES:
1. Return ONLY a JSON object: {"intent": "intent:id", "entities": {...}, "confidence": 0.95}
2. Choose the BEST matching intent from the list above
3. Extract entities (IP addresses, device names, numbers, etc.) into entities object
4. Set confidence based on how well the query matches the intent (0.1 to 1.0)
5. If no good match, use "chat:ask" as fallback
6. Entities should be typed (string, number, boolean, array)
7. Consider the user's language (Polish) and system context (Linux)

Example outputs:
{"intent": "camera:snapshot", "entities": {"device": "kamerą wejściową"}, "confidence": 0.9}
{"intent": "network:ping", "entities": {"target": "192.168.1.1"}, "confidence": 0.95}
{"intent": "chat:ask", "entities": {}, "confidence": 0.3}`;
}

/**
 * Call LLM for intent classification
 */
export async function classifyIntent(query: string): Promise<LlmIntentResult | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  // Check cache first
  const cacheKey = getCacheKey(trimmed);
  const cached = cacheGet(cacheKey);
  if (cached) {
    log.debug('Intent cache hit', { query: trimmed.slice(0, 50) });
    return cached;
  }

  try {
    // Check if LLM is available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configStore } = require('../config/configStore') as { configStore: { get(key: string): unknown } };
    const apiKey = configStore.get('llm.apiKey') as string;
    if (!apiKey) {
      log.debug('LLM API key not configured, skipping classification');
      return null;
    }

    const systemPrompt = buildIntentPrompt(ACTION_SCHEMAS as unknown as ActionSchema[]);
    const model = configStore.get('llm.model') as string || import.meta.env?.VITE_LLM_MODEL || 'google/gemini-2.0-flash-exp:free';

    // Import llmClient dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { llmChat } = require('../plugins/chat/llmClient') as { llmChat: (message: string, options?: any) => Promise<string> };

    const response = await llmChat(trimmed, {
      systemPrompt,
      model,
      maxTokens: 200,
      temperature: 0.0,
    });

    // Parse LLM response
    const cleaned = response
      .replace(/```json\n?/, '')
      .replace(/```\n?$/, '')
      .trim();
    
    const parsed: LlmResponse = JSON.parse(cleaned);
    
    // Validate response
    if (!parsed.intent || typeof parsed.confidence !== 'number') {
      throw new Error('Invalid LLM response format');
    }

    // Validate that the intent is in our known set (or chat:ask fallback)
    const knownIntents = new Set([
      ...ACTION_SCHEMAS.map(s => s.intent),
      'chat:ask',
      'monitoring:query',
    ]);
    if (!knownIntents.has(parsed.intent)) {
      log.warn('LLM returned unknown intent, treating as chat:ask', { intent: parsed.intent });
      parsed.intent = 'chat:ask';
      parsed.confidence = 0.5;
    }

    const result: LlmIntentResult = {
      intent: parsed.intent,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.7)),
      entities: parsed.entities ?? {},
      subAction: parsed.subAction,
    };

    // Cache the result
    cacheSet(cacheKey, result);

    log.info('LLM intent classified', {
      intent: result.intent,
      confidence: result.confidence,
      entities: Object.keys(result.entities),
      subAction: result.subAction,
      input: trimmed.slice(0, 60),
    });

    return result;
  } catch (err) {
    log.warn('LLM intent classification failed', { error: String(err) });
    return null;
  }
}

/**
 * Check if the LLM intent classifier is available (API key configured).
 * Does not make any network calls.
 */
export function isLlmClassifierAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { configStore } = require('../config/configStore') as { configStore: { get(key: string): unknown } };
    const apiKey = configStore.get('llm.apiKey');
    return !!apiKey;
  } catch {
    return false;
  }
}

/**
 * Clear intent cache (useful for testing)
 */
export function clearIntentCache(): void {
  intentCache.clear();
}

/**
 * Get cache statistics
 */
export function getIntentCacheStats(): { size: number; maxSize: number } {
  return {
    size: intentCache.size,
    maxSize: MAX_CACHE_SIZE
  };
}

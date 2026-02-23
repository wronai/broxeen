/**
 * Fallback Handler — When no plugin matches a user's intent, this module
 * generates helpful action suggestions using:
 * 1. LLM-based selection (if API key is available) — sends action schemas as context
 * 2. Keyword-based matching — scores schemas against user query
 * 3. Domain-based suggestions — shows all actions from the detected domain
 *
 * Returns a PluginResult with config_prompt-style action buttons.
 */

import {
  ACTION_SCHEMAS,
  findMatchingSchemas,
  findDomainSchemas,
  schemasToConfigActions,
  schemasToLlmContext,
  type ActionSchema,
} from './actionSchema';
import type { ConfigPromptData, ConfigAction } from '../components/ChatConfigPrompt';
import { preferenceLearning } from './preferenceLearning';
import { buildSystemContextPrompt } from './systemContext';
import { logger } from '../lib/logger';

const fallbackLogger = logger.scope('fallback');

// ── Types ────────────────────────────────────────────────────

export interface FallbackResult {
  /** Markdown text to show in chat */
  text: string;
  /** Interactive config prompt with action buttons */
  configPrompt: ConfigPromptData;
}

export interface FallbackOptions {
  /** The user's raw input */
  query: string;
  /** The detected (but unhandled) intent */
  detectedIntent: string;
  /** Current scope id */
  scope: string;
  /** List of plugin IDs allowed in current scope */
  allowedPluginIds?: string[];
}

// ── LLM-based fallback ──────────────────────────────────────

/**
 * Try to use LLM to pick the best matching actions for the user query.
 * Returns null if LLM is unavailable or fails.
 */
async function tryLlmFallback(options: FallbackOptions): Promise<FallbackResult | null> {
  try {
    const { getConfig, chat } = await import('../lib/llmClient');
    const cfg = getConfig();
    if (!cfg.apiKey) {
      fallbackLogger.debug('LLM unavailable for fallback (no API key)');
      return null;
    }

    // Build LLM context from all action schemas
    const schemasContext = schemasToLlmContext(ACTION_SCHEMAS as unknown as ActionSchema[]);

    const sysCtx = buildSystemContextPrompt();

    const systemPrompt = `Jesteś asystentem systemu Broxeen — inteligentnego monitora sieci, kamer i plików.
Użytkownik wpisał zapytanie, którego system nie rozpoznał automatycznie.

${sysCtx}

Oto WSZYSTKIE dostępne akcje w systemie:

${schemasContext}

Twoim zadaniem jest:
1. Zrozumieć intencję użytkownika w kontekście systemu (OS, ścieżki, możliwości)
2. Wybrać 3-5 najlepiej pasujących akcji z powyższej listy
3. Odpowiedzieć w formacie JSON (i TYLKO JSON, bez markdown):

{
  "message": "Krótkie wyjaśnienie po polsku co system zrozumiał i co sugeruje",
  "actions": [
    { "intent": "intent:id", "reason": "dlaczego ta akcja pasuje" }
  ]
}

Jeśli zapytanie dotyczy konkretnej domeny (np. kamery, pliki, sieć), preferuj akcje z tej domeny.
NIGDY nie proponuj poradników dla wielu systemów — odpowiadaj TYLKO w kontekście wykrytego OS.
Zawsze odpowiadaj po polsku. Zwróć TYLKO JSON.`;

    fallbackLogger.info('Asking LLM for fallback suggestions', {
      query: options.query,
      intent: options.detectedIntent,
    });

    const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: options.query },
      ],
      { maxTokens: 500, temperature: 0.3 },
    );

    // Parse LLM response
    const text = response.text.trim();
    // Try to extract JSON from response (might be wrapped in ```json blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      fallbackLogger.warn('LLM fallback: could not parse JSON from response', { text: text.slice(0, 200) });
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      message: string;
      actions: Array<{ intent: string; reason: string }>;
    };

    if (!parsed.actions || parsed.actions.length === 0) {
      fallbackLogger.warn('LLM fallback: no actions suggested');
      return null;
    }

    // Map LLM-selected intents to ActionSchemas
    const schemaMap = new Map(ACTION_SCHEMAS.map(s => [s.intent, s]));
    const selectedSchemas: ActionSchema[] = [];
    for (const a of parsed.actions) {
      const schema = schemaMap.get(a.intent);
      if (schema) selectedSchemas.push(schema);
    }

    if (selectedSchemas.length === 0) {
      fallbackLogger.warn('LLM fallback: none of suggested intents matched known schemas');
      return null;
    }

    const actions = schemasToConfigActions(selectedSchemas);

    fallbackLogger.info('LLM fallback generated suggestions', {
      count: actions.length,
      intents: selectedSchemas.map(s => s.intent),
    });

    return {
      text: `🤖 ${parsed.message}\n\nWybierz jedną z sugerowanych akcji:`,
      configPrompt: {
        title: 'Sugerowane akcje',
        description: parsed.message,
        actions,
        layout: 'cards',
      },
    };
  } catch (err) {
    fallbackLogger.warn('LLM fallback failed, using keyword matching', { error: String(err) });
    return null;
  }
}

// ── Preference-based ranking ────────────────────────────────

/**
 * Re-sort actions by user preference history. Actions the user has
 * clicked before get boosted; others keep their original order.
 */
function rankByPreference(actions: ConfigAction[]): ConfigAction[] {
  return [...actions].sort((a, b) => {
    const scoreA = preferenceLearning.score(a.id, a.executeQuery || a.prefillText).combined;
    const scoreB = preferenceLearning.score(b.id, b.executeQuery || b.prefillText).combined;
    return scoreB - scoreA; // higher preference first
  });
}

/**
 * Inject top user favorites (from history) into an action list if they
 * are not already present. Returns at most `limit` actions.
 */
function injectFavorites(actions: ConfigAction[], limit = 6): ConfigAction[] {
  const topPrefs = preferenceLearning.getTopPreferences(3);
  if (topPrefs.length === 0) return actions.slice(0, limit);

  const existingKeys = new Set(actions.map(a => (a.executeQuery || a.prefillText || a.id).toLowerCase()));
  const schemaMap = new Map(ACTION_SCHEMAS.map(s => [s.intent, s]));

  for (const pref of topPrefs) {
    if (existingKeys.has(pref.key)) continue;
    // Try to find matching schema to build a proper action
    const schema = schemaMap.get(pref.key);
    if (schema) {
      actions.push({
        id: `fav-${schema.intent}`,
        label: `⭐ ${schema.label}`,
        description: `Często używane (${pref.count}x)`,
        icon: schema.icon,
        type: 'execute',
        executeQuery: schema.executeQuery,
        variant: 'primary',
      });
      existingKeys.add(pref.key);
    }
  }

  return actions.slice(0, limit);
}

// ── Keyword-based fallback ──────────────────────────────────

function keywordFallback(options: FallbackOptions): FallbackResult {
  const { query } = options;

  // 1. Try domain-based matching first (e.g. "użyj kamery" → camera domain)
  const domainSchemas = findDomainSchemas(query);
  if (domainSchemas.length > 0) {
    const actions = rankByPreference(schemasToConfigActions(domainSchemas.slice(0, 6)));
    const domainLabel = domainSchemas[0]?.domain || 'system';
    const domainNames: Record<string, string> = {
      camera: 'kamer',
      network: 'sieci',
      system: 'systemu',
      browse: 'przeglądania',
      monitor: 'monitoringu',
      iot: 'czujników IoT',
      bridge: 'mostów protokołów',
      marketplace: 'marketplace',
      chat: 'czatu',
    };

    fallbackLogger.info('Keyword fallback: domain match', {
      domain: domainLabel,
      actionsCount: actions.length,
    });

    return {
      text: `Rozpoznałem zapytanie dotyczące **${domainNames[domainLabel] || domainLabel}**.\n\nOto dostępne akcje w tym obszarze:`,
      configPrompt: {
        title: `Akcje: ${domainNames[domainLabel] || domainLabel}`,
        actions,
        layout: 'cards',
      },
    };
  }

  // 2. Try keyword scoring
  const scored = findMatchingSchemas(query, 5);
  if (scored.length > 0) {
    const actions = rankByPreference(schemasToConfigActions(scored));

    fallbackLogger.info('Keyword fallback: scored match', {
      topScore: scored[0]?.score,
      count: scored.length,
    });

    return {
      text: `Nie znalazłem dokładnego dopasowania dla: **"${query}"**\n\nAle oto akcje, które mogą Ci odpowiadać:`,
      configPrompt: {
        title: 'Możliwe akcje',
        actions,
        layout: 'cards',
      },
    };
  }

  // 3. Generic fallback — show top actions from each domain
  fallbackLogger.info('Keyword fallback: generic suggestions');

  const genericActions: ConfigAction[] = [
    { id: 'fb-scan', label: 'Skanuj sieć', icon: '🔍', type: 'execute', executeQuery: 'skanuj sieć', variant: 'primary', description: 'Znajdź urządzenia w sieci' },
    { id: 'fb-cameras', label: 'Status kamer', icon: '📷', type: 'execute', executeQuery: 'sprawdź status kamer', variant: 'primary', description: 'Sprawdź czy kamery działają' },
    { id: 'fb-browse', label: 'Przeglądaj stronę', icon: '🌍', type: 'prefill', prefillText: 'przeglądaj ', variant: 'secondary', description: 'Otwórz stronę internetową' },
    { id: 'fb-ssh', label: 'SSH', icon: '🖥️', type: 'prefill', prefillText: 'ssh ', variant: 'secondary', description: 'Zdalne polecenie SSH' },
    { id: 'fb-disk', label: 'Dyski', icon: '💾', type: 'execute', executeQuery: 'pokaż dyski', variant: 'secondary', description: 'Informacje o dyskach' },
    { id: 'fb-help', label: 'Pomoc', icon: '❓', type: 'execute', executeQuery: 'pomoc', variant: 'secondary', description: 'Zobacz wszystkie komendy' },
  ];

  // Inject learned favorites into generic suggestions
  const finalActions = injectFavorites(rankByPreference(genericActions));

  return {
    text: `Nie rozpoznałem polecenia: **"${query}"**\n\nWybierz jedną z dostępnych akcji lub wpisz bardziej szczegółowe zapytanie:`,
    configPrompt: {
      title: 'Dostępne akcje',
      actions: finalActions,
      layout: 'cards',
    },
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Generate fallback suggestions when no plugin handles the user's query.
 * Tries LLM first, then keyword matching, then generic suggestions.
 */
export async function generateFallback(options: FallbackOptions): Promise<FallbackResult> {
  fallbackLogger.info('Generating fallback for unhandled query', {
    query: options.query,
    intent: options.detectedIntent,
    scope: options.scope,
  });

  // Try LLM-based fallback first
  const llmResult = await tryLlmFallback(options);
  if (llmResult) return llmResult;

  // Fall back to keyword matching
  return keywordFallback(options);
}

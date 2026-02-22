/**
 * @module core/intentRouter
 * @description Routes user input to the best matching plugin.
 *
 * Two-phase resolution:
 * 1. Rule-based detection (fast, no LLM call) — handles obvious cases
 * 2. LLM-based detection (fallback) — handles ambiguous natural language
 *
 * OCP: New intent rules = add to RULES array, no modification to router logic.
 */

import type {
  DataSourcePlugin,
  IIntentRouter,
  IntentName,
  PluginQuery,
  PluginResult,
  QueryMetadata,
} from "./plugin.types";
import type { PluginRegistry } from "./pluginRegistry";

// ─── Intent Detection Rules (OCP — extend by appending) ────

export interface IntentRule {
  readonly intent: IntentName;
  /** Returns true if this rule matches the input */
  readonly test: (input: string) => boolean;
  /** Priority: higher = checked first */
  readonly priority: number;
}

/** Built-in rules. Plugins can register additional rules via addRule(). */
const DEFAULT_RULES: IntentRule[] = [
  // Direct URLs
  {
    intent: "browse",
    test: (input) => /^https?:\/\//i.test(input.trim()),
    priority: 100,
  },
  // Bare domains (onet.pl, github.com)
  {
    intent: "browse",
    test: (input) =>
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}$/i.test(input.trim()),
    priority: 95,
  },
  // Polish phonetic URL ("onet kropka pe el")
  {
    intent: "browse",
    test: (input) => /\b(kropka|slash|małpa|ha te te pe)\b/i.test(input),
    priority: 90,
  },
  // Camera intent ("co widać na kamerze", "pokaż kamerę")
  {
    intent: "camera:describe",
    test: (input) =>
      /\b(kamer[aęy]|camera|podgląd|obraz z|widać na)\b/i.test(input),
    priority: 80,
  },
  // IoT sensor intent ("temperatura", "czujnik", "sensor")
  {
    intent: "iot:read",
    test: (input) =>
      /\b(czujnik|sensor|temperatura|wilgotność|humidity|temperature)\b/i.test(
        input,
      ),
    priority: 70,
  },
  // API query ("api", "endpoint", "rest")
  {
    intent: "api:query",
    test: (input) => /\b(api|endpoint|rest|graphql)\b/i.test(input),
    priority: 60,
  },
  // Search fallback (natural language that doesn't match above)
  {
    intent: "search",
    test: () => true, // catches everything else
    priority: 0,
  },
];

// ─── LLM Intent Detector (optional, for ambiguous cases) ────

export interface LlmIntentDetector {
  detect(input: string): Promise<IntentName>;
}

// ─── Intent Router Implementation ───────────────────────────

export interface IntentRouterOptions {
  registry: PluginRegistry;
  llmDetector?: LlmIntentDetector;
  isTauri: boolean;
}

export class IntentRouter implements IIntentRouter {
  private readonly registry: PluginRegistry;
  private readonly llmDetector?: LlmIntentDetector;
  private readonly isTauri: boolean;
  private readonly rules: IntentRule[];

  constructor(options: IntentRouterOptions) {
    this.registry = options.registry;
    this.llmDetector = options.llmDetector;
    this.isTauri = options.isTauri;
    // Sort rules by priority desc — first match wins
    this.rules = [...DEFAULT_RULES].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Add a custom rule (e.g., from a plugin during registration).
   * Respects OCP: core rules untouched.
   */
  addRule(rule: IntentRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  // ── Intent Detection ────────────────────────────────────

  async detectIntent(rawInput: string): Promise<IntentName> {
    const input = rawInput.trim();
    if (!input) return "search";

    // Phase 1: Rule-based (fast path)
    const ruleMatch = this.rules.find((r) => r.test(input));
    if (ruleMatch && ruleMatch.priority > 0) {
      // High-confidence rule match — check if plugin exists for it
      const plugins = this.registry.getAvailableForIntent(
        ruleMatch.intent,
        this.isTauri,
      );
      if (plugins.length > 0) {
        return ruleMatch.intent;
      }
      // No plugin for this intent — fall through to LLM or search
    }

    // Phase 2: LLM-based (if available)
    if (this.llmDetector) {
      try {
        const llmIntent = await this.llmDetector.detect(input);
        const plugins = this.registry.getAvailableForIntent(
          llmIntent,
          this.isTauri,
        );
        if (plugins.length > 0) {
          return llmIntent;
        }
      } catch {
        // LLM failed — fall through to default
      }
    }

    // Phase 3: Default to search
    return "search";
  }

  // ── Query Routing ─────────────────────────────────────────

  async route(query: PluginQuery): Promise<PluginResult> {
    const plugins = this.registry.getAvailableForIntent(
      query.intent,
      this.isTauri,
    );

    if (plugins.length === 0) {
      return {
        pluginId: "intent-router",
        status: "error",
        content: [
          {
            type: "text",
            data: `Brak pluginu obsługującego intencję: "${query.intent}"`,
          },
        ],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        },
      };
    }

    // Try plugins in priority order (fallback chain)
    let lastError: Error | null = null;

    for (const plugin of plugins) {
      try {
        const available = await plugin.isAvailable();
        if (!available) continue;

        const result = await plugin.execute(query);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Continue to next plugin in chain
      }
    }

    return {
      pluginId: "intent-router",
      status: "error",
      content: [
        {
          type: "text",
          data: lastError?.message ?? "Wszystkie pluginy zawiodły",
        },
      ],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false,
      },
    };
  }
}

// ─── Helper: Build a PluginQuery ────────────────────────────

export function buildQuery(
  intent: IntentName,
  rawInput: string,
  overrides: Partial<Omit<PluginQuery, "intent" | "rawInput">> = {},
): PluginQuery {
  return {
    intent,
    rawInput,
    params: {},
    metadata: {
      timestamp: Date.now(),
      source: "text",
      locale: "pl-PL",
    },
    ...overrides,
  };
}

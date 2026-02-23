/**
 * Intent Schema — Unified schema format that combines ACTION_SCHEMAS with
 * regex fallback patterns and sub-action routing.
 *
 * Plugins declare their intents via IntentSchema instead of implementing
 * canHandle() with hardcoded regex. The router uses:
 * 1. LLM classification (if available) using schema context
 * 2. Regex pattern matching (fallback) using schema patterns
 *
 * This replaces per-plugin canHandle() and execute() routing with a
 * declarative, data-driven approach.
 */

import type { ActionDomain, ActionSchema } from './actionSchema';

// ── Types ────────────────────────────────────────────────────

/** Sub-action within an intent (e.g. monitor:start has stop/list/logs/config) */
export interface SubActionDef {
  /** Sub-action key, e.g. 'stop', 'list', 'logs' */
  readonly key: string;
  /** Regex patterns that match this sub-action (fallback when LLM unavailable) */
  readonly patterns: readonly RegExp[];
  /** Human-readable label */
  readonly label: string;
}

/** Extended intent schema with regex fallback patterns and sub-actions */
export interface IntentSchema extends ActionSchema {
  /** Plugin ID that handles this intent */
  readonly pluginId: string;
  /** Regex patterns for canHandle fallback (when LLM is unavailable) */
  readonly patterns: readonly RegExp[];
  /** Optional sub-actions for internal routing within the plugin */
  readonly subActions?: readonly SubActionDef[];
}

// ── Registry ─────────────────────────────────────────────────

const schemaRegistry = new Map<string, IntentSchema>();

/** Register an intent schema */
export function registerIntentSchema(schema: IntentSchema): void {
  schemaRegistry.set(schema.intent, schema);
}

/** Register multiple intent schemas at once */
export function registerIntentSchemas(schemas: readonly IntentSchema[]): void {
  for (const schema of schemas) {
    registerIntentSchema(schema);
  }
}

/** Get a schema by intent ID */
export function getIntentSchema(intent: string): IntentSchema | undefined {
  return schemaRegistry.get(intent);
}

/** Get all registered schemas */
export function getAllIntentSchemas(): IntentSchema[] {
  return [...schemaRegistry.values()];
}

/** Get schemas for a specific plugin */
export function getSchemasByPlugin(pluginId: string): IntentSchema[] {
  return getAllIntentSchemas().filter(s => s.pluginId === pluginId);
}

/** Get schemas for a specific domain */
export function getSchemasByDomain(domain: ActionDomain): IntentSchema[] {
  return getAllIntentSchemas().filter(s => s.domain === domain);
}

/** Clear all registered schemas (for testing) */
export function clearIntentSchemas(): void {
  schemaRegistry.clear();
}

// ── Pattern matching (regex fallback) ────────────────────────

/**
 * Match input against all registered intent schemas using regex patterns.
 * Returns the best match or null if no patterns match.
 * Used as fallback when LLM classifier is unavailable.
 */
export function matchIntentByPatterns(input: string): {
  schema: IntentSchema;
  subAction?: string;
} | null {
  const lower = input.toLowerCase().trim();

  for (const schema of schemaRegistry.values()) {
    const matches = schema.patterns.some(p => p.test(lower));
    if (!matches) continue;

    // Check sub-actions
    let subAction: string | undefined;
    if (schema.subActions) {
      for (const sub of schema.subActions) {
        if (sub.patterns.some(p => p.test(lower))) {
          subAction = sub.key;
          break;
        }
      }
    }

    return { schema, subAction };
  }

  return null;
}

/**
 * Check if a specific input matches a plugin's registered intent schemas.
 * Replaces per-plugin canHandle() with a centralized check.
 */
export function canPluginHandle(pluginId: string, input: string): boolean {
  const lower = input.toLowerCase().trim();
  const schemas = getSchemasByPlugin(pluginId);
  return schemas.some(s => s.patterns.some(p => p.test(lower)));
}

// ── Schema builder helper ────────────────────────────────────

/** Helper to create an IntentSchema with sensible defaults */
export function defineIntent(
  def: Omit<IntentSchema, 'icon' | 'executeQuery'> & {
    icon?: string;
    executeQuery?: string;
  },
): IntentSchema {
  return {
    icon: '🔧',
    executeQuery: def.examples[0] ?? def.label,
    ...def,
  } as IntentSchema;
}

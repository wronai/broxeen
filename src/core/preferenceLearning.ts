/**
 * PreferenceLearningStore — centralized preference tracking for action choices.
 *
 * Tracks which actions users click (from fallback suggestions, config prompts,
 * quick actions, etc.) and provides scoring to rank future suggestions.
 *
 * Data model:
 * - Key: normalized action identifier (intent or executeQuery)
 * - Value: { count, lastUsed, domain, successRate }
 *
 * Persists to localStorage under 'broxeen:preference-learning'.
 */

import { logger } from '../lib/logger';
import type { ActionDomain } from './actionSchema';

const log = logger.scope('preference-learning');

const STORAGE_KEY = 'broxeen:preference-learning';
const MAX_ENTRIES = 200;

// ── Types ────────────────────────────────────────────────────

export interface PreferenceEntry {
  /** Normalized key (intent id or lowercase executeQuery) */
  key: string;
  /** Domain group */
  domain: ActionDomain | string;
  /** Human label (last seen) */
  label: string;
  /** Total times selected */
  count: number;
  /** Successful executions */
  successes: number;
  /** Unix timestamp of last use */
  lastUsed: number;
}

export interface PreferenceScore {
  /** Frequency-based score (0..1) */
  frequency: number;
  /** Recency-based score (0..1) — decays over 7 days */
  recency: number;
  /** Success rate (0..1) */
  successRate: number;
  /** Combined weighted score (0..1) */
  combined: number;
}

// ── Store ────────────────────────────────────────────────────

class PreferenceLearningStore {
  private data: Map<string, PreferenceEntry> = new Map();
  private maxCount = 0; // tracks highest count for normalization
  private loaded = false;

  /** Load from localStorage */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PreferenceEntry[];
      for (const entry of parsed) {
        this.data.set(entry.key, entry);
        if (entry.count > this.maxCount) this.maxCount = entry.count;
      }
      log.debug('Loaded preference data', { entries: this.data.size });
    } catch (err) {
      log.warn('Failed to load preference data', { error: String(err) });
    }
  }

  /** Persist to localStorage */
  private save(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const entries = [...this.data.values()]
        .sort((a, b) => b.lastUsed - a.lastUsed)
        .slice(0, MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
      log.warn('Failed to save preference data', { error: String(err) });
    }
  }

  /** Normalize key: use intent if available, else lowercase executeQuery */
  private normalizeKey(intent?: string, executeQuery?: string): string {
    if (intent && !intent.startsWith('action-')) return intent;
    return (executeQuery || intent || 'unknown').toLowerCase().trim();
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Record that a user selected an action.
   * Call this from ChatConfigPrompt, fallback handler, quick actions, etc.
   */
  recordChoice(opts: {
    intent?: string;
    executeQuery?: string;
    domain?: ActionDomain | string;
    label?: string;
    success?: boolean;
  }): void {
    this.ensureLoaded();
    const key = this.normalizeKey(opts.intent, opts.executeQuery);
    const existing = this.data.get(key);

    if (existing) {
      existing.count++;
      existing.successes += opts.success !== false ? 1 : 0;
      existing.lastUsed = Date.now();
      if (opts.label) existing.label = opts.label;
      if (opts.domain) existing.domain = opts.domain;
    } else {
      this.data.set(key, {
        key,
        domain: opts.domain || 'unknown',
        label: opts.label || key,
        count: 1,
        successes: opts.success !== false ? 1 : 0,
        lastUsed: Date.now(),
      });
    }

    const entry = this.data.get(key)!;
    if (entry.count > this.maxCount) this.maxCount = entry.count;

    log.debug('Recorded choice', { key, count: entry.count, domain: entry.domain });
    this.save();
  }

  /**
   * Score an action based on learned user preferences.
   * Returns a PreferenceScore with combined weighted score (0..1).
   */
  score(intent?: string, executeQuery?: string): PreferenceScore {
    this.ensureLoaded();
    const key = this.normalizeKey(intent, executeQuery);
    const entry = this.data.get(key);

    if (!entry) {
      return { frequency: 0, recency: 0, successRate: 0.5, combined: 0 };
    }

    // Frequency: normalize against max count
    const frequency = this.maxCount > 0 ? entry.count / this.maxCount : 0;

    // Recency: exponential decay over 7 days
    const ageMs = Date.now() - entry.lastUsed;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const recency = Math.exp(-ageMs / SEVEN_DAYS);

    // Success rate
    const successRate = entry.count > 0 ? entry.successes / entry.count : 0.5;

    // Combined: weighted average
    const combined = frequency * 0.4 + recency * 0.35 + successRate * 0.25;

    return { frequency, recency, successRate, combined };
  }

  /**
   * Get top-N most preferred actions, optionally filtered by domain.
   */
  getTopPreferences(limit = 5, domain?: ActionDomain | string): PreferenceEntry[] {
    this.ensureLoaded();
    let entries = [...this.data.values()];
    if (domain) {
      entries = entries.filter(e => e.domain === domain);
    }
    return entries
      .map(e => ({ ...e, _score: this.score(e.key).combined }))
      .sort((a, b) => (b as any)._score - (a as any)._score)
      .slice(0, limit);
  }

  /**
   * Get all preference entries (for debugging/export).
   */
  getAll(): PreferenceEntry[] {
    this.ensureLoaded();
    return [...this.data.values()];
  }

  /**
   * Clear all learning data.
   */
  reset(): void {
    this.data.clear();
    this.maxCount = 0;
    this.save();
    log.info('Preference learning data cleared');
  }
}

/** Singleton instance */
export const preferenceLearning = new PreferenceLearningStore();

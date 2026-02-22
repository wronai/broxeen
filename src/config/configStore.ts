/**
 * ConfigStore — Singleton store for Broxeen app configuration.
 * Persists to localStorage, merges env vars, supports deep get/set.
 * Emits change events so UI can react to config updates.
 */

import { DEFAULT_CONFIG, type AppConfig } from './appConfig';
import { logger } from '../lib/logger';

const STORAGE_KEY = 'broxeen_app_config';
const configLogger = logger.scope('config:store');

type ConfigListener = (path: string, value: unknown) => void;

class ConfigStoreImpl {
  private config: AppConfig;
  private listeners: Set<ConfigListener> = new Set();

  constructor() {
    this.config = this.load();
    configLogger.info('ConfigStore initialized', {
      hasApiKey: !!this.config.llm.apiKey,
      model: this.config.llm.model,
      locale: this.config.locale.locale,
    });
  }

  /** Load config: defaults ← localStorage ← env vars */
  private load(): AppConfig {
    let stored: Partial<AppConfig> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        stored = JSON.parse(raw);
        configLogger.debug('Loaded config from localStorage');
      }
    } catch (err) {
      configLogger.warn('Failed to parse stored config, using defaults', err);
    }

    // Deep merge: defaults ← stored ← env overrides
    const merged = this.deepMerge(DEFAULT_CONFIG, stored) as AppConfig;

    // Env var overrides (Vite + Tauri)
    const env = typeof import.meta !== 'undefined' ? import.meta.env : ({} as Record<string, string>);

    if (env.VITE_OPENROUTER_API_KEY) merged.llm.apiKey = env.VITE_OPENROUTER_API_KEY;
    if (env.VITE_LLM_MODEL) merged.llm.model = env.VITE_LLM_MODEL;
    if (env.VITE_LLM_MAX_TOKENS) merged.llm.maxTokens = Number(env.VITE_LLM_MAX_TOKENS);
    if (env.VITE_LLM_TEMPERATURE) merged.llm.temperature = Number(env.VITE_LLM_TEMPERATURE);
    if (env.VITE_STT_MODEL) merged.stt.model = env.VITE_STT_MODEL;
    if (env.VITE_STT_LANG) merged.stt.language = env.VITE_STT_LANG;
    if (env.VITE_LLM_API_URL) merged.llm.apiUrl = env.VITE_LLM_API_URL;
    if (env.VITE_DEFAULT_SUBNET) merged.network.defaultSubnet = env.VITE_DEFAULT_SUBNET;
    if (env.VITE_LOCALE) merged.locale.locale = env.VITE_LOCALE;
    if (env.VITE_LANGUAGE) merged.locale.language = env.VITE_LANGUAGE;

    return merged;
  }

  /** Persist current config to localStorage */
  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
      configLogger.debug('Config persisted to localStorage');
    } catch (err) {
      configLogger.error('Failed to persist config', err);
    }
  }

  /** Get the full config */
  getAll(): Readonly<AppConfig> {
    return this.config;
  }

  /** Get a nested value by dot-path, e.g. "llm.apiKey" */
  get<T = unknown>(path: string): T {
    return path.split('.').reduce((obj: any, key) => obj?.[key], this.config) as T;
  }

  /** Set a nested value by dot-path and persist */
  set(path: string, value: unknown): void {
    const keys = path.split('.');
    let obj: any = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] === undefined) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    const lastKey = keys[keys.length - 1];
    const oldValue = obj[lastKey];
    obj[lastKey] = value;

    configLogger.info('Config updated', { path, oldValue, newValue: value });
    this.persist();
    this.notify(path, value);
  }

  /** Set multiple values at once */
  setMany(updates: Record<string, unknown>): void {
    for (const [path, value] of Object.entries(updates)) {
      const keys = path.split('.');
      let obj: any = this.config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (obj[keys[i]] === undefined) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
    }
    this.persist();
    for (const [path, value] of Object.entries(updates)) {
      this.notify(path, value);
    }
    configLogger.info('Config batch updated', { paths: Object.keys(updates) });
  }

  /** Reset a section or entire config to defaults */
  reset(section?: keyof AppConfig): void {
    if (section) {
      (this.config as any)[section] = { ...(DEFAULT_CONFIG as any)[section] };
      configLogger.info(`Config section "${section}" reset to defaults`);
    } else {
      this.config = { ...DEFAULT_CONFIG };
      configLogger.info('Full config reset to defaults');
    }
    this.persist();
    this.notify(section || '*', this.config);
  }

  /** Subscribe to config changes */
  onChange(listener: ConfigListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(path: string, value: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener(path, value);
      } catch (err) {
        configLogger.error('Config change listener error', err);
      }
    }
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else if (source[key] !== undefined) {
        output[key] = source[key];
      }
    }
    return output;
  }

  // ── Auto-discovery helpers ──────────────────────────────────

  /** Check what capabilities are available and return missing config */
  detectMissingConfig(): string[] {
    const missing: string[] = [];

    if (!this.config.llm.apiKey) {
      missing.push('llm.apiKey');
    }

    return missing;
  }

  /** Check if LLM is configured and available */
  isLlmAvailable(): boolean {
    return !!this.config.llm.apiKey;
  }

  /** Check if STT is configured */
  isSttConfigured(): boolean {
    return !!this.config.llm.apiKey && !!this.config.stt.model;
  }

  /** Get a summary of current configuration status */
  getConfigStatus(): ConfigStatus {
    return {
      llmConfigured: this.isLlmAvailable(),
      sttConfigured: this.isSttConfigured(),
      networkSubnet: this.config.network.defaultSubnet,
      locale: this.config.locale.locale,
      missingFields: this.detectMissingConfig(),
    };
  }
}

export interface ConfigStatus {
  llmConfigured: boolean;
  sttConfigured: boolean;
  networkSubnet: string;
  locale: string;
  missingFields: string[];
}

/** Singleton instance */
export const configStore = new ConfigStoreImpl();

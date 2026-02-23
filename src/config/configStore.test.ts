/**
 * Tests for ConfigStore — centralized app configuration.
 * Since configStore is a singleton, we use reset() + set() to isolate tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from './appConfig';
import { configStore } from './configStore';

describe('ConfigStore', () => {
  beforeEach(() => {
    // Reset to defaults before every test, clearing any env var overrides
    configStore.reset();
    // Also clear API key which may have been loaded from .env
    configStore.set('llm.apiKey', '');
  });

  it('returns default config after reset', () => {
    const cfg = configStore.getAll();
    expect(cfg.llm.apiUrl).toBe(DEFAULT_CONFIG.llm.apiUrl);
    expect(cfg.network.defaultSubnet).toBe(DEFAULT_CONFIG.network.defaultSubnet);
    expect(cfg.ssh.defaultTimeoutSec).toBe(DEFAULT_CONFIG.ssh.defaultTimeoutSec);
    expect(cfg.locale.locale).toBe(DEFAULT_CONFIG.locale.locale);
  });

  it('get() returns nested value by dot-path', () => {
    expect(configStore.get<string>('llm.apiUrl')).toBe(DEFAULT_CONFIG.llm.apiUrl);
    expect(configStore.get<number>('ssh.defaultPort')).toBe(22);
    expect(configStore.get<string>('locale.language')).toBe('pl');
  });

  it('set() updates value and notifies listeners', () => {
    const listener = vi.fn();
    const unsub = configStore.onChange(listener);

    configStore.set('llm.model', import.meta.env?.VITE_LLM_MODEL || 'openai/gpt-4o');
    expect(configStore.get<string>('llm.model')).toBe(import.meta.env?.VITE_LLM_MODEL || 'openai/gpt-4o');
    expect(listener).toHaveBeenCalledWith('llm.model', import.meta.env?.VITE_LLM_MODEL || 'openai/gpt-4o');

    unsub();
  });

  it('setMany() batch-updates multiple paths', () => {
    configStore.setMany({
      'llm.model': import.meta.env?.VITE_LLM_MODEL || 'anthropic/claude-3.5-sonnet',
      'ssh.defaultPort': 2222,
      'network.batchSize': 20,
    });

    expect(configStore.get<string>('llm.model')).toBe(import.meta.env?.VITE_LLM_MODEL || 'anthropic/claude-3.5-sonnet');
    expect(configStore.get<number>('ssh.defaultPort')).toBe(2222);
    expect(configStore.get<number>('network.batchSize')).toBe(20);
  });

  it('reset(section) restores defaults for that section only', () => {
    configStore.set('ssh.defaultPort', 9999);
    configStore.set('llm.model', 'custom');
    expect(configStore.get<number>('ssh.defaultPort')).toBe(9999);

    configStore.reset('ssh');
    expect(configStore.get<number>('ssh.defaultPort')).toBe(DEFAULT_CONFIG.ssh.defaultPort);
    // Other sections untouched
    expect(configStore.get<string>('llm.model')).toBe('custom');
  });

  it('reset() without section restores full defaults', () => {
    configStore.set('llm.model', 'custom-model');
    configStore.set('network.batchSize', 99);

    configStore.reset();
    configStore.set('llm.apiKey', ''); // clear env-loaded key

    expect(configStore.get<string>('llm.model')).toBe(DEFAULT_CONFIG.llm.model);
    expect(configStore.get<number>('network.batchSize')).toBe(DEFAULT_CONFIG.network.batchSize);
  });

  it('detectMissingConfig() flags missing API key', () => {
    configStore.set('llm.apiKey', '');
    const missing = configStore.detectMissingConfig();
    expect(missing).toContain('llm.apiKey');
  });

  it('isLlmAvailable() returns false when no API key', () => {
    configStore.set('llm.apiKey', '');
    expect(configStore.isLlmAvailable()).toBe(false);
  });

  it('isLlmAvailable() returns true when API key is set', () => {
    configStore.set('llm.apiKey', 'sk-test-key');
    expect(configStore.isLlmAvailable()).toBe(true);
  });

  it('getConfigStatus() returns complete status', () => {
    configStore.set('llm.apiKey', '');
    const status = configStore.getConfigStatus();
    expect(status.llmConfigured).toBe(false);
    expect(status.sttConfigured).toBe(false);
    expect(status.networkSubnet).toBe(DEFAULT_CONFIG.network.defaultSubnet);
    expect(status.locale).toBe(DEFAULT_CONFIG.locale.locale);
    expect(status.missingFields).toContain('llm.apiKey');
  });

  it('onChange() unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = configStore.onChange(listener);

    configStore.set('llm.model', 'test1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    configStore.set('llm.model', 'test2');
    expect(listener).toHaveBeenCalledTimes(1); // Not called again
  });
});

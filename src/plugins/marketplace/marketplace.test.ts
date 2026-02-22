/**
 * Unit tests for Marketplace Plugin
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MarketplacePlugin } from './marketplaceLoader';
import { scopeRegistry } from '../scope/scopeRegistry';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = { isTauri: false };

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
  localStorageMock.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorageMock.clear();
});

describe('MarketplacePlugin', () => {
  let plugin: MarketplacePlugin;
  beforeEach(() => { plugin = new MarketplacePlugin(); });

  it('has correct metadata', () => {
    expect(plugin.id).toBe('marketplace');
    expect(plugin.supportedIntents).toContain('marketplace:browse');
    expect(plugin.supportedIntents).toContain('marketplace:install');
  });

  it('canHandle recognizes marketplace requests', async () => {
    expect(await plugin.canHandle('marketplace', browserCtx)).toBe(true);
    expect(await plugin.canHandle('zainstaluj plugin', browserCtx)).toBe(true);
    expect(await plugin.canHandle('lista pluginów', browserCtx)).toBe(true);
    expect(await plugin.canHandle('szukaj plugin bandwidth', browserCtx)).toBe(true);
    expect(await plugin.canHandle('odinstaluj plugin', browserCtx)).toBe(true);
    expect(await plugin.canHandle('jaka pogoda', browserCtx)).toBe(false);
  });

  describe('browse catalog', () => {
    it('lists all available plugins', async () => {
      const result = await plugin.execute('marketplace', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Plugin Marketplace');
      expect(result.content[0].data).toContain('UPnP Scanner');
      expect(result.content[0].data).toContain('Bandwidth Monitor');
      expect(result.content[0].data).toContain('DNS Lookup');
    });
  });

  describe('search', () => {
    it('finds plugins by name', async () => {
      const result = await plugin.execute('szukaj plugin dns', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('DNS Lookup');
    });

    it('finds plugins by tag', async () => {
      const result = await plugin.execute('wyszukaj plugin monitoring', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Bandwidth Monitor');
    });

    it('returns empty for nonexistent plugin', async () => {
      const result = await plugin.execute('szukaj plugin nonexistent_xyz', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Nie znaleziono');
    });
  });

  describe('install', () => {
    it('installs a plugin by name', async () => {
      const result = await plugin.execute('zainstaluj plugin UPnP', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('zainstalowany');
      expect(result.content[0].data).toContain('UPnP Scanner');
    });

    it('returns error for unknown plugin', async () => {
      const result = await plugin.execute('zainstaluj plugin nonexistent', browserCtx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('Nie znaleziono');
    });

    it('persists to scope registry', async () => {
      await plugin.execute('zainstaluj plugin bandwidth', browserCtx);
      const remotes = scopeRegistry.getRemotePlugins('local');
      expect(remotes.some(p => p.id === 'community-bandwidth-monitor')).toBe(true);
    });
  });

  describe('uninstall', () => {
    it('uninstalls previously installed plugin', async () => {
      // Install first
      await plugin.execute('zainstaluj plugin UPnP', browserCtx);
      // Uninstall
      const result = await plugin.execute('odinstaluj plugin UPnP', browserCtx);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('odinstalowany');
    });

    it('returns error for non-installed plugin', async () => {
      const result = await plugin.execute('odinstaluj plugin nonexistent', browserCtx);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('Nie znaleziono');
    });
  });
});

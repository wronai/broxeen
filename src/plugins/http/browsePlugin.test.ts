/**
 * HTTP Browse Plugin Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpBrowsePlugin } from './browsePlugin';
import type { PluginContext } from '../../core/types';

// Mock dependencies
vi.mock('../../lib/browseGateway', () => ({
  executeBrowseCommand: vi.fn(),
}));

vi.mock('../../lib/resolver', () => ({
  resolve: vi.fn(),
}));

describe('HttpBrowsePlugin', () => {
  let plugin: HttpBrowsePlugin;
  let mockContext: PluginContext;

  beforeEach(() => {
    plugin = new HttpBrowsePlugin();
    mockContext = {
      isTauri: false,
      tauriInvoke: vi.fn(),
    };
  });

  it('should have correct plugin metadata', () => {
    expect(plugin.id).toBe('http-browse');
    expect(plugin.name).toBe('HTTP Browse');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.supportedIntents).toEqual(['browse:url', 'search:web']);
  });

  it('should handle URL inputs', async () => {
    const canHandle = await plugin.canHandle('https://example.com', mockContext);
    expect(canHandle).toBe(true);
  });

  it('should handle domain inputs', async () => {
    const canHandle = await plugin.canHandle('www.onet.pl', mockContext);
    expect(canHandle).toBe(true);
  });

  it('should handle search queries', async () => {
    const canHandle = await plugin.canHandle('wyszukaj informacje o React', mockContext);
    expect(canHandle).toBe(true);
  });

  it('should execute browse command for URLs', async () => {
    const { executeBrowseCommand } = await import('../../lib/browseGateway');
    const { resolve } = await import('../../lib/resolver');
    
    vi.mocked(resolve).mockReturnValue({
      url: 'https://example.com',
      suggestions: [],
      resolveType: 'exact',
      needsClarification: false,
      normalizedInput: 'https://example.com',
    });
    
    vi.mocked(executeBrowseCommand).mockResolvedValue({
      url: 'https://example.com',
      title: 'Example Page',
      content: 'Example content',
      resolve_type: 'exact',
    });

    const result = await plugin.execute('https://example.com', mockContext);

    expect(result.status).toBe('success');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].data).toBe('Example content');
    expect(result.content[0].title).toBe('Example Page');
    expect(result.metadata?.url).toBe('https://example.com');
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should execute search command for queries', async () => {
    const { executeBrowseCommand } = await import('../../lib/browseGateway');
    const { resolve } = await import('../../lib/resolver');
    
    vi.mocked(resolve).mockReturnValue({
      url: 'https://duckduckgo.com/html/?q=React+tutorial',
      suggestions: [],
      resolveType: 'search',
      needsClarification: false,
      normalizedInput: 'wyszukaj React tutorial',
    });
    
    vi.mocked(executeBrowseCommand).mockResolvedValue({
      url: 'https://duckduckgo.com/html/?q=React+tutorial',
      title: 'React tutorial - DuckDuckGo search',
      content: 'Search results for React tutorial',
      resolve_type: 'search',
    });

    const result = await plugin.execute('wyszukaj React tutorial', mockContext);

    expect(result.status).toBe('success');
    expect(result.content[0].title).toBe('React tutorial - DuckDuckGo search');
    expect(result.metadata?.resolveType).toBe('search');
  });

  it('should handle execution errors gracefully', async () => {
    const { executeBrowseCommand } = await import('../../lib/browseGateway');
    const { resolve } = await import('../../lib/resolver');
    
    vi.mocked(resolve).mockReturnValue({
      url: 'https://example.com',
      suggestions: [],
      resolveType: 'exact',
      needsClarification: false,
      normalizedInput: 'https://example.com',
    });
    
    vi.mocked(executeBrowseCommand).mockRejectedValue(
      new Error('Network error')
    );

    const result = await plugin.execute('https://example.com', mockContext);

    expect(result.status).toBe('error');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].data).toContain('Błąd podczas przeglądania');
    expect(result.metadata?.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should initialize and dispose correctly', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    await plugin.initialize(mockContext);
    expect(consoleSpy).toHaveBeenCalledWith('HttpBrowsePlugin initialized');
    
    await plugin.dispose();
    expect(consoleSpy).toHaveBeenCalledWith('HttpBrowsePlugin disposed');
    
    consoleSpy.mockRestore();
  });
});

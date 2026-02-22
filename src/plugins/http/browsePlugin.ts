/**
 * HTTP Browse Plugin - handles web browsing and content extraction
 * Replaces browseGateway.ts functionality with plugin architecture
 */

import type { Plugin, PluginResult, PluginContext, PluginContentBlock } from '../../core/types';

export class HttpBrowsePlugin implements Plugin {
  readonly id = 'http-browse';
  readonly name = 'HTTP Browse';
  readonly version = '1.0.0';
  readonly supportedIntents = ['browse:url', 'search:web'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    // If scope is local, only handle explicit URLs, not search queries
    if (context.scope === 'local') {
      // For local scope, only handle if it's an explicit URL
      // Don't handle search queries like "wyszukaj" or "znajdź"
      return input.match(/^(https?:\/\/[^\s]+|www\.[a-z0-9-]+\.[a-z]{2,})/i) !== null;
    }

    // For internet scope, handle general web browsing and search queries
    return this.supportedIntents.some(intent => 
      input.match(/https?:\/\/[^\s]+/) || 
      input.match(/^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i) ||
      input.toLowerCase().includes('wyszukaj') ||
      input.toLowerCase().includes('znajdź')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();

    try {
      // Check if scope is local - if so, don't browse the internet
      if (context.scope === 'local') {
        return {
          pluginId: this.id,
          status: 'error',
          content: [
            {
              type: 'text',
              data: 'Przeszukiwanie internetu nie jest dostępne w zakresie "Sieć lokalna". Zmień zakres na "Internet", aby wyszukać w sieci.',
              title: 'Ograniczenie zakresu'
            }
          ],
          metadata: {
            duration_ms: Date.now() - startTime,
            cached: false,
            truncated: false,
            executionTime: Date.now() - startTime,
            scope: context.scope,
          },
        };
      }

      // Use existing browseGateway logic for non-local scopes
      const { executeBrowseCommand } = await import('../../lib/browseGateway');
      
      // Resolve URL using existing resolver
      const { resolve } = await import('../../lib/resolver');
      const resolved = resolve(input);
      
      let url: string;
      if (resolved.resolveType === 'exact' || resolved.resolveType === 'fuzzy') {
        url = resolved.url || 'https://example.com';
      } else {
        // For search queries, use DuckDuckGo
        const query = encodeURIComponent(input);
        url = `https://duckduckgo.com/html/?q=${query}`;
      }

      // Execute browse using existing gateway
      const result = await executeBrowseCommand(url);
      
      return {
        pluginId: this.id,
        status: 'success',
        content: [
          {
            type: 'text',
            data: result.content,
            title: result.title,
          }
        ],
        metadata: {
          duration_ms: Date.now() - startTime,
          cached: false,
          truncated: false,
          url: result.url,
          resolveType: resolved.resolveType,
          executionTime: Date.now() - startTime,
          scope: context.scope,
        },
      };

    } catch (error) {
      console.error('HttpBrowsePlugin execution failed:', error);
      
      return {
        pluginId: this.id,
        status: 'error',
        content: [
          {
            type: 'text',
            data: `Błąd podczas przeglądania: ${error instanceof Error ? error.message : String(error)}`,
          }
        ],
        metadata: {
          duration_ms: Date.now() - startTime,
          cached: false,
          truncated: false,
          executionTime: Date.now() - startTime,
          scope: context.scope,
        },
      };
    }
  }

  async initialize(context: PluginContext): Promise<void> {
    console.log('HttpBrowsePlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('HttpBrowsePlugin disposed');
  }
}

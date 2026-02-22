/**
 * HTTP Browse Plugin - handles web browsing and content extraction
 * Replaces browseGateway.ts functionality with plugin architecture
 */

import type { Plugin, PluginResult, PluginContext } from '../../core/types';

export class HttpBrowsePlugin implements Plugin {
  readonly id = 'http-browse';
  readonly name = 'HTTP Browse';
  readonly version = '1.0.0';
  readonly supportedIntents = ['browse:url', 'search:web'];

  private isLanUrl(url: string): boolean {
    return /https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|localhost|127\.0\.)/.test(url);
  }

  private extractUrlFromInput(input: string): string | null {
    const match = input.match(/https?:\/\/[^\s]+/i);
    if (!match) return null;
    return this.sanitizeExtractedUrl(match[0]);
  }

  private sanitizeExtractedUrl(url: string): string {
    let clean = url.trim();

    // Drop common trailing punctuation from chat commands (e.g. "...146:", "...146).")
    while (/["'`\)\],;.!?]$/.test(clean)) {
      clean = clean.slice(0, -1);
    }

    // Trim dangling host separator with no port
    while (clean.endsWith(':')) {
      clean = clean.slice(0, -1);
    }

    return clean;
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    if (context.scope === 'local') {
      // In local scope only allow LAN IP / localhost URLs
      return this.isLanUrl(input);
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
    const explicitUrl = this.extractUrlFromInput(input);

    try {
      // In local scope block public internet URLs (LAN is allowed by canHandle)
      if (context.scope === 'local' && !this.isLanUrl(explicitUrl ?? input)) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [
            {
              type: 'text',
              data: 'Publiczne adresy internetowe są zablokowane w zakresie "Sieć lokalna". Zmień zakres na "Internet", aby przeglądać sieć.',
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

      // Use existing browseGateway logic
      const { executeBrowseCommand } = await import('../../lib/browseGateway');

      let url: string;
      let resolveType = 'exact';

      if (explicitUrl) {
        // Direct URL command: bypass generic resolver/search fallback.
        url = explicitUrl;
      } else {
        // Resolve non-URL input using existing resolver
        const { resolve } = await import('../../lib/resolver');
        const resolved = resolve(input);
        resolveType = resolved.resolveType;

        if (resolved.resolveType === 'exact' || resolved.resolveType === 'fuzzy') {
          url = resolved.url || 'https://example.com';
        } else {
          // For search queries, use DuckDuckGo
          const query = encodeURIComponent(input);
          url = `https://duckduckgo.com/html/?q=${query}`;
          resolveType = 'search';
        }
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
          resolveType,
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

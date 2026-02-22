/**
 * Chat LLM Plugin - handles general chat and LLM conversations
 */

import type { Plugin, PluginResult, PluginContext, PluginContentBlock } from '../../core/types';

export class ChatLlmPlugin implements Plugin {
  readonly id = 'chat-llm';
  readonly name = 'Chat LLM';
  readonly version = '1.0.0';
  readonly supportedIntents = ['chat:ask'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    // This is the fallback plugin - can handle any input
    return true;
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const startTime = Date.now();

    try {
      // Check if scope is local and this looks like an internet search query
      if (context.scope === 'local') {
        const isSearchQuery = input.toLowerCase().includes('wyszukaj') || 
                             input.toLowerCase().includes('znajdź') ||
                             input.toLowerCase().includes('szukaj') ||
                             input.length < 20; // Short queries are often searches
        
        if (isSearchQuery) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [
              {
                type: 'text',
                data: 'Wyszukiwanie w internecie nie jest dostępne w zakresie "Sieć lokalna". Zmień zakres na "Internet", aby wyszukać w sieci, lub spróbuj bardziej szczegółowe zapytanie.',
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
      }

      // Use existing LLM client for now
      const llmModule = await import('../../lib/llmClient');
      
      // Check if LLM is available
      const config = llmModule.getConfig();
      if (!config.apiKey) {
        return {
        pluginId: this.id,
        status: 'error',
        content: [
          {
            type: 'text',
            data: 'LLM nie jest dostępny. Sprawdź konfigurację klucza API.',
          }
        ],
        metadata: {
          duration_ms: Date.now() - startTime,
          cached: false,
          truncated: false,
          executionTime: Date.now() - startTime, // Legacy compatibility
          scope: context.scope,
        },
      };
      }

      // Generate response
      const response = await llmModule.chat([
        { role: 'user', content: input }
      ]);
      
      return {
        pluginId: this.id,
        status: 'success',
        content: [
          {
            type: 'text',
            data: response.text,
          }
        ],
        metadata: {
          duration_ms: Date.now() - startTime,
          cached: false,
          truncated: false,
          executionTime: Date.now() - startTime, // Legacy compatibility
          scope: context.scope,
        },
      };

    } catch (error) {
      console.error('ChatLlmPlugin execution failed:', error);
      
      return {
        pluginId: this.id,
        status: 'error',
        content: [
          {
            type: 'text',
            data: `Błąd podczas generowania odpowiedzi: ${error instanceof Error ? error.message : String(error)}`,
          }
        ],
        metadata: {
          duration_ms: Date.now() - startTime,
          cached: false,
          truncated: false,
          executionTime: Date.now() - startTime, // Legacy compatibility
          scope: context.scope,
        },
      };
    }
  }

  async initialize(context: PluginContext): Promise<void> {
    console.log('ChatLlmPlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('ChatLlmPlugin disposed');
  }
}

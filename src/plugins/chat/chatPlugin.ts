/**
 * Chat LLM Plugin - handles general chat and LLM conversations.
 * Injects system context (OS, runtime, capabilities) so LLM responses
 * are actionable and specific to the user's environment.
 */

import type { Plugin, PluginResult, PluginContext, PluginContentBlock } from '../../core/types';
import { buildSystemContextPrompt } from '../../core/systemContext';

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

      // Build system-aware prompt so LLM knows the OS, runtime, and capabilities
      const systemPrompt =
        `Jesteś asystentem systemu Broxeen — inteligentnego monitora sieci, kamer i plików.\n` +
        `Odpowiadaj po polsku, zwięźle i konkretnie.\n` +
        `Jeśli użytkownik prosi o wykonanie akcji (pliki, sieć, system) — zaproponuj GOTOWĄ komendę lub WYKONAJ akcję, NIE dawaj poradników dla wielu systemów.\n` +
        `Jeśli system ma dostępną funkcję (np. wyszukiwanie plików) — zasugeruj jej użycie przez chat.\n\n` +
        buildSystemContextPrompt();

      const response = await llmModule.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
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

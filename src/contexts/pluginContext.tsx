/**
 * @module contexts/PluginContext
 * @description React context providing access to plugin system.
 *
 * Sits alongside existing CqrsContext:
 * - CqrsContext: event store, aggregate, domain commands
 * - PluginContext: plugin registry, intent router, data sources
 *
 * Components consume via usePlugins() hook.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppContext } from "../core/bootstrap";
import type {
  Plugin,
  PluginResult,
} from "../core/types";
import type { DataSourcePlugin, PluginQuery, PluginResult as NewPluginResult } from "../core/plugin.types";
import type { IntentDetection } from "../core/types";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";
import { configStore } from "../config/configStore";

// ─── Context Value ──────────────────────────────────────────

interface PluginContextValue {
  /** Detect intent from user input */
  detectIntent: (rawInput: string) => Promise<IntentDetection>;

  /** Route a query through the plugin system */
  executeCommand: <T>(command: string, payload?: T) => Promise<unknown>;

  /** Shorthand: detect intent + route to plugin */
  ask: (
    rawInput: string,
    source?: "voice" | "text" | "api",
    scope?: string
  ) => Promise<PluginResult>;

  /** List all registered plugins */
  plugins: (Plugin | DataSourcePlugin)[];

  /** Check if a specific plugin is registered */
  hasPlugin: (pluginId: string) => boolean;
}

const PluginCtx = createContext<PluginContextValue | null>(null);

// ─── Provider ───────────────────────────────────────────────

interface PluginProviderProps {
  context: AppContext;
  children: ReactNode;
}

export function PluginProvider({ context, children }: PluginProviderProps) {
  const value = useMemo<PluginContextValue>(
    () => ({
      detectIntent: (rawInput) => context.intentRouter.detect(rawInput),

      executeCommand: <T,>(command: string, payload?: T) => 
        context.commandBus.execute(command, payload),

      ask: async (rawInput, source = "text", scope = "local") => {
        const intent = await context.intentRouter.detect(rawInput);
        const plugin = context.intentRouter.route(intent.intent, scope);
        
        if (!plugin) {
          // Fallback: generate action suggestions instead of throwing
          const { generateFallback } = await import('../core/fallbackHandler');
          const fallback = await generateFallback({
            query: rawInput,
            detectedIntent: intent.intent,
            scope,
          });
          return {
            pluginId: 'fallback',
            status: 'success' as const,
            content: [{ type: 'text' as const, data: fallback.text }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false,
              configPrompt: fallback.configPrompt,
            },
          };
        }

        // Handle both Plugin and DataSourcePlugin
        const runtimeIsTauri = isTauriRuntime();
        const pluginContext = {
          isTauri: runtimeIsTauri,
          tauriInvoke: runtimeIsTauri ? invoke : undefined,
          scope, // Pass scope to plugin context
          databaseManager: context.databaseManager,
        };

        // Check if it's a DataSourcePlugin (new API) or Plugin (old API)
        if ('execute' in plugin && 'capabilities' in plugin) {
          // DataSourcePlugin - create PluginQuery
          const query = {
            intent: intent.intent,
            rawInput,
            params: { ...intent.entities, scope }, // Include scope in params
            metadata: {
              timestamp: Date.now(),
              source,
              locale: configStore.get<string>('locale.locale'),
              scope // Include scope in metadata
            }
          };
          const result = await plugin.execute(query);
          
          // Convert NewPluginResult to legacy PluginResult for compatibility
          return {
            pluginId: plugin.id,
            status: result.status,
            content: result.content.map(block => ({
              type: block.type === 'html' ? 'text' : block.type,
              data: block.data,
              title: block.title,
              mimeType: block.mimeType
            })),
            metadata: {
              ...result.metadata,
              duration_ms: result.metadata.duration_ms,
              source_url: result.metadata.source_url,
              cached: result.metadata.cached,
              truncated: result.metadata.truncated
            }
          };
        } else {
          // Legacy Plugin - use old API
          return await plugin.execute(rawInput, pluginContext);
        }
      },

      plugins: context.pluginRegistry.getAll(),

      hasPlugin: (pluginId) => !!context.pluginRegistry.get(pluginId),
    }),
    [context],
  );

  return <PluginCtx.Provider value={value}>{children}</PluginCtx.Provider>;
}

// ─── Hook ───────────────────────────────────────────────────

export function usePlugins(): PluginContextValue {
  const ctx = useContext(PluginCtx);
  if (!ctx) {
    throw new Error("usePlugins must be used within <PluginProvider>");
  }
  return ctx;
}

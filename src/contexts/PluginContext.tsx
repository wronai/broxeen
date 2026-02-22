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
  DataSourcePlugin,
  IntentName,
  PluginQuery,
  PluginResult,
} from "../core/plugin.types";
import { buildQuery } from "../core/intentRouter";

// ─── Context Value ──────────────────────────────────────────

interface PluginContextValue {
  /** Detect intent from user input */
  detectIntent: (rawInput: string) => Promise<IntentName>;

  /** Route a query through the plugin system */
  routeQuery: (query: PluginQuery) => Promise<PluginResult>;

  /** Shorthand: detect intent + build query + route */
  ask: (
    rawInput: string,
    source?: "voice" | "text" | "api",
    resolvedTarget?: string,
  ) => Promise<PluginResult>;

  /** List all registered plugins */
  plugins: readonly DataSourcePlugin[];

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
      detectIntent: (rawInput) => context.router.detectIntent(rawInput),

      routeQuery: (query) => context.router.route(query),

      ask: async (rawInput, source = "text", resolvedTarget) => {
        const intent = await context.router.detectIntent(rawInput);
        const query = buildQuery(intent, rawInput, {
          resolvedTarget,
          metadata: {
            timestamp: Date.now(),
            source,
            locale: "pl-PL",
          },
        });
        return context.router.route(query);
      },

      plugins: context.registry.listAll(),

      hasPlugin: (pluginId) => !!context.registry.get(pluginId),
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

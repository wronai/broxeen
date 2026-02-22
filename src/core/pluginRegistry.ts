/**
 * @module core/pluginRegistry
 * @description Central registry for all data source plugins.
 *
 * Responsibilities (SRP):
 * - Store plugin instances
 * - Resolve plugins by ID or intent
 * - Emit lifecycle events
 * - Initialize/dispose plugins
 *
 * Does NOT:
 * - Detect intents (that's IntentRouter)
 * - Execute queries (that's the plugin itself)
 * - Manage UI state (that's React hooks)
 */

import type {
  DataSourcePlugin,
  IPluginRegistry,
  IntentName,
  PluginEvent,
  PluginEventHandler,
  PluginEventType,
  PluginId,
} from "./plugin.types";

export class PluginRegistry implements IPluginRegistry {
  private plugins = new Map<PluginId, DataSourcePlugin>();
  private eventHandlers = new Set<PluginEventHandler>();

  // ── Registration ──────────────────────────────────────────

  register(plugin: DataSourcePlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(
        `Plugin "${plugin.id}" is already registered. ` +
        `Unregister it first or use a different ID.`,
      );
    }

    this.plugins.set(plugin.id, plugin);
    this.emit("plugin:registered", plugin.id);
  }

  unregister(pluginId: PluginId): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    this.plugins.delete(pluginId);
    this.emit("plugin:disposed", pluginId);
  }

  // ── Lookup ────────────────────────────────────────────────

  get(pluginId: PluginId): DataSourcePlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Find all plugins that handle a given intent, sorted by priority (desc).
   * This enables fallback chains: if the first plugin fails, try the next.
   */
  getForIntent(intent: IntentName): DataSourcePlugin[] {
    return Array.from(this.plugins.values())
      .filter((p) => p.capabilities.intents.includes(intent))
      .sort((a, b) => b.capabilities.priority - a.capabilities.priority);
  }

  /**
   * Get plugins compatible with current runtime.
   */
  getAvailableForIntent(intent: IntentName, isTauri: boolean): DataSourcePlugin[] {
    return this.getForIntent(intent).filter((p) => {
      if (!isTauri && !p.capabilities.browserCompatible) return false;
      return true;
    });
  }

  listAll(): readonly DataSourcePlugin[] {
    return Array.from(this.plugins.values());
  }

  get size(): number {
    return this.plugins.size;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Initialize all registered plugins.
   * Failures are isolated — one plugin failing doesn't block others.
   */
  async initializeAll(): Promise<Map<PluginId, Error | null>> {
    const results = new Map<PluginId, Error | null>();

    const tasks = Array.from(this.plugins.entries()).map(
      async ([id, plugin]) => {
        try {
          await plugin.initialize();
          this.emit("plugin:initialized", id);
          results.set(id, null);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.emit("plugin:error", id, { error: error.message });
          results.set(id, error);
        }
      },
    );

    await Promise.allSettled(tasks);
    return results;
  }

  /**
   * Dispose all plugins gracefully.
   */
  async disposeAll(): Promise<void> {
    const tasks = Array.from(this.plugins.entries()).map(
      async ([id, plugin]) => {
        try {
          await plugin.dispose();
          this.emit("plugin:disposed", id);
        } catch {
          // Best-effort cleanup, don't throw
        }
      },
    );

    await Promise.allSettled(tasks);
    this.plugins.clear();
  }

  // ── Events ────────────────────────────────────────────────

  onPluginEvent(handler: PluginEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  private emit(type: PluginEventType, pluginId: PluginId, data?: unknown): void {
    const event: PluginEvent = {
      type,
      pluginId,
      timestamp: Date.now(),
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Observer errors don't propagate
      }
    }
  }
}

// ── Singleton (DI-friendly — can also be instantiated directly) ──

let defaultRegistry: PluginRegistry | null = null;

export function getDefaultRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry();
  }
  return defaultRegistry;
}

/** For testing — reset the singleton */
export function resetDefaultRegistry(): void {
  defaultRegistry = null;
}

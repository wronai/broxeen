/**
 * Plugin Registry - manages plugin lifecycle and discovery
 */

import type { Plugin, PluginRegistry as IPluginRegistry, DataSourcePlugin } from './types';

export class PluginRegistry implements IPluginRegistry {
  private plugins = new Map<string, Plugin>();
  private dataSourcePlugins = new Map<string, DataSourcePlugin>();

  register(plugin: Plugin | DataSourcePlugin): void {
    const pluginId = plugin.id;
    
    if (this.plugins.has(pluginId) || this.dataSourcePlugins.has(pluginId)) {
      throw new Error(`Plugin ${pluginId} is already registered`);
    }
    
    // Check if it's a new DataSourcePlugin or legacy Plugin
    if ('capabilities' in plugin && 'initialize' in plugin) {
      this.dataSourcePlugins.set(pluginId, plugin as DataSourcePlugin);
      console.log(`DataSourcePlugin registered: ${plugin.name}`);
    } else {
      this.plugins.set(pluginId, plugin as Plugin);
      console.log(`Legacy Plugin registered: ${(plugin as Plugin).name} v${(plugin as Plugin).version}`);
    }
  }

  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId) || this.dataSourcePlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    // Clean up resources
    if ('dispose' in plugin && typeof plugin.dispose === 'function') {
      plugin.dispose().catch(console.error);
    }
    
    // Remove from appropriate registry
    this.plugins.delete(pluginId);
    this.dataSourcePlugins.delete(pluginId);
    console.log(`Plugin unregistered: ${pluginId}`);
  }

  get(pluginId: string): Plugin | DataSourcePlugin | null {
    return this.plugins.get(pluginId) || this.dataSourcePlugins.get(pluginId) || null;
  }

  getAll(): (Plugin | DataSourcePlugin)[] {
    return [...Array.from(this.plugins.values()), ...Array.from(this.dataSourcePlugins.values())];
  }

  findByIntent(intent: string): (Plugin | DataSourcePlugin)[] {
    const legacyPlugins = Array.from(this.plugins.values()).filter(plugin =>
      plugin.supportedIntents && plugin.supportedIntents.includes(intent)
    );
    
    const dataSourcePlugins = Array.from(this.dataSourcePlugins.values()).filter(plugin =>
      plugin.capabilities && plugin.capabilities.intents && plugin.capabilities.intents.includes(intent as any)
    );
    
    return [...legacyPlugins, ...dataSourcePlugins];
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAll(context: import('./types').PluginContext): Promise<void> {
    const legacyInitPromises = Array.from(this.plugins.values())
      .filter(plugin => plugin.initialize)
      .map(plugin => plugin.initialize!(context));
    
    const dataSourceInitPromises = Array.from(this.dataSourcePlugins.values())
      .map(plugin => plugin.initialize());
    
    await Promise.allSettled([...legacyInitPromises, ...dataSourceInitPromises]);
  }

  /**
   * Dispose all plugins
   */
  async disposeAll(): Promise<void> {
    const legacyDisposePromises = Array.from(this.plugins.values())
      .filter(plugin => plugin.dispose)
      .map(plugin => plugin.dispose!());
    
    const dataSourceDisposePromises = Array.from(this.dataSourcePlugins.values())
      .map(plugin => plugin.dispose());
    
    await Promise.allSettled([...legacyDisposePromises, ...dataSourceDisposePromises]);
    this.plugins.clear();
    this.dataSourcePlugins.clear();
  }
}

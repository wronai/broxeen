/**
 * Plugin Registry - manages plugin lifecycle and discovery
 */

import type { Plugin, PluginRegistry as IPluginRegistry } from './types';

export class PluginRegistry implements IPluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin ${plugin.id} is already registered`);
    }
    
    this.plugins.set(plugin.id, plugin);
    console.log(`Plugin registered: ${plugin.name} v${plugin.version}`);
  }

  unregister(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    
    if (plugin.dispose) {
      plugin.dispose().catch(console.error);
    }
    
    this.plugins.delete(pluginId);
    console.log(`Plugin unregistered: ${pluginId}`);
  }

  get(pluginId: string): Plugin | null {
    return this.plugins.get(pluginId) || null;
  }

  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  findByIntent(intent: string): Plugin[] {
    return Array.from(this.plugins.values()).filter(plugin =>
      plugin.supportedIntents.includes(intent)
    );
  }

  /**
   * Initialize all registered plugins
   */
  async initializeAll(context: import('./types').PluginContext): Promise<void> {
    const initPromises = Array.from(this.plugins.values())
      .filter(plugin => plugin.initialize)
      .map(plugin => plugin.initialize!(context));
    
    await Promise.allSettled(initPromises);
  }

  /**
   * Dispose all plugins
   */
  async disposeAll(): Promise<void> {
    const disposePromises = Array.from(this.plugins.values())
      .filter(plugin => plugin.dispose)
      .map(plugin => plugin.dispose!());
    
    await Promise.allSettled(disposePromises);
    this.plugins.clear();
  }
}

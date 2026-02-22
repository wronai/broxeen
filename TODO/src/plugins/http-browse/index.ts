/**
 * @module plugins/http-browse
 * @description Plugin registration entry point.
 *
 * Usage:
 *   import { registerHttpBrowsePlugin } from "./plugins/http-browse";
 *   registerHttpBrowsePlugin(registry);
 */

import type { PluginRegistry } from "../../core/pluginRegistry";
import {
  HttpBrowsePlugin,
  TauriFetchStrategy,
  type HttpBrowsePluginOptions,
} from "./httpBrowsePlugin";

export { HttpBrowsePlugin } from "./httpBrowsePlugin";
export type { FetchStrategy, ContentExtractor } from "./httpBrowsePlugin";

/**
 * Register the HTTP Browse plugin with optional Tauri support.
 */
export function registerHttpBrowsePlugin(
  registry: PluginRegistry,
  options: HttpBrowsePluginOptions & {
    tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  } = {},
): HttpBrowsePlugin {
  const plugin = new HttpBrowsePlugin(options);

  // If running in Tauri, add native fetch strategy (highest priority)
  if (options.tauriInvoke) {
    plugin.addStrategy(new TauriFetchStrategy(options.tauriInvoke));
  }

  registry.register(plugin);
  return plugin;
}

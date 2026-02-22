/**
 * @module plugins/discovery
 */

import type { PluginRegistry } from "../../core/pluginRegistry";
import type { DeviceRepository } from "../../persistence/deviceRepository";
import {
  NetworkScannerPlugin,
  TauriScannerBackend,
  BrowserScannerBackend,
  type NetworkScannerOptions,
} from "./networkScanner";

export { NetworkScannerPlugin } from "./networkScanner";
export type { ScannerBackend, DiscoveredHost, ProbeResult, ServiceProbe } from "./networkScanner";

export function registerDiscoveryPlugin(
  registry: PluginRegistry,
  deviceRepo: DeviceRepository,
  options: {
    tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    defaultSubnet?: string;
  } = {},
): NetworkScannerPlugin {
  const backend = options.tauriInvoke
    ? new TauriScannerBackend(options.tauriInvoke)
    : new BrowserScannerBackend();

  const plugin = new NetworkScannerPlugin({
    backend,
    deviceRepo,
    pluginRegistry: registry,
    defaultSubnet: options.defaultSubnet,
  });

  registry.register(plugin);
  return plugin;
}

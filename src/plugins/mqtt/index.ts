/**
 * @module plugins/mqtt
 */

import type { PluginRegistry } from "../../core/pluginRegistry";
import { MqttPlugin, type MqttClientAdapter, type MqttConfig } from "./mqttPlugin";

export { MqttPlugin } from "./mqttPlugin";
export type { MqttConfig, MqttClientAdapter } from "./mqttPlugin";

export function registerMqttPlugin(
  registry: PluginRegistry,
  config: MqttConfig,
  client: MqttClientAdapter,
): MqttPlugin {
  const plugin = new MqttPlugin(config, client);
  registry.register(plugin);
  return plugin;
}

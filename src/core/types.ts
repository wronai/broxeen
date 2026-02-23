/**
 * Core plugin interfaces and types for Broxeen v2
 * Provides extensible architecture for multiple data sources
 */

import type { DataSourcePlugin, PluginResult as NewPluginResult, ContentBlock } from './plugin.types';

export type { DataSourcePlugin } from './plugin.types';

// Re-export for backward compatibility
export type { ContentBlock as PluginContentBlock } from './plugin.types';

// Legacy exports for compatibility
export type PluginResult = NewPluginResult;

export interface PluginContext {
  isTauri: boolean;
  tauriInvoke?: (command: string, args?: any) => Promise<any>;
  cameras?: CameraConfig[];
  mqtt?: MqttConfig;
  describeImage?: (imageUrl: string) => Promise<string>;
  scope?: string; // Add scope to plugin context
  databaseManager?: import('../persistence/databaseManager').DatabaseManager;
  eventStore?: import('../domain/eventStore').EventStore;
}

export interface CameraConfig {
  id: string;
  name: string;
  snapshotUrl?: string;
  rtspUrl?: string;
  location?: string;
}

export interface MqttConfig {
  config: {
    brokerUrl: string;
    topics: string[];
    topicLabels?: Record<string, string>;
  };
  client: MqttAdapter;
}

export interface MqttAdapter {
  connect(url: string): Promise<void>;
  subscribe(topic: string): Promise<void>;
  publish(topic: string, payload: string): Promise<void>;
  getLastValue(topic: string): unknown;
  disconnect(): Promise<void>;
}

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedIntents: string[];
  
  /**
   * Check if plugin can handle the given input
   */
  canHandle(input: string, context: PluginContext): Promise<boolean>;
  
  /**
   * Execute plugin logic
   */
  execute(input: string, context: PluginContext): Promise<PluginResult>;
  
  /**
   * Plugin lifecycle - optional
   */
  initialize?(context: PluginContext): Promise<void>;
  dispose?(): Promise<void>;
}

export interface IntentDetection {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
}

export interface IntentRouter {
  detect(input: string): Promise<IntentDetection>;
  route(intent: string, scope?: string): Plugin | DataSourcePlugin | null;
}

export interface PluginRegistry {
  register(plugin: Plugin | DataSourcePlugin): void;
  unregister(pluginId: string): void;
  get(pluginId: string): Plugin | DataSourcePlugin | null;
  getAll(): (Plugin | DataSourcePlugin)[];
  findByIntent(intent: string): (Plugin | DataSourcePlugin)[];
}

export interface CommandBus {
  execute<T>(command: string, payload?: T): Promise<unknown>;
  register<T>(command: string, handler: (payload: T) => Promise<unknown>): void;
  unregister(command: string): void;
}

export interface AppContext {
  pluginRegistry: PluginRegistry;
  intentRouter: IntentRouter;
  commandBus: CommandBus;
  databaseManager: import('../persistence/databaseManager').DatabaseManager;
  eventStore: import('../domain/eventStore').EventStore;
  autoScanScheduler: import('../plugins/discovery/autoScanScheduler').AutoScanScheduler | null;
  dispose(): Promise<void>;
  tauriInvoke?: (command: string, args?: unknown) => Promise<unknown>;
}

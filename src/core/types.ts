/**
 * Core plugin interfaces and types for Broxeen v2
 * Provides extensible architecture for multiple data sources
 */

export interface PluginResult {
  status: 'success' | 'error' | 'partial';
  content: PluginContentBlock[];
  metadata?: Record<string, unknown>;
  executionTime?: number;
}

export interface PluginContentBlock {
  type: 'text' | 'image' | 'audio' | 'video' | 'data';
  data: string | unknown;
  title?: string;
  mimeType?: string;
}

export interface PluginContext {
  isTauri: boolean;
  tauriInvoke?: (command: string, args?: unknown) => Promise<unknown>;
  cameras?: CameraConfig[];
  mqtt?: MqttConfig;
  describeImage?: (imageUrl: string) => Promise<string>;
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
  route(intent: string): Plugin | null;
}

export interface PluginRegistry {
  register(plugin: Plugin): void;
  unregister(pluginId: string): void;
  get(pluginId: string): Plugin | null;
  getAll(): Plugin[];
  findByIntent(intent: string): Plugin[];
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
  dispose(): Promise<void>;
}

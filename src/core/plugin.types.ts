/**
 * @module core/plugin.types
 * @description Plugin architecture type definitions for Broxeen.
 *
 * Design principles:
 * - ISP: Small, focused interfaces (not one mega-interface)
 * - OCP: New data sources = new plugin, zero modification to core
 * - DIP: All consumers depend on abstractions, not implementations
 * - LSP: Any plugin can substitute another for the same intent
 */

// ─── Identifiers ────────────────────────────────────────────

/** Unique plugin identifier, e.g. "http-browse", "mqtt", "rtsp-camera" */
export type PluginId = string;

/** Intent name detected from user input, e.g. "browse", "ask-camera", "iot-read" */
export type IntentName = string;

// ─── Data Flow Types ────────────────────────────────────────

/** Unified query that flows through the system */
export interface PluginQuery {
  readonly intent: IntentName;
  readonly rawInput: string;
  readonly resolvedTarget?: string;  // URL, topic path, camera ID, etc.
  readonly params: Readonly<Record<string, unknown>>;
  readonly metadata: QueryMetadata;
}

export interface QueryMetadata {
  readonly timestamp: number;
  readonly source: "voice" | "text" | "api";
  readonly sessionId?: string;
  readonly locale: string;
}

/** Unified result returned by any plugin */
export interface PluginResult {
  readonly pluginId: PluginId;
  readonly status: "success" | "partial" | "error";
  readonly content: ContentBlock[];
  readonly metadata: ResultMetadata;
}

export interface ContentBlock {
  readonly type: "text" | "html" | "image" | "stream" | "structured";
  readonly data: string;
  readonly mimeType?: string;
  readonly title?: string;
  readonly summary?: string; // Short version for TTS
}

export interface ResultMetadata {
  readonly duration_ms: number;
  readonly source_url?: string;
  readonly cached: boolean;
  readonly truncated: boolean;
  // Legacy compatibility
  readonly executionTime?: number;
  readonly deviceCount?: number;
  readonly target?: string;
  readonly url?: string;
  readonly serviceCount?: number;
  readonly scanDuration?: number;
  readonly scanMethod?: string;
  readonly probeDuration?: number;
  readonly resolveType?: string;
}

// ─── Plugin Capabilities ────────────────────────────────────

/** What a plugin can do — used by IntentRouter for selection */
export interface PluginCapabilities {
  /** Intents this plugin handles, e.g. ["browse", "search"] */
  readonly intents: readonly IntentName[];
  /** Does this plugin support streaming responses? */
  readonly streaming: boolean;
  /** Does this plugin need network access? */
  readonly requiresNetwork: boolean;
  /** Does this plugin work in browser (non-Tauri) mode? */
  readonly browserCompatible: boolean;
  /** Priority (0-100). Higher = preferred when multiple plugins match */
  readonly priority: number;
}

// ─── Core Plugin Interface (SRP) ────────────────────────────

/**
 * Minimum interface every data source plugin must implement.
 * Follows ISP — only query/result, no bloat.
 */
export interface DataSourcePlugin {
  readonly id: PluginId;
  readonly name: string;
  readonly capabilities: PluginCapabilities;

  /** Initialize the plugin (connect, validate config, etc.) */
  initialize(): Promise<void>;

  /** Check if plugin is currently available */
  isAvailable(): Promise<boolean>;

  /** Execute a query and return result */
  execute(query: PluginQuery): Promise<PluginResult>;

  /** Clean up resources */
  dispose(): Promise<void>;
}

// ─── Optional Plugin Extensions (ISP) ──────────────────────

/** Plugins that support real-time streaming */
export interface StreamablePlugin extends DataSourcePlugin {
  subscribe(
    query: PluginQuery,
    onData: (block: ContentBlock) => void,
    onError: (error: Error) => void,
  ): () => void; // returns unsubscribe function
}

/** Plugins that can describe visual content (cameras, screenshots) */
export interface VisualPlugin extends DataSourcePlugin {
  captureFrame(target: string): Promise<ContentBlock>;
  describeScene(target: string, prompt?: string): Promise<string>;
}

/** Plugins that maintain persistent connections */
export interface PersistentPlugin extends DataSourcePlugin {
  readonly connected: boolean;
  reconnect(): Promise<void>;
  onDisconnect(handler: () => void): () => void;
}

// ─── Plugin Lifecycle Events ────────────────────────────────

export type PluginEventType =
  | "plugin:registered"
  | "plugin:initialized"
  | "plugin:disposed"
  | "plugin:error"
  | "plugin:query:start"
  | "plugin:query:complete"
  | "plugin:query:error";

export interface PluginEvent {
  readonly type: PluginEventType;
  readonly pluginId: PluginId;
  readonly timestamp: number;
  readonly data?: unknown;
}

export type PluginEventHandler = (event: PluginEvent) => void;

// ─── Plugin Registry Interface ──────────────────────────────

export interface IPluginRegistry {
  register(plugin: DataSourcePlugin): void;
  unregister(pluginId: PluginId): void;
  get(pluginId: PluginId): DataSourcePlugin | undefined;
  getForIntent(intent: IntentName): DataSourcePlugin[];
  listAll(): readonly DataSourcePlugin[];
  onPluginEvent(handler: PluginEventHandler): () => void;
}

// ─── Intent Router Interface ────────────────────────────────

export interface IIntentRouter {
  /**
   * Detect intent from raw user input.
   * Uses LLM or rule-based detection.
   */
  detectIntent(rawInput: string): Promise<IntentName>;

  /**
   * Route a query to the best matching plugin and execute.
   */
  route(query: PluginQuery): Promise<PluginResult>;
}

// ─── Command/Query Bus Interfaces ───────────────────────────

export interface ICommand<TResult = void> {
  readonly type: string;
}

export interface ICommandHandler<TCommand extends ICommand<TResult>, TResult = void> {
  execute(command: TCommand): Promise<TResult>;
}

export interface ICommandBus {
  register<TCommand extends ICommand<TResult>, TResult>(
    commandType: string,
    handler: ICommandHandler<TCommand, TResult>,
  ): void;
  dispatch<TResult>(command: ICommand<TResult>): Promise<TResult>;
}

export interface IQuery<TResult> {
  readonly type: string;
}

export interface IQueryHandler<TQuery extends IQuery<TResult>, TResult> {
  execute(query: TQuery): Promise<TResult>;
}

export interface IQueryBus {
  register<TQuery extends IQuery<TResult>, TResult>(
    queryType: string,
    handler: IQueryHandler<TQuery, TResult>,
  ): void;
  dispatch<TResult>(query: IQuery<TResult>): Promise<TResult>;
}

// ─── Type Guards ────────────────────────────────────────────

export function isStreamable(plugin: DataSourcePlugin): plugin is StreamablePlugin {
  return "subscribe" in plugin && typeof (plugin as StreamablePlugin).subscribe === "function";
}

export function isVisual(plugin: DataSourcePlugin): plugin is VisualPlugin {
  return "captureFrame" in plugin && typeof (plugin as VisualPlugin).captureFrame === "function";
}

export function isPersistent(plugin: DataSourcePlugin): plugin is PersistentPlugin {
  return "connected" in plugin && typeof (plugin as PersistentPlugin).reconnect === "function";
}

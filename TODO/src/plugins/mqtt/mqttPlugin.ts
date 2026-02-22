/**
 * @module plugins/mqtt/mqttPlugin
 * @description MQTT plugin for IoT sensor data.
 *
 * Connects to MQTT broker and reads sensor topics.
 * Implements PersistentPlugin for connection management.
 *
 * Intents:
 * - "iot:read"      — read last value from sensor topic
 * - "iot:subscribe" — start listening for updates
 * - "iot:list"      — list known topics
 */

import type {
  ContentBlock,
  DataSourcePlugin,
  PersistentPlugin,
  PluginCapabilities,
  PluginId,
  PluginQuery,
  PluginResult,
  StreamablePlugin,
} from "../../core/plugin.types";

// ─── MQTT Types ─────────────────────────────────────────────

export interface MqttConfig {
  /** Broker URL, e.g. "ws://192.168.1.10:9001" or "mqtt://broker.local:1883" */
  readonly brokerUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly clientId?: string;
  /** Topics to auto-subscribe, e.g. ["home/sensors/#", "cameras/+/status"] */
  readonly topics: readonly string[];
  /** Friendly names for topics */
  readonly topicLabels?: Readonly<Record<string, string>>;
}

/** Abstraction over MQTT client library (mqtt.js, etc.) */
export interface MqttClientAdapter {
  connect(url: string, options?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(topic: string): Promise<void>;
  publish(topic: string, message: string): Promise<void>;
  onMessage(handler: (topic: string, payload: string) => void): () => void;
  isConnected(): boolean;
}

// ─── Last Values Cache ──────────────────────────────────────

interface TopicValue {
  readonly topic: string;
  readonly payload: string;
  readonly timestamp: number;
}

// ─── MQTT Plugin ────────────────────────────────────────────

export class MqttPlugin implements DataSourcePlugin, PersistentPlugin, StreamablePlugin {
  readonly id: PluginId = "mqtt";
  readonly name = "MQTT IoT";
  readonly capabilities: PluginCapabilities = {
    intents: ["iot:read", "iot:subscribe", "iot:list"],
    streaming: true,
    requiresNetwork: true,
    browserCompatible: true, // WebSocket MQTT works in browser
    priority: 60,
  };

  private config: MqttConfig;
  private client: MqttClientAdapter;
  private lastValues = new Map<string, TopicValue>();
  private subscribers = new Map<string, Set<(block: ContentBlock) => void>>();
  private disconnectHandlers = new Set<() => void>();
  private messageCleanup: (() => void) | null = null;

  get connected(): boolean {
    return this.client.isConnected();
  }

  constructor(config: MqttConfig, client: MqttClientAdapter) {
    this.config = config;
    this.client = client;
  }

  async initialize(): Promise<void> {
    await this.client.connect(this.config.brokerUrl, {
      username: this.config.username,
      password: this.config.password,
      clientId: this.config.clientId ?? `broxeen-${Date.now()}`,
    });

    // Subscribe to configured topics
    for (const topic of this.config.topics) {
      await this.client.subscribe(topic);
    }

    // Listen for messages
    this.messageCleanup = this.client.onMessage((topic, payload) => {
      this.lastValues.set(topic, {
        topic,
        payload,
        timestamp: Date.now(),
      });

      // Notify subscribers
      const subs = this.subscribers.get(topic);
      if (subs) {
        const block: ContentBlock = {
          type: "structured",
          data: JSON.stringify({ topic, value: payload, timestamp: Date.now() }),
          title: this.getTopicLabel(topic),
        };
        for (const cb of subs) {
          try { cb(block); } catch { /* observer error */ }
        }
      }
    });
  }

  async isAvailable(): Promise<boolean> {
    return this.client.isConnected();
  }

  async execute(query: PluginQuery): Promise<PluginResult> {
    const start = performance.now();

    switch (query.intent) {
      case "iot:list":
        return this.handleList(start);
      case "iot:read":
        return this.handleRead(query, start);
      case "iot:subscribe":
        return this.handleSubscribeInfo(query, start);
      default:
        return this.errorResult(`Nieznana intencja: ${query.intent}`, start);
    }
  }

  // ── StreamablePlugin ────────────────────────────────────

  subscribe(
    query: PluginQuery,
    onData: (block: ContentBlock) => void,
    onError: (error: Error) => void,
  ): () => void {
    const topic = this.extractTopic(query);

    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
      // Subscribe to MQTT topic if not already
      this.client.subscribe(topic).catch(onError);
    }

    this.subscribers.get(topic)!.add(onData);

    return () => {
      const subs = this.subscribers.get(topic);
      if (subs) {
        subs.delete(onData);
        if (subs.size === 0) {
          this.subscribers.delete(topic);
        }
      }
    };
  }

  // ── PersistentPlugin ────────────────────────────────────

  async reconnect(): Promise<void> {
    await this.client.disconnect();
    await this.initialize();
  }

  onDisconnect(handler: () => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => {
      this.disconnectHandlers.delete(handler);
    };
  }

  async dispose(): Promise<void> {
    if (this.messageCleanup) {
      this.messageCleanup();
    }
    await this.client.disconnect();
    this.lastValues.clear();
    this.subscribers.clear();
  }

  // ── Intent Handlers ─────────────────────────────────────

  private handleList(start: number): PluginResult {
    const topics = Array.from(this.lastValues.entries())
      .map(([topic, val]) => {
        const label = this.getTopicLabel(topic);
        const age = Math.round((Date.now() - val.timestamp) / 1000);
        return `• ${label}: ${val.payload} (${age}s temu)`;
      })
      .join("\n");

    const text = topics || "Brak danych — czekam na odczyty z sensorów";

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: text,
          summary: `${this.lastValues.size} sensorów aktywnych`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  private handleRead(query: PluginQuery, start: number): PluginResult {
    const topic = this.extractTopic(query);

    // Try exact match first, then prefix match
    const value =
      this.lastValues.get(topic) ??
      this.findByPrefix(topic);

    if (!value) {
      return {
        pluginId: this.id,
        status: "partial",
        content: [
          {
            type: "text",
            data: `Brak danych dla: ${topic}. Dostępne tematy: ${Array.from(this.lastValues.keys()).join(", ")}`,
          },
        ],
        metadata: this.meta(start),
      };
    }

    const label = this.getTopicLabel(value.topic);
    const age = Math.round((Date.now() - value.timestamp) / 1000);

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: `${label}: ${value.payload}`,
          summary: `${label}: ${value.payload} (${age}s temu)`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  private handleSubscribeInfo(query: PluginQuery, start: number): PluginResult {
    const topic = this.extractTopic(query);

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: `Nasłuchiwanie na temat: ${topic}. Użyj streaming API aby otrzymywać aktualizacje.`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private extractTopic(query: PluginQuery): string {
    if (query.resolvedTarget) return query.resolvedTarget;

    // Try to extract topic from natural language
    const input = query.rawInput.toLowerCase();

    // Map common Polish words to topics
    const mappings: Record<string, string> = {
      temperatura: "home/sensors/temperature",
      wilgotność: "home/sensors/humidity",
      ciśnienie: "home/sensors/pressure",
      ruch: "home/sensors/motion",
      drzwi: "home/sensors/door",
      światło: "home/sensors/light",
    };

    for (const [keyword, topic] of Object.entries(mappings)) {
      if (input.includes(keyword)) return topic;
    }

    return query.rawInput;
  }

  private findByPrefix(prefix: string): TopicValue | undefined {
    for (const [topic, value] of this.lastValues) {
      if (topic.startsWith(prefix) || topic.includes(prefix)) {
        return value;
      }
    }
    return undefined;
  }

  private getTopicLabel(topic: string): string {
    return this.config.topicLabels?.[topic] ?? topic.split("/").pop() ?? topic;
  }

  private meta(start: number): PluginResult["metadata"] {
    return {
      duration_ms: performance.now() - start,
      cached: true, // MQTT reads from local cache
      truncated: false,
    };
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: "error",
      content: [{ type: "text", data: message }],
      metadata: this.meta(start),
    };
  }
}

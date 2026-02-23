import type { Plugin, PluginContext, PluginResult } from "../../core/types";
import { configStore } from "../../config/configStore";
import { logger } from "../../lib/logger";

const frigateLogger = logger.scope("frigate:events");

type UnlistenFn = () => void;

type FrigateMqttEnvelope = {
  topic: string;
  payload: string;
  timestamp: number;
};

type FrigateEvent = {
  type?: string;
  before?: any;
  after?: any;
};

export class FrigateEventsPlugin implements Plugin {
  readonly id = "frigate-events";
  readonly name = "Frigate Events";
  readonly version = "1.0.0";
  readonly supportedIntents = ["frigate:status", "frigate:start", "frigate:stop"];

  private unlisten: UnlistenFn | null = null;
  private tauriInvoke: PluginContext["tauriInvoke"] | null = null;
  private lastSnapshotByCamera = new Map<string, { base64: string; mimeType: string }>();
  private lastAlertAtByKey = new Map<string, number>();
  private processedEventIds = new Set<string>();
  private activeEventIdByKey = new Map<string, string>();
  private started = false;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.isTauri || !context.tauriInvoke) {
      frigateLogger.info("Skipping FrigateEventsPlugin init (not tauri runtime)");
      return;
    }

    if (this.started) {
      return;
    }

    this.tauriInvoke = context.tauriInvoke;

    const cfg = configStore.getAll().frigate;

    try {
      await context.tauriInvoke("frigate_mqtt_start", {
        host: cfg.mqttHost,
        port: cfg.mqttPort,
        username: cfg.mqttUsername ? cfg.mqttUsername : null,
        password: cfg.mqttPassword ? cfg.mqttPassword : null,
        topic: cfg.mqttTopic,
        client_id: null,
      });
      this.started = true;
    } catch (err) {
      frigateLogger.warn("frigate_mqtt_start failed", err);
      return;
    }

    const { listen } = await import("@tauri-apps/api/event");

    const unlisten = await listen<FrigateMqttEnvelope>("broxeen:frigate_event", (ev) => {
      void this.handleMqttEvent(ev.payload);
    });

    this.unlisten = unlisten;

    frigateLogger.info("FrigateEventsPlugin initialized", {
      topic: cfg.mqttTopic,
      baseUrl: cfg.baseUrl,
    });
  }

  async dispose(): Promise<void> {
    if (this.unlisten) {
      try {
        this.unlisten();
      } catch {
        // ignore
      }
      this.unlisten = null;
    }

    if (this.tauriInvoke && this.started) {
      try {
        await this.tauriInvoke("frigate_mqtt_stop");
      } catch (err) {
        frigateLogger.warn("frigate_mqtt_stop failed during dispose", err);
      }
    }

    this.tauriInvoke = null;
    this.started = false;
  }

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /frigate/.test(lower) && (/status|start|stop/.test(lower));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    if (!context.isTauri || !context.tauriInvoke) {
      return {
        pluginId: this.id,
        status: "error",
        content: [{ type: "text", data: "Frigate events są dostępne tylko w runtime Tauri." }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    if (lower.includes("stop")) {
      await context.tauriInvoke("frigate_mqtt_stop");
      this.started = false;
      return {
        pluginId: this.id,
        status: "success",
        content: [{ type: "text", data: "⏹️ Zatrzymano nasłuch zdarzeń Frigate (MQTT)." }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    if (lower.includes("start")) {
      await this.initialize(context);
      return {
        pluginId: this.id,
        status: "success",
        content: [{ type: "text", data: "▶️ Uruchomiono nasłuch zdarzeń Frigate (MQTT)." }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const cfg = configStore.getAll().frigate;
    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data:
            `🦅 **Frigate Events**\n` +
            `- MQTT: ${cfg.mqttHost}:${cfg.mqttPort} topic=\`${cfg.mqttTopic}\`\n` +
            `- baseUrl: ${cfg.baseUrl}\n` +
            `- labels: ${cfg.allowedLabels.join(", ")}\n` +
            `- cooldown: ${Math.round(cfg.cooldownMs / 1000)}s\n` +
            `- status: ${this.started ? "✅ running" : "⚪ stopped"}`,
        },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleMqttEvent(envelope: FrigateMqttEnvelope): Promise<void> {
    const cfg = configStore.getAll().frigate;

    let json: FrigateEvent | null = null;
    try {
      json = JSON.parse(envelope.payload);
    } catch {
      return;
    }

    const eventType = (json?.type || "").toLowerCase();
    const after = json?.after || {};
    const before = json?.before || {};

    const label = String(after.label || before.label || "").toLowerCase();
    const camera = String(after.camera || before.camera || "").trim();
    const idRaw = after.id || before.id;
    const id = typeof idRaw === "string" ? idRaw : null;

    if (!camera || !label) return;

    const allowed = (cfg.allowedLabels || []).map((x) => String(x).toLowerCase());
    if (!allowed.includes(label)) return;

    const key = `${camera}:${label}`;

    // End of incident: clear active mapping; do not remove from processed ids
    if (eventType === "end") {
      const active = this.activeEventIdByKey.get(key);
      if (active && id && active === id) {
        this.activeEventIdByKey.delete(key);
      }
      return;
    }

    // We only trigger LLM at incident start.
    if (eventType !== "new") {
      return;
    }

    // Incident semantics: deduplicate by event id (preferred).
    if (id) {
      if (this.processedEventIds.has(id)) {
        return;
      }
      this.processedEventIds.add(id);
      this.activeEventIdByKey.set(key, id);
    } else {
      // Fallback: if id missing, use cooldown.
      const now = Date.now();
      const last = this.lastAlertAtByKey.get(key) ?? 0;
      if (now - last < cfg.cooldownMs) return;
      this.lastAlertAtByKey.set(key, now);
    }

    const current = await this.fetchSnapshotBase64(cfg.baseUrl, camera, id);
    if (!current) return;

    const previous = this.lastSnapshotByCamera.get(camera);
    this.lastSnapshotByCamera.set(camera, current);

    if (!previous) {
      return;
    }

    const { describeImageChange } = await import("../../lib/llmClient");

    let summary = "";
    try {
      summary = (await describeImageChange(previous.base64, current.base64, current.mimeType)).trim();
    } catch (err) {
      frigateLogger.warn("describeImageChange failed", err);
      summary = `Wykryto obiekt: ${label} (kamera: ${camera}).`;
    }

    if (!summary) return;

    this.emitMonitorChange({
      targetId: `frigate:${camera}`,
      targetName: camera,
      targetType: "frigate",
      timestamp: Date.now(),
      changeScore: 1,
      summary,
      thumbnailBase64: current.base64,
      thumbnailMimeType: current.mimeType,
    });
  }

  private async fetchSnapshotBase64(
    baseUrl: string,
    camera: string,
    eventId: string | null,
  ): Promise<{ base64: string; mimeType: string } | null> {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const url = eventId
      ? `${cleanBase}/api/events/${encodeURIComponent(eventId)}/snapshot.jpg`
      : `${cleanBase}/api/${encodeURIComponent(camera)}/latest.jpg`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      const base64 = await this.blobToBase64(blob);
      const mimeType = blob.type || "image/jpeg";
      return { base64, mimeType };
    } catch {
      return null;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = reader.result;
        if (typeof res !== "string") return reject(new Error("Invalid FileReader result"));
        const idx = res.indexOf(",");
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
      reader.readAsDataURL(blob);
    });
  }

  private emitMonitorChange(detail: any): void {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("broxeen:monitor_change", { detail }));
    } catch {
      // ignore
    }
  }
}

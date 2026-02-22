/**
 * @module core/bootstrap
 * @description Application bootstrap v2 — full stack composition root.
 *
 * Wires together:
 * - Plugin registry + intent router
 * - Persistence (SQLite: devices.db + chat.db)
 * - Network discovery
 * - Reactive monitoring (WatchManager + ChangeDetector)
 */

import { PluginRegistry } from "./pluginRegistry";
import { IntentRouter, type LlmIntentDetector } from "./intentRouter";
import { CommandBus, loggingMiddleware } from "./commandBus";
import { QueryBus } from "./queryBus";

// Plugins
import { registerHttpBrowsePlugin } from "../plugins/http-browse";
import { registerRtspCameraPlugin, type CameraConfig } from "../plugins/rtsp-camera";
import { registerMqttPlugin, type MqttClientAdapter, type MqttConfig } from "../plugins/mqtt";
import { registerDiscoveryPlugin } from "../plugins/discovery";

// Persistence
import {
  DatabaseManager,
  InMemoryDbAdapter,
  type DbAdapter,
} from "../persistence/database";
import { DeviceRepository } from "../persistence/deviceRepository";
import { ChatRepository } from "../persistence/chatRepository";

// Reactive
import { WatchManager, ChangeDetector, type WatchConfig } from "../reactive/watchManager";

// ─── Configuration ──────────────────────────────────────────

export interface AppConfig {
  isTauri: boolean;
  tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  describeImage?: (base64: string, mimeType?: string, prompt?: string) => Promise<string>;
  llmDetector?: LlmIntentDetector;

  /** Camera configurations (optional — also auto-discovered from DB) */
  cameras?: CameraConfig[];

  /** MQTT configuration (optional) */
  mqtt?: {
    config: MqttConfig;
    client: MqttClientAdapter;
  };

  /** SQLite database directory path (empty = in-memory for browser) */
  dbPath?: string;

  /** Database adapter factory (for DI/testing) */
  createDbAdapter?: (path: string) => DbAdapter;

  /** Network scanning config */
  network?: {
    defaultSubnet?: string;
    autoScanOnStart?: boolean;
  };

  /** Watch/monitoring config overrides */
  watch?: Partial<WatchConfig>;

  debug?: boolean;
}

// ─── Bootstrap Result ───────────────────────────────────────

export interface AppContext {
  readonly registry: PluginRegistry;
  readonly router: IntentRouter;
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;

  // Persistence
  readonly db: DatabaseManager;
  readonly deviceRepo: DeviceRepository;
  readonly chatRepo: ChatRepository;

  // Reactive
  readonly watchManager: WatchManager;
  readonly changeDetector: ChangeDetector;

  readonly dispose: () => Promise<void>;
}

// ─── Bootstrap ──────────────────────────────────────────────

export async function bootstrapApp(config: AppConfig): Promise<AppContext> {
  // ── 1. Persistence Layer ────────────────────────────────

  const createAdapter =
    config.createDbAdapter ?? ((_path: string) => new InMemoryDbAdapter());
  const db = new DatabaseManager(createAdapter, config.dbPath ?? "");
  await db.initialize();

  const deviceRepo = new DeviceRepository(db.devices);
  const chatRepo = new ChatRepository(db.chat);

  // ── 2. Plugin Registry ──────────────────────────────────

  const registry = new PluginRegistry();
  const commandBus = new CommandBus();
  const queryBus = new QueryBus();

  // HTTP Browse (always available)
  registerHttpBrowsePlugin(registry, {
    tauriInvoke: config.tauriInvoke,
  });

  // RTSP Cameras — from config AND from previously discovered devices
  const cameras = deduplicateCameras([
    ...(config.cameras ?? []),
    ...buildCamerasFromDb(deviceRepo),
  ]);
  if (cameras.length > 0) {
    registerRtspCameraPlugin(registry, {
      cameras,
      describeImage: config.describeImage,
      tauriInvoke: config.tauriInvoke,
    });
  }

  // MQTT
  if (config.mqtt) {
    registerMqttPlugin(registry, config.mqtt.config, config.mqtt.client);
  }

  // Network Discovery
  registerDiscoveryPlugin(registry, deviceRepo, {
    tauriInvoke: config.tauriInvoke,
    defaultSubnet: config.network?.defaultSubnet,
  });

  // ── 3. Intent Router ────────────────────────────────────

  const router = new IntentRouter({
    registry,
    llmDetector: config.llmDetector,
    isTauri: config.isTauri,
  });

  // Discovery-specific intent rules
  router.addRule({
    intent: "network:scan",
    test: (input) =>
      /\b(skanuj|skan|scan|wykryj|szukaj urząd)\b/i.test(input) &&
      /\b(sieć|siec|network|urządzen|urzadzen|device)\b/i.test(input),
    priority: 85,
  });
  router.addRule({
    intent: "network:list",
    test: (input) =>
      /\b(lista|pokaż|pokaz|wyświetl|list)\b/i.test(input) &&
      /\b(urządzen|urzadzen|device|sieć|siec)\b/i.test(input),
    priority: 83,
  });

  // ── 4. Reactive Monitoring ──────────────────────────────

  const watchManager = new WatchManager(chatRepo, deviceRepo, config.watch);
  const changeDetector = new ChangeDetector(
    router,
    watchManager,
    deviceRepo,
    chatRepo,
    { changeThreshold: config.watch?.changeThreshold ?? 0.15 },
  );

  // ── 5. Middleware ───────────────────────────────────────

  if (config.debug) {
    commandBus.use(loggingMiddleware(console.log));
  }

  // Main command: query through plugins + auto-watch
  commandBus.register("plugin:query", {
    execute: async (cmd: any) => {
      const query = {
        intent: cmd.intent,
        rawInput: cmd.rawInput,
        resolvedTarget: cmd.resolvedTarget,
        params: {},
        metadata: {
          timestamp: Date.now(),
          source: cmd.source ?? "text",
          locale: "pl-PL",
        },
      };

      const result = await router.route(query);

      // Auto-watch on success
      if (result.status === "success") {
        watchManager.autoWatch(
          cmd.resolvedTarget ?? cmd.rawInput,
          cmd.intent,
          result.pluginId,
          cmd.rawInput,
        );
      }

      return result;
    },
  });

  // ── 6. Initialize ───────────────────────────────────────

  const initResults = await registry.initializeAll();
  for (const [id, error] of initResults) {
    if (error) {
      console.warn(`[bootstrap] Plugin "${id}" failed:`, error.message);
    }
  }

  // Start change detector
  changeDetector.start();

  // Auto-scan on first start
  if (config.network?.autoScanOnStart) {
    registry.get("network-scanner")?.execute({
      intent: "network:scan",
      rawInput: "auto-scan",
      params: {},
      metadata: { timestamp: Date.now(), source: "api", locale: "pl-PL" },
    }).catch((err) => console.warn("[bootstrap] Auto-scan failed:", err));
  }

  // ── 7. Return Context ───────────────────────────────────

  return {
    registry,
    router,
    commandBus,
    queryBus,
    db,
    deviceRepo,
    chatRepo,
    watchManager,
    changeDetector,
    dispose: async () => {
      changeDetector.stop();
      await registry.disposeAll();
      db.close();
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────

function buildCamerasFromDb(deviceRepo: DeviceRepository): CameraConfig[] {
  try {
    return deviceRepo.getCameras().map((cam) => {
      const rtsp = cam.services.find((s) => s.protocol === "rtsp");
      const snap = cam.services.find(
        (s) => s.protocol === "http" && s.path.includes("snapshot"),
      );
      return {
        id: cam.id,
        name: cam.name ?? cam.hostname ?? cam.ip,
        rtspUrl: rtsp ? `rtsp://${cam.ip}:${rtsp.port}${rtsp.path}` : undefined,
        snapshotUrl: snap ? `http://${cam.ip}:${snap.port}${snap.path}` : undefined,
        location: cam.name,
      };
    });
  } catch {
    return [];
  }
}

function deduplicateCameras(cameras: CameraConfig[]): CameraConfig[] {
  const seen = new Set<string>();
  return cameras.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

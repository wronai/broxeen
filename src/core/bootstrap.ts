/**
 * @module core/bootstrap
 * @description Application bootstrap — wires everything together.
 *
 * This is the composition root (DI pattern).
 * All plugin registration happens here, not scattered across components.
 *
 * Usage in App.tsx:
 *   const app = await bootstrapApp();
 *   // Use app.router, app.commandBus, app.queryBus in CqrsProvider
 */

import { PluginRegistry } from "./pluginRegistry";
import { IntentRouter, type LlmIntentDetector } from "./intentRouter";
import { CommandBus, loggingMiddleware } from "./commandBus";
import { QueryBus } from "./queryBus";

// Plugins
import { registerHttpBrowsePlugin } from "../plugins/http-browse";
import { registerRtspCameraPlugin, type CameraConfig } from "../plugins/rtsp-camera";
import { registerMqttPlugin, type MqttClientAdapter, type MqttConfig } from "../plugins/mqtt";

// Existing domain
// import { EventStore } from "../domain/eventStore";
// import { ChatAggregate } from "../domain/chatAggregate";

// ─── Configuration ──────────────────────────────────────────

export interface AppConfig {
  /** Is running inside Tauri (vs. browser-only) */
  isTauri: boolean;

  /** Tauri invoke function (if available) */
  tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  /** LLM describeImage function (for camera plugin) */
  describeImage?: (base64: string, mimeType?: string, prompt?: string) => Promise<string>;

  /** LLM intent detector (optional, for ambiguous queries) */
  llmDetector?: LlmIntentDetector;

  /** Camera configurations (optional) */
  cameras?: CameraConfig[];

  /** MQTT configuration (optional) */
  mqtt?: {
    config: MqttConfig;
    client: MqttClientAdapter;
  };

  /** Enable debug logging */
  debug?: boolean;
}

// ─── Bootstrap Result ───────────────────────────────────────

export interface AppContext {
  readonly registry: PluginRegistry;
  readonly router: IntentRouter;
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly dispose: () => Promise<void>;
}

// ─── Bootstrap Function ─────────────────────────────────────

export async function bootstrapApp(config: AppConfig): Promise<AppContext> {
  const registry = new PluginRegistry();
  const commandBus = new CommandBus();
  const queryBus = new QueryBus();

  // ── Register Plugins ────────────────────────────────────

  // 1. HTTP Browse (always available)
  registerHttpBrowsePlugin(registry, {
    tauriInvoke: config.tauriInvoke,
  });

  // 2. RTSP Camera (if cameras configured)
  if (config.cameras && config.cameras.length > 0) {
    registerRtspCameraPlugin(registry, {
      cameras: config.cameras,
      describeImage: config.describeImage,
      tauriInvoke: config.tauriInvoke,
    });
  }

  // 3. MQTT IoT (if configured)
  if (config.mqtt) {
    registerMqttPlugin(registry, config.mqtt.config, config.mqtt.client);
  }

  // ── Create Intent Router ────────────────────────────────

  const router = new IntentRouter({
    registry,
    llmDetector: config.llmDetector,
    isTauri: config.isTauri,
  });

  // ── Setup Middleware ────────────────────────────────────

  if (config.debug) {
    commandBus.use(loggingMiddleware(console.log));
  }

  // ── Initialize All Plugins ──────────────────────────────

  const initResults = await registry.initializeAll();
  for (const [id, error] of initResults) {
    if (error) {
      console.warn(`[bootstrap] Plugin "${id}" failed to initialize:`, error.message);
    }
  }

  // ── Register Plugin Query Command Handler ───────────────

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
      return router.route(query);
    },
  });

  // ── Compose Result ──────────────────────────────────────

  return {
    registry,
    router,
    commandBus,
    queryBus,
    dispose: () => registry.disposeAll(),
  };
}

// ─── React Hook (for CqrsProvider integration) ──────────────

/**
 * Example integration with existing CqrsContext:
 *
 * ```tsx
 * function App() {
 *   const [appCtx, setAppCtx] = useState<AppContext | null>(null);
 *
 *   useEffect(() => {
 *     bootstrapApp({
 *       isTauri: isTauriRuntime(),
 *       tauriInvoke: window.__TAURI__?.core.invoke,
 *       cameras: loadCameraConfig(),
 *     }).then(setAppCtx);
 *
 *     return () => { appCtx?.dispose(); };
 *   }, []);
 *
 *   if (!appCtx) return <LoadingScreen />;
 *
 *   return (
 *     <PluginProvider context={appCtx}>
 *       <CqrsProvider eventStore={eventStore} aggregate={aggregate}>
 *         <Chat />
 *       </CqrsProvider>
 *     </PluginProvider>
 *   );
 * }
 * ```
 */

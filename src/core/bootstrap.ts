/**
 * Bootstrap - initializes the plugin system
 */

import type { PluginContext, AppContext } from './types';
import { scopeRegistry } from '../plugins/scope/scopeRegistry';
import { DatabaseManager } from '../persistence/databaseManager';
import { configStore } from '../config/configStore';
import { EventStore } from '../domain/eventStore';
import { isLlmClassifierAvailable } from './llmIntentClassifier';
import { createScopedLogger } from '../lib/logger';

const log = createScopedLogger('bootstrap');

export type { AppContext };
import { PluginRegistry } from './pluginRegistry';
import { IntentRouter } from './intentRouter';
import { CommandBus } from './commandBus';

export async function bootstrapApp(config: {
  isTauri: boolean;
  tauriInvoke?: (command: string, args?: any) => Promise<any>;
  cameras?: import('./types').CameraConfig[];
  mqtt?: import('./types').MqttConfig;
  describeImage?: (imageUrl: string) => Promise<string>;
}): Promise<AppContext> {
  log.info('Bootstrapping Broxeen v2 Plugin System...');

  scopeRegistry.restore();

  const pluginRegistry = new PluginRegistry();
  const useLlmClassifier = isLlmClassifierAvailable();
  log.info(`LLM Intent Classifier: ${useLlmClassifier ? 'ENABLED' : 'DISABLED (no API key)}'}`);
  const intentRouter = new IntentRouter({ useLlmClassifier });
  const commandBus = new CommandBus();
  const eventStore = new EventStore();

  // Initialize SQLite databases (devices.db + chat.db)
  const dbManager = new DatabaseManager(
    {
      devicesDbPath: 'broxeen_devices.db',
      chatDbPath: 'broxeen_chat.db',
      walMode: true,
      connectionPoolSize: 1,
    },
    config.isTauri ? (config.tauriInvoke as any) : undefined,
  );
  try {
    await dbManager.initialize();
    log.info('SQLite databases initialized');
  } catch (err) {
    log.warn(`SQLite initialization failed (data will not persist): ${err}`);
  }

  const pluginContext: PluginContext = {
    isTauri: config.isTauri,
    tauriInvoke: config.tauriInvoke,
    cameras: config.cameras || [],
    mqtt: config.mqtt,
    describeImage: config.describeImage,
    scope: scopeRegistry.getActiveScope().id,
    databaseManager: dbManager,
    eventStore,
  };

  await registerCorePlugins(pluginRegistry, intentRouter, commandBus, config.isTauri, config.tauriInvoke);
  await pluginRegistry.initializeAll(pluginContext);

  log.info(`Plugin system initialized — ${pluginRegistry.getAll().length} plugins, scope: ${scopeRegistry.getActiveScope().id}`);

  // Start periodic auto-scan (Tauri only)
  let autoScanSchedulerInstance: import('../plugins/discovery/autoScanScheduler').AutoScanScheduler | null = null;
  if (config.isTauri && config.tauriInvoke) {
    try {
      const { AutoScanScheduler } = await import('../plugins/discovery/autoScanScheduler');
      autoScanSchedulerInstance = new AutoScanScheduler();
      autoScanSchedulerInstance.start(pluginContext);
      log.info('AutoScanScheduler started');
    } catch (e) {
      log.warn(`AutoScanScheduler unavailable: ${e}`);
    }
  }

  // Store the tauriInvoke for use in command bus
  const sharedTauriInvoke = config.tauriInvoke;

  return {
    pluginRegistry,
    intentRouter,
    commandBus,
    databaseManager: dbManager,
    eventStore,
    autoScanScheduler: autoScanSchedulerInstance,
    dispose: async () => {
      log.info('Disposing plugin system...');
      autoScanSchedulerInstance?.stop();
      await pluginRegistry.disposeAll();
      commandBus.clear();
      scopeRegistry.persist();
      await dbManager.close();
    },
    // Expose the tauriInvoke for command bus
    tauriInvoke: sharedTauriInvoke,
  };
}

function safeRegister(registry: PluginRegistry, router: IntentRouter, plugin: any, label: string): void {
  try {
    registry.register(plugin);
    if ('capabilities' in plugin) {
      router.registerDataSourcePlugin(plugin);
    } else {
      router.registerPlugin(plugin);
    }
    log.debug(`${label} registered`);
  } catch (err) {
    log.warn(`${label} registration failed: ${err}`);
  }
}

async function registerCorePlugins(
  registry: PluginRegistry,
  router: IntentRouter,
  bus: CommandBus,
  isTauri: boolean,
  tauriInvoke?: (command: string, args?: unknown) => Promise<unknown>,
): Promise<void> {

  // ── Local/Network scope plugins ─────────────────────────────

  try {
    const { NetworkScanPlugin } = await import('../plugins/discovery/networkScanPlugin');
    safeRegister(registry, router, new NetworkScanPlugin(), 'NetworkScanPlugin');
  } catch (e) { log.warn(`NetworkScanPlugin unavailable: ${e}`); }

  try {
    const { PingPlugin } = await import('../plugins/network/pingPlugin');
    safeRegister(registry, router, new PingPlugin(), 'PingPlugin');
  } catch (e) { log.warn(`PingPlugin unavailable: ${e}`); }

  try {
    const { PortScanPlugin } = await import('../plugins/network/portScanPlugin');
    safeRegister(registry, router, new PortScanPlugin(), 'PortScanPlugin');
  } catch (e) { log.warn(`PortScanPlugin unavailable: ${e}`); }

  try {
    const { OnvifPlugin } = await import('../plugins/network/onvifPlugin');
    safeRegister(registry, router, new OnvifPlugin(), 'OnvifPlugin');
  } catch (e) { log.warn(`OnvifPlugin unavailable: ${e}`); }

  try {
    const { MdnsPlugin } = await import('../plugins/network/mdnsPlugin');
    safeRegister(registry, router, new MdnsPlugin(), 'MdnsPlugin');
  } catch (e) { log.warn(`MdnsPlugin unavailable: ${e}`); }

  try {
    const { ArpPlugin } = await import('../plugins/network/arpPlugin');
    safeRegister(registry, router, new ArpPlugin(), 'ArpPlugin');
  } catch (e) { log.warn(`ArpPlugin unavailable: ${e}`); }

  // RTSP Camera plugin
  try {
    const { RtspCameraPlugin, HttpSnapshotGrabber, TauriRtspGrabber } = await import('../plugins/rtsp-camera/rtspCameraPlugin');
    const grabbers = isTauri && tauriInvoke
      ? [new TauriRtspGrabber(tauriInvoke as any), new HttpSnapshotGrabber()]
      : [new HttpSnapshotGrabber()];
    const rtspPlugin = new RtspCameraPlugin({ cameras: [], grabbers });
    safeRegister(registry, router, rtspPlugin, 'RtspCameraPlugin');
  } catch (e) { log.warn(`RtspCameraPlugin unavailable: ${e}`); }

  try {
    const { WakeOnLanPlugin } = await import('../plugins/network/wakeOnLanPlugin');
    safeRegister(registry, router, new WakeOnLanPlugin(), 'WakeOnLanPlugin');
  } catch (e) { log.warn(`WakeOnLanPlugin unavailable: ${e}`); }

  // Device status monitoring
  try {
    const { DeviceStatusPlugin } = await import('../plugins/discovery/deviceStatusPlugin');
    safeRegister(registry, router, new DeviceStatusPlugin(), 'DeviceStatusPlugin');
  } catch (e) { log.warn(`DeviceStatusPlugin unavailable: ${e}`); }

  // Device configuration
  try {
    const { DeviceConfigPlugin } = await import('../plugins/discovery/deviceConfigPlugin');
    safeRegister(registry, router, new DeviceConfigPlugin(), 'DeviceConfigPlugin');
  } catch (e) { log.warn(`DeviceConfigPlugin unavailable: ${e}`); }

  // ── Camera plugins ────────────────────────────────────────────

  try {
    const { CameraHealthPlugin } = await import('../plugins/cameras/cameraHealthPlugin');
    safeRegister(registry, router, new CameraHealthPlugin(), 'CameraHealthPlugin');
  } catch (e) { log.warn(`CameraHealthPlugin unavailable: ${e}`); }

  try {
    const { CameraPtzPlugin } = await import('../plugins/cameras/cameraPtzPlugin');
    safeRegister(registry, router, new CameraPtzPlugin(), 'CameraPtzPlugin');
  } catch (e) { log.warn(`CameraPtzPlugin unavailable: ${e}`); }

  try {
    const { CameraSnapshotPlugin } = await import('../plugins/cameras/cameraSnapshotPlugin');
    safeRegister(registry, router, new CameraSnapshotPlugin(), 'CameraSnapshotPlugin');
  } catch (e) { log.warn(`CameraSnapshotPlugin unavailable: ${e}`); }

  try {
    const { CameraLivePlugin } = await import('../plugins/camera/cameraLivePlugin');
    safeRegister(registry, router, new CameraLivePlugin(), 'CameraLivePlugin');
  } catch (e) { log.warn(`CameraLivePlugin unavailable: ${e}`); }

  // Advanced port scan with camera vendor detection
  try {
    const { AdvancedPortScanPlugin } = await import('../plugins/discovery/advancedPortScanPlugin');
    safeRegister(registry, router, new AdvancedPortScanPlugin(), 'AdvancedPortScanPlugin');
  } catch (e) { log.warn(`AdvancedPortScanPlugin unavailable: ${e}`); }

  // Service probe (Tauri only)
  if (isTauri) {
    try {
      const { ServiceProbePlugin } = await import('../plugins/discovery/serviceProbePlugin');
      safeRegister(registry, router, new ServiceProbePlugin(), 'ServiceProbePlugin');
    } catch (e) { log.warn(`ServiceProbePlugin unavailable: ${e}`); }
  }

  // ── Monitor plugin ────────────────────────────────────────────

  try {
    const { MonitorPlugin } = await import('../plugins/monitor/monitorPlugin');
    safeRegister(registry, router, new MonitorPlugin(), 'MonitorPlugin');
  } catch (e) { log.warn(`MonitorPlugin unavailable: ${e}`); }

  // ── Frigate events plugin (Tauri only) ─────────────────────────

  if (isTauri) {
    try {
      const { FrigateEventsPlugin } = await import('../plugins/frigate/frigateEventsPlugin');
      safeRegister(registry, router, new FrigateEventsPlugin(), 'FrigateEventsPlugin');
    } catch (e) { log.warn(`FrigateEventsPlugin unavailable: ${e}`); }
  }

  // ── Motion Detection Pipeline plugin (Tauri only) ───────────────

  if (isTauri) {
    try {
      const { MotionDetectionPlugin } = await import('../plugins/monitor/motionDetectionPlugin');
      safeRegister(registry, router, new MotionDetectionPlugin(), 'MotionDetectionPlugin');
    } catch (e) { log.warn(`MotionDetectionPlugin unavailable: ${e}`); }
  }

  // ── Monitoring DB Query plugin (Tauri only) ──────────────────────

  if (isTauri) {
    try {
      const { MonitoringPlugin } = await import('../plugins/monitoringPlugin');
      safeRegister(registry, router, new MonitoringPlugin(), 'MonitoringPlugin (DB Query)');
    } catch (e) { log.warn(`MonitoringPlugin unavailable: ${e}`); }
  }

  try {
    const { ProcessesPlugin } = await import('../plugins/system/processesPlugin');
    safeRegister(registry, router, new ProcessesPlugin(), 'ProcessesPlugin');
  } catch (e) { log.warn(`ProcessesPlugin unavailable: ${e}`); }

  try {
    const { DiskInfoPlugin } = await import('../plugins/system/diskInfoPlugin');
    safeRegister(registry, router, new DiskInfoPlugin(), 'DiskInfoPlugin');
  } catch (e) { log.warn(`DiskInfoPlugin unavailable: ${e}`); }

  try {
    const { SshPlugin } = await import('../plugins/system/sshPlugin');
    safeRegister(registry, router, new SshPlugin(), 'SshPlugin');
  } catch (e) { log.warn(`SshPlugin unavailable: ${e}`); }

  // ── Protocol Bridge plugin ──────────────────────────────────────

  try {
    const { ProtocolBridgePlugin } = await import('../plugins/protocol-bridge/protocolBridgePlugin');
    safeRegister(registry, router, new ProtocolBridgePlugin(), 'ProtocolBridgePlugin');
  } catch (e) { log.warn(`ProtocolBridgePlugin unavailable: ${e}`); }

  // ── Marketplace plugin ────────────────────────────────────────

  try {
    const { MarketplacePlugin } = await import('../plugins/marketplace/marketplaceLoader');
    safeRegister(registry, router, new MarketplacePlugin(), 'MarketplacePlugin');
  } catch (e) { log.warn(`MarketplacePlugin unavailable: ${e}`); }

  // ── Internet scope plugins ───────────────────────────────────

  try {
    const { HttpBrowsePlugin } = await import('../plugins/http/browsePlugin');
    safeRegister(registry, router, new HttpBrowsePlugin(), 'HttpBrowsePlugin');
  } catch (e) { log.warn(`HttpBrowsePlugin unavailable: ${e}`); }

  try {
    const { AuthBrowsePlugin } = await import('../plugins/authBrowse/authBrowsePlugin');
    safeRegister(registry, router, new AuthBrowsePlugin(), 'AuthBrowsePlugin');
  } catch (e) { log.warn(`AuthBrowsePlugin unavailable: ${e}`); }

  // ── File Search plugin ──────────────────────────────────────

  try {
    const { FileSearchPlugin } = await import('../plugins/files/fileSearchPlugin');
    safeRegister(registry, router, new FileSearchPlugin(), 'FileSearchPlugin');
  } catch (e) { log.warn(`FileSearchPlugin unavailable: ${e}`); }

  // ── Email plugin ──────────────────────────────────────────

  try {
    const { EmailPlugin } = await import('../plugins/email/emailPlugin');
    safeRegister(registry, router, new EmailPlugin(), 'EmailPlugin');
  } catch (e) { log.warn(`EmailPlugin unavailable: ${e}`); }

  // ── System plugins ─────────────────────────────────────────────

  try {
    const { LogsPlugin } = await import('../plugins/system/logsPlugin');
    safeRegister(registry, router, new LogsPlugin(), 'LogsPlugin');
  } catch (e) { log.warn(`LogsPlugin unavailable: ${e}`); }

  // ── Voice Commands plugin ──────────────────────────────────────

  try {
    const { VoiceCommandsPlugin } = await import('../plugins/voice/voiceCommandsPlugin');
    safeRegister(registry, router, new VoiceCommandsPlugin(), 'VoiceCommandsPlugin');
  } catch (e) { log.warn(`VoiceCommandsPlugin unavailable: ${e}`); }

  // ── Docker plugin ──────────────────────────────────────────────

  try {
    const { DockerPlugin } = await import('../plugins/docker/dockerPlugin');
    safeRegister(registry, router, new DockerPlugin(), 'DockerPlugin');
  } catch (e) { log.warn(`DockerPlugin unavailable: ${e}`); }

  // ── Remote Machine plugin ───────────────────────────────────────

  try {
    const { RemoteMachinePlugin } = await import('../plugins/remote-machine/remoteMachinePlugin');
    safeRegister(registry, router, new RemoteMachinePlugin(), 'RemoteMachinePlugin');
  } catch (e) { log.warn(`RemoteMachinePlugin unavailable: ${e}`); }

  // ── Fallback ─────────────────────────────────────────────────

  try {
    const { ChatLlmPlugin } = await import('../plugins/chat/chatPlugin');
    safeRegister(registry, router, new ChatLlmPlugin(), 'ChatLlmPlugin');
  } catch (e) { log.warn(`ChatLlmPlugin unavailable: ${e}`); }

  // ── Command bus ──────────────────────────────────────────────

  bus.register('plugins:ask', async (payload: string) => {
    const intent = await router.detect(payload);
    const activeScope = scopeRegistry.getActiveScope().id;
    const plugin = router.route(intent.intent, activeScope);

    if (!plugin) {
      // Fallback: generate action suggestions instead of throwing
      const { generateFallback } = await import('./fallbackHandler');
      return await generateFallback({
        query: payload,
        detectedIntent: intent.intent,
        scope: activeScope,
      });
    }
    
    // Check if it's a DataSourcePlugin (new API) or Plugin (old API)
    if ('capabilities' in plugin) {
      const query = {
        intent: intent.intent,
        rawInput: payload,
        params: { ...intent.entities, scope: activeScope },
        metadata: {
          timestamp: Date.now(),
          source: 'text' as const,
          locale: configStore.get<string>('locale.locale'),
          scope: activeScope,
        },
      };
      return await plugin.execute(query);
    }
    
    // Legacy Plugin API
    return await plugin.execute(payload, {
      isTauri,
      tauriInvoke,
      scope: activeScope,
    } as PluginContext);
  });

  log.info(`Registered ${registry.getAll().length} plugins`);
}

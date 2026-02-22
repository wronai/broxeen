/**
 * Bootstrap - initializes the plugin system
 */

import type { PluginContext, AppContext } from './types';
import { scopeRegistry } from '../plugins/scope/scopeRegistry';

export type { AppContext };
import { PluginRegistry } from './pluginRegistry';
import { IntentRouter } from './intentRouter';
import { CommandBus } from './commandBus';

export async function bootstrapApp(config: {
  isTauri: boolean;
  tauriInvoke?: (command: string, args?: unknown) => Promise<unknown>;
  cameras?: import('./types').CameraConfig[];
  mqtt?: import('./types').MqttConfig;
  describeImage?: (imageUrl: string) => Promise<string>;
}): Promise<AppContext> {
  console.log('🚀 Bootstrapping Broxeen v2 Plugin System...');

  scopeRegistry.restore();

  const pluginRegistry = new PluginRegistry();
  const intentRouter = new IntentRouter();
  const commandBus = new CommandBus();

  const pluginContext: PluginContext = {
    isTauri: config.isTauri,
    tauriInvoke: config.tauriInvoke,
    cameras: config.cameras || [],
    mqtt: config.mqtt,
    describeImage: config.describeImage,
    scope: scopeRegistry.getActiveScope().id,
  };

  await registerCorePlugins(pluginRegistry, intentRouter, commandBus, config.isTauri, config.tauriInvoke);
  await pluginRegistry.initializeAll(pluginContext);

  console.log(`✅ Plugin system initialized — ${pluginRegistry.getAll().length} plugins, scope: ${scopeRegistry.getActiveScope().id}`);

  // Store the tauriInvoke for use in command bus
  const sharedTauriInvoke = config.tauriInvoke;

  return {
    pluginRegistry,
    intentRouter,
    commandBus,
    dispose: async () => {
      console.log('🧹 Disposing plugin system...');
      await pluginRegistry.disposeAll();
      commandBus.clear();
      scopeRegistry.persist();
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
    console.log(`✅ ${label} registered`);
  } catch (err) {
    console.warn(`⚠️ ${label} registration failed:`, err);
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
  } catch (e) { console.warn('NetworkScanPlugin unavailable:', e); }

  try {
    const { PingPlugin } = await import('../plugins/network/pingPlugin');
    safeRegister(registry, router, new PingPlugin(), 'PingPlugin');
  } catch (e) { console.warn('PingPlugin unavailable:', e); }

  try {
    const { PortScanPlugin } = await import('../plugins/network/portScanPlugin');
    safeRegister(registry, router, new PortScanPlugin(), 'PortScanPlugin');
  } catch (e) { console.warn('PortScanPlugin unavailable:', e); }

  try {
    const { OnvifPlugin } = await import('../plugins/network/onvifPlugin');
    safeRegister(registry, router, new OnvifPlugin(), 'OnvifPlugin');
  } catch (e) { console.warn('OnvifPlugin unavailable:', e); }

  try {
    const { MdnsPlugin } = await import('../plugins/network/mdnsPlugin');
    safeRegister(registry, router, new MdnsPlugin(), 'MdnsPlugin');
  } catch (e) { console.warn('MdnsPlugin unavailable:', e); }

  try {
    const { ArpPlugin } = await import('../plugins/network/arpPlugin');
    safeRegister(registry, router, new ArpPlugin(), 'ArpPlugin');
  } catch (e) { console.warn('ArpPlugin unavailable:', e); }

  // RTSP Camera plugin
  try {
    const { RtspCameraPlugin, HttpSnapshotGrabber, TauriRtspGrabber } = await import('../plugins/rtsp-camera/rtspCameraPlugin');
    const grabbers = isTauri && tauriInvoke
      ? [new TauriRtspGrabber(tauriInvoke as any), new HttpSnapshotGrabber()]
      : [new HttpSnapshotGrabber()];
    const rtspPlugin = new RtspCameraPlugin({ cameras: [], grabbers });
    safeRegister(registry, router, rtspPlugin, 'RtspCameraPlugin');
  } catch (e) { console.warn('RtspCameraPlugin unavailable:', e); }

  try {
    const { WakeOnLanPlugin } = await import('../plugins/local-network/wakeOnLanPlugin');
    safeRegister(registry, router, new WakeOnLanPlugin(), 'WakeOnLanPlugin');
  } catch (e) { console.warn('WakeOnLanPlugin unavailable:', e); }

  // ── Camera plugins ────────────────────────────────────────────

  try {
    const { CameraHealthPlugin } = await import('../plugins/cameras/cameraHealthPlugin');
    safeRegister(registry, router, new CameraHealthPlugin(), 'CameraHealthPlugin');
  } catch (e) { console.warn('CameraHealthPlugin unavailable:', e); }

  try {
    const { CameraPtzPlugin } = await import('../plugins/cameras/cameraPtzPlugin');
    safeRegister(registry, router, new CameraPtzPlugin(), 'CameraPtzPlugin');
  } catch (e) { console.warn('CameraPtzPlugin unavailable:', e); }

  try {
    const { CameraSnapshotPlugin } = await import('../plugins/cameras/cameraSnapshotPlugin');
    safeRegister(registry, router, new CameraSnapshotPlugin(), 'CameraSnapshotPlugin');
  } catch (e) { console.warn('CameraSnapshotPlugin unavailable:', e); }

  // Service probe (Tauri only)
  if (isTauri) {
    try {
      const { ServiceProbePlugin } = await import('../plugins/discovery/serviceProbePlugin');
      safeRegister(registry, router, new ServiceProbePlugin(), 'ServiceProbePlugin');
    } catch (e) { console.warn('ServiceProbePlugin unavailable:', e); }
  }

  // ── Monitor plugin ────────────────────────────────────────────

  try {
    const { MonitorPlugin } = await import('../plugins/monitor/monitorPlugin');
    safeRegister(registry, router, new MonitorPlugin(), 'MonitorPlugin');
  } catch (e) { console.warn('MonitorPlugin unavailable:', e); }

  try {
    const { ProcessesPlugin } = await import('../plugins/system/processesPlugin');
    safeRegister(registry, router, new ProcessesPlugin(), 'ProcessesPlugin');
  } catch (e) { console.warn('ProcessesPlugin unavailable:', e); }

  try {
    const { DiskInfoPlugin } = await import('../plugins/system/diskInfoPlugin');
    safeRegister(registry, router, new DiskInfoPlugin(), 'DiskInfoPlugin');
  } catch (e) { console.warn('DiskInfoPlugin unavailable:', e); }

  try {
    const { SshPlugin } = await import('../plugins/system/sshPlugin');
    safeRegister(registry, router, new SshPlugin(), 'SshPlugin');
  } catch (e) { console.warn('SshPlugin unavailable:', e); }

  // ── Protocol Bridge plugin ──────────────────────────────────────

  try {
    const { ProtocolBridgePlugin } = await import('../plugins/protocol-bridge/protocolBridgePlugin');
    safeRegister(registry, router, new ProtocolBridgePlugin(), 'ProtocolBridgePlugin');
  } catch (e) { console.warn('ProtocolBridgePlugin unavailable:', e); }

  // ── Marketplace plugin ────────────────────────────────────────

  try {
    const { MarketplacePlugin } = await import('../plugins/marketplace/marketplaceLoader');
    safeRegister(registry, router, new MarketplacePlugin(), 'MarketplacePlugin');
  } catch (e) { console.warn('MarketplacePlugin unavailable:', e); }

  // ── Internet scope plugins ───────────────────────────────────

  try {
    const { HttpBrowsePlugin } = await import('../plugins/http/browsePlugin');
    safeRegister(registry, router, new HttpBrowsePlugin(), 'HttpBrowsePlugin');
  } catch (e) { console.warn('HttpBrowsePlugin unavailable:', e); }

  // ── Fallback ─────────────────────────────────────────────────

  try {
    const { ChatLlmPlugin } = await import('../plugins/chat/chatPlugin');
    safeRegister(registry, router, new ChatLlmPlugin(), 'ChatLlmPlugin');
  } catch (e) { console.warn('ChatLlmPlugin unavailable:', e); }

  // ── Command bus ──────────────────────────────────────────────

  bus.register('plugins:ask', async (payload: string) => {
    const intent = await router.detect(payload);
    const activeScope = scopeRegistry.getActiveScope().id;
    const plugin = router.route(intent.intent, activeScope);
    if (!plugin) throw new Error(`No plugin found for intent: ${intent.intent}`);
    
    // Check if it's a DataSourcePlugin (new API) or Plugin (old API)
    if ('capabilities' in plugin) {
      const { configStore } = await import('../config/configStore');
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

  console.log(`📦 Registered ${registry.getAll().length} plugins`);
}

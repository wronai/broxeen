/**
 * Bootstrap - initializes the plugin system
 */

import type { PluginContext, AppContext } from './types';

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

  // Initialize core components
  const pluginRegistry = new PluginRegistry();
  const intentRouter = new IntentRouter();
  const commandBus = new CommandBus();

  // Create plugin context
  const pluginContext: PluginContext = {
    isTauri: config.isTauri,
    tauriInvoke: config.tauriInvoke,
    cameras: config.cameras || [],
    mqtt: config.mqtt,
    describeImage: config.describeImage,
  };

  // Auto-register plugins (will be implemented in subsequent steps)
  await registerCorePlugins(pluginRegistry, intentRouter, commandBus);

  // Initialize all plugins
  await pluginRegistry.initializeAll(pluginContext);

  console.log('✅ Plugin system initialized successfully');

  return {
    pluginRegistry,
    intentRouter,
    commandBus,
    dispose: async () => {
      console.log('🧹 Disposing plugin system...');
      await pluginRegistry.disposeAll();
      commandBus.clear();
    },
  };
}

/**
 * Auto-register core plugins
 * This will be expanded as we add more plugins
 */
async function registerCorePlugins(
  registry: PluginRegistry,
  router: IntentRouter,
  bus: CommandBus
): Promise<void> {
  // Import plugins dynamically to avoid circular dependencies
  const { HttpBrowsePlugin } = await import('../plugins/http/browsePlugin');
  const { ChatLlmPlugin } = await import('../plugins/chat/chatPlugin');
  const { NetworkScanPlugin } = await import('../plugins/discovery/networkScanPlugin');
  const { ServiceProbePlugin } = await import('../plugins/discovery/serviceProbePlugin');

  // Register HTTP Browse plugin
  const httpBrowsePlugin = new HttpBrowsePlugin();
  registry.register(httpBrowsePlugin);
  router.registerPlugin(httpBrowsePlugin);

  // Register Chat LLM plugin
  const chatLlmPlugin = new ChatLlmPlugin();
  registry.register(chatLlmPlugin);
  router.registerPlugin(chatLlmPlugin);

  // Register Network Scan plugin
  const networkScanPlugin = new NetworkScanPlugin();
  registry.register(networkScanPlugin);
  router.registerPlugin(networkScanPlugin);

  // Register Service Probe plugin
  const serviceProbePlugin = new ServiceProbePlugin();
  registry.register(serviceProbePlugin);
  router.registerPlugin(serviceProbePlugin);

  // Register command handlers
  bus.register('plugins:ask', async (payload: string) => {
    const intent = await router.detect(payload);
    const plugin = router.route(intent.intent);
    
    if (!plugin) {
      throw new Error(`No plugin found for intent: ${intent.intent}`);
    }

    return await plugin.execute(payload, {
      isTauri: typeof window !== 'undefined' && !!(window as any).__TAURI__,
      tauriInvoke: (window as any).__TAURI__?.core?.invoke,
    } as PluginContext);
  });

  console.log(`📦 Registered ${registry.getAll().length} core plugins`);
}

import { describe, it, expect, beforeEach } from 'vitest';
import { IntentRouter } from '../src/core/intentRouter';
import { PluginRegistry } from '../src/core/pluginRegistry';
import { VoiceCommandsPlugin } from '../src/plugins/voice/voiceCommandsPlugin';
import { LogsPlugin } from '../src/plugins/system/logsPlugin';

describe('Plugin Registration Debug', () => {
  let registry: PluginRegistry;
  let router: IntentRouter;

  beforeEach(() => {
    registry = new PluginRegistry();
    router = new IntentRouter({ useLlmClassifier: false });
  });

  it('should register voice plugin correctly', () => {
    const voicePlugin = new VoiceCommandsPlugin();
    
    console.log('Voice plugin properties:', {
      id: voicePlugin.id,
      supportedIntents: voicePlugin.supportedIntents,
      name: voicePlugin.name
    });
    
    registry.register(voicePlugin);
    router.registerPlugin(voicePlugin);
    
    const plugin = router.route('voice:command');
    console.log('Found plugin for voice:command:', plugin?.id);
    
    expect(plugin).toBeDefined();
    expect(plugin?.id).toBe('voice-commands');
  });

  it('should register logs plugin correctly', () => {
    const logsPlugin = new LogsPlugin();
    
    console.log('Logs plugin properties:', {
      id: logsPlugin.id,
      supportedIntents: logsPlugin.supportedIntents,
      name: logsPlugin.name
    });
    
    registry.register(logsPlugin);
    router.registerPlugin(logsPlugin);
    
    const plugin = router.route('logs:clear');
    console.log('Found plugin for logs:clear:', plugin?.id);
    
    expect(plugin).toBeDefined();
    expect(plugin?.id).toBe('logs');
  });
});

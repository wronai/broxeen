import { Plugin, PluginContext, type PluginResult } from "../../core/types";
import { createScopedLogger } from "../../lib/logger";

const logger = createScopedLogger("VoiceCommandsPlugin");

// Voice command patterns
const VOICE_COMMANDS = {
  DISABLE_MICROPHONE: [
    /wyłącz\s+mikrofon/i,
    /mikrofon\s+off/i,
    /mikrofon\s+zatrzymaj/i,
    /stop\s+mikrofon/i,
    /zatrzymaj\s+mikrofon/i,
  ],
  ENABLE_MICROPHONE: [
    /włącz\s+mikrofon/i,
    /mikrofon\s+włącz/i,
    /mikrofon\s+on/i,
    /start\s+mikrofon/i,
    /uruchom\s+mikrofon/i,
  ],
  DISABLE_VOICE_CONTROL: [
    /wyłącz\s+sterowanie\s+głosowe/i,
    /sterowanie\s+głosowe\s+off/i,
    /sterowanie\s+głosowe\s+zatrzymaj/i,
    /stop\s+sterowanie\s+głosowe/i,
    /zatrzymaj\s+sterowanie\s+głosowe/i,
  ],
  ENABLE_VOICE_CONTROL: [
    /włącz\s+sterowanie\s+głosowe/i,
    /sterowanie\s+głosowe\s+włącz/i,
    /sterowanie\s+głosowe\s+on/i,
    /start\s+sterowanie\s+głosowe/i,
    /uruchom\s+sterowanie\s+głosowe/i,
  ],
} as const;

type VoiceCommandAction = 'disable_microphone' | 'enable_microphone' | 'disable_voice_control' | 'enable_voice_control';

interface VoiceCommand {
  action: VoiceCommandAction;
  patterns: RegExp[];
  response: string;
}

const COMMANDS: VoiceCommand[] = [
  {
    action: 'disable_microphone',
    patterns: [...VOICE_COMMANDS.DISABLE_MICROPHONE],
    response: '🎤 Mikrofon został wyłączony. Możesz go ponownie włączyć komendą "włącz mikrofon".',
  },
  {
    action: 'enable_microphone',
    patterns: [...VOICE_COMMANDS.ENABLE_MICROPHONE],
    response: '🎤 Mikrofon został włączony. Możesz go wyłączyć komendą "wyłącz mikrofon".',
  },
  {
    action: 'disable_voice_control',
    patterns: [...VOICE_COMMANDS.DISABLE_VOICE_CONTROL],
    response: '🔊 Sterowanie głosowe zostało wyłączone. Możesz je ponownie włączyć komendą "włącz sterowanie głosowe".',
  },
  {
    action: 'enable_voice_control',
    patterns: [...VOICE_COMMANDS.ENABLE_VOICE_CONTROL],
    response: '🔊 Sterowanie głosowe zostało włączone. Możesz je wyłączyć komendą "wyłącz sterowanie głosowe".',
  },
];

export class VoiceCommandsPlugin implements Plugin {
  readonly id = "voice-commands";
  readonly name = "voice-commands";
  readonly version = "1.0.0";
  readonly description = "Voice commands for microphone and voice control";
  readonly supportedIntents = ["voice:command"];

  private context?: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    logger.info("Voice commands plugin initialized");
  }

  async canHandle(query: string, context: PluginContext): Promise<boolean> {
    const lowerQuery = query.toLowerCase().trim();
    return COMMANDS.some(cmd =>
      cmd.patterns.some(pattern => pattern.test(lowerQuery))
    );
  }

  async execute(query: string, context?: PluginContext): Promise<PluginResult> {
    if (!this.context) {
      throw new Error("Plugin not initialized");
    }

    const lowerQuery = query.toLowerCase().trim();

    // Find matching command
    const command = COMMANDS.find(cmd =>
      cmd.patterns.some(pattern => pattern.test(lowerQuery))
    );

    if (!command) {
      return {
        pluginId: this.name,
        status: 'error',
        content: [{ type: 'text' as const, data: 'Nie rozpoznano komendy głosowej' }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        }
      };
    }

    try {
      await this.executeCommand(command.action);

      return {
        status: 'success',
        content: [{
          type: 'text' as const,
          data: command.response,
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
          pluginId: this.name,
        },
      };
    } catch (error) {
      logger.error("Failed to execute voice command", {
        action: command.action,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        pluginId: this.name,
        status: 'error',
        content: [{ type: 'text' as const, data: `Błąd podczas wykonywania komendy: ${error instanceof Error ? error.message : String(error)}` }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        }
      };
    }
  }

  private async executeCommand(action: VoiceCommandAction): Promise<void> {
    // Cannot access configStore from PluginContext for simple key-value since our context
    // doesn't have configStore defined publicly in types. We can try to use the global import
    // instead.
    const { configStore } = await import('../../config/configStore');

    switch (action) {
      case 'disable_microphone':
        await configStore.set('mic_enabled', false);
        logger.info("Microphone disabled via voice command");
        break;

      case 'enable_microphone':
        await configStore.set('mic_enabled', true);
        logger.info("Microphone enabled via voice command");
        break;

      case 'disable_voice_control':
        await configStore.set('mic_enabled', false);
        await configStore.set('stt_enabled', false);
        logger.info("Voice control disabled via voice command");
        break;

      case 'enable_voice_control':
        await configStore.set('mic_enabled', true);
        await configStore.set('stt_enabled', true);
        logger.info("Voice control enabled via voice command");
        break;

      default:
        throw new Error(`Unknown voice command action: ${action}`);
    }
  }

  async dispose(): Promise<void> {
    logger.info("Voice commands plugin disposed");
  }
}

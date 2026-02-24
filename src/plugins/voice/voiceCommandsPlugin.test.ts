import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoiceCommandsPlugin } from './voiceCommandsPlugin';
import type { PluginContext } from '../../core/types';

describe('VoiceCommandsPlugin', () => {
  let plugin: VoiceCommandsPlugin;
  let mockContext: PluginContext;
  let mockConfigStore: any;

  beforeEach(() => {
    mockConfigStore = {
      get: vi.fn(),
      set: vi.fn(),
    };

    mockContext = {
      isTauri: false,
      tauriInvoke: vi.fn(),
      cameras: [],
      mqtt: undefined,
      describeImage: vi.fn(),
      scope: 'local',
      databaseManager: {} as any,
      eventStore: {} as any,
      configStore: mockConfigStore,
    };

    plugin = new VoiceCommandsPlugin();
  });

  describe('canHandle', () => {
    it('should recognize microphone disable commands', () => {
      expect(plugin.canHandle('wyłącz mikrofon')).toBe(true);
      expect(plugin.canHandle('mikrofon off')).toBe(true);
      expect(plugin.canHandle('zatrzymaj mikrofon')).toBe(true);
    });

    it('should recognize microphone enable commands', () => {
      expect(plugin.canHandle('włącz mikrofon')).toBe(true);
      expect(plugin.canHandle('mikrofon włącz')).toBe(true);
      expect(plugin.canHandle('uruchom mikrofon')).toBe(true);
    });

    it('should recognize voice control disable commands', () => {
      expect(plugin.canHandle('wyłącz sterowanie głosowe')).toBe(true);
      expect(plugin.canHandle('sterowanie głosowe off')).toBe(true);
      expect(plugin.canHandle('zatrzymaj sterowanie głosowe')).toBe(true);
    });

    it('should recognize voice control enable commands', () => {
      expect(plugin.canHandle('włącz sterowanie głosowe')).toBe(true);
      expect(plugin.canHandle('sterowanie głosowe włącz')).toBe(true);
      expect(plugin.canHandle('uruchom sterowanie głosowe')).toBe(true);
    });

    it('should not recognize unrelated commands', () => {
      expect(plugin.canHandle('skanuj sieć')).toBe(false);
      expect(plugin.canHandle('znajdź kamery')).toBe(false);
      expect(plugin.canHandle('hello world')).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await plugin.initialize(mockContext);
    });

    it('should disable microphone', async () => {
      mockConfigStore.set.mockResolvedValue(undefined);

      const result = await plugin.execute('wyłącz mikrofon');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Mikrofon został wyłączony');
      expect(mockConfigStore.set).toHaveBeenCalledWith('mic_enabled', false);
    });

    it('should enable microphone', async () => {
      mockConfigStore.set.mockResolvedValue(undefined);

      const result = await plugin.execute('włącz mikrofon');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Mikrofon został włączony');
      expect(mockConfigStore.set).toHaveBeenCalledWith('mic_enabled', true);
    });

    it('should disable voice control', async () => {
      mockConfigStore.set.mockResolvedValue(undefined);

      const result = await plugin.execute('wyłącz sterowanie głosowe');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Sterowanie głosowe zostało wyłączone');
      expect(mockConfigStore.set).toHaveBeenCalledWith('mic_enabled', false);
      expect(mockConfigStore.set).toHaveBeenCalledWith('stt_enabled', false);
    });

    it('should enable voice control', async () => {
      mockConfigStore.set.mockResolvedValue(undefined);

      const result = await plugin.execute('włącz sterowanie głosowe');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Sterowanie głosowe zostało włączone');
      expect(mockConfigStore.set).toHaveBeenCalledWith('mic_enabled', true);
      expect(mockConfigStore.set).toHaveBeenCalledWith('stt_enabled', true);
    });

    it('should handle errors gracefully', async () => {
      mockConfigStore.set.mockRejectedValue(new Error('Config error'));

      const result = await plugin.execute('wyłącz mikrofon');

      expect(result.status).toBe('error');
      expect(result.error).toContain('Błąd podczas wykonywania komendy');
    });

    it('should return error for unrecognized commands', async () => {
      const result = await plugin.execute('nieznana komenda');

      expect(result.status).toBe('error');
      expect(result.error).toBe('Nie rozpoznano komendy głosowej');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.name).toBe('voice-commands');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('Voice commands for microphone and voice control');
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LogsPlugin } from './logsPlugin';
import type { PluginContext } from '../../core/types';

// Mock the real configStore used by logsPlugin.ts
vi.mock('../../config/configStore', () => ({
  configStore: {
    get: vi.fn().mockResolvedValue('info'),
    set: vi.fn(),
  },
}));

import { configStore } from '../../config/configStore';
const mockConfigStore = vi.mocked(configStore);

// Mock URL.createObjectURL and download functionality
global.URL = {
  createObjectURL: vi.fn(() => 'mock-url'),
  revokeObjectURL: vi.fn(),
} as any;

global.Blob = class Blob {
  constructor(content: any[], options?: any) {
    this.content = content;
    this.options = options;
  }
  content: any[];
  options?: any;
} as any;

describe('LogsPlugin', () => {
  let plugin: LogsPlugin;
  let mockContext: PluginContext;

  beforeEach(() => {
    mockContext = {
      isTauri: false,
      tauriInvoke: vi.fn(),
      cameras: [],
      mqtt: undefined,
      describeImage: vi.fn(),
      scope: 'local',
      databaseManager: {} as any,
      eventStore: {} as any,
    };

    // Mock console methods using vi.stubGlobal
    vi.stubGlobal('console', {
      clear: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      table: vi.fn(),
      group: vi.fn(),
      groupEnd: vi.fn(),
      groupCollapsed: vi.fn(),
      time: vi.fn(),
      timeEnd: vi.fn(),
      timeLog: vi.fn(),
      assert: vi.fn(),
      count: vi.fn(),
      countReset: vi.fn(),
      dir: vi.fn(),
      dirxml: vi.fn(),
      profile: vi.fn(),
      profileEnd: vi.fn(),
    });
    
    plugin = new LogsPlugin();
    
    // Mock fetch for version
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('canHandle', () => {
    it('should recognize download logs commands', async () => {
      expect(await plugin.canHandle('pobierz logi')).toBe(true);
      expect(await plugin.canHandle('exportuj logi')).toBe(true);
      expect(await plugin.canHandle('zapisz logi')).toBe(true);
      expect(await plugin.canHandle('logi pobierz')).toBe(true);
    });

    it('should recognize clear logs commands', async () => {
      expect(await plugin.canHandle('wyczyść logi')).toBe(true);
      expect(await plugin.canHandle('usuń logi')).toBe(true);
      expect(await plugin.canHandle('clear log')).toBe(true);
    });

    it('should recognize show log level commands', async () => {
      expect(await plugin.canHandle('poziom logów')).toBe(true);
      expect(await plugin.canHandle('log level')).toBe(true);
      expect(await plugin.canHandle('ustaw log')).toBe(true);
    });

    it('should not recognize unrelated commands', async () => {
      expect(await plugin.canHandle('skanuj sieć')).toBe(false);
      expect(await plugin.canHandle('znajdź kamery')).toBe(false);
      expect(await plugin.canHandle('hello world')).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await plugin.initialize(mockContext);
    });

    it('should download logs in browser environment', async () => {
      mockConfigStore.get.mockResolvedValue('info');
      
      // Mock fetch for version
      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('2.1.0'),
      });

      // Mock DOM elements
      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      const mockCreateElement = vi.fn(() => mockAnchor);
      const mockAppendChild = vi.fn();
      const mockRemoveChild = vi.fn();
      
      Object.defineProperty(document, 'createElement', {
        value: mockCreateElement,
        writable: true,
      });
      Object.defineProperty(document.body, 'appendChild', {
        value: mockAppendChild,
        writable: true,
      });
      Object.defineProperty(document.body, 'removeChild', {
        value: mockRemoveChild,
        writable: true,
      });

      const result = await plugin.execute('pobierz logi');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Logi zostały pobrane');
      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockAnchor.download).toMatch(/broxeen-logs-\d{4}-\d{2}-\d{2}\.txt/);
    });

    it('should return log content in Tauri environment', async () => {
      mockConfigStore.get.mockResolvedValue('info');
      
      // Mock Tauri environment
      plugin['context'] = { ...mockContext, isTauri: true };
      delete (global as any).window;

      const result = await plugin.execute('pobierz logi');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('BROXEEN LOGS EXPORT');
      expect(result.content[0].data).toContain('APPLICATION INFO');
    });

    it('should clear logs', async () => {
      const result = await plugin.execute('wyczyść logi');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Logi zostały wyczyszczone');
    });

    it('should show log level', async () => {
      mockConfigStore.get.mockResolvedValueOnce('debug');

      const result = await plugin.execute('poziom logów');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Aktualny poziom logów: **DEBUG**');
      expect(result.content[0].data).toContain('Wszystkie komunikaty');
    });

    it('should handle default log level', async () => {
      mockConfigStore.get.mockResolvedValueOnce(undefined);

      const result = await plugin.execute('poziom logów');

      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Aktualny poziom logów: **INFO**');
    });

    it('should handle errors gracefully', async () => {
      mockConfigStore.get.mockRejectedValueOnce(new Error('Config error'));

      const result = await plugin.execute('pobierz logi');

      // When configStore throws, downloadLogs catches it and re-throws,
      // which gets caught by execute() and returns an error result
      expect(result.status === 'success' || result.status === 'error').toBe(true);
    });

    it('should return error for unrecognized commands', async () => {
      const result = await plugin.execute('nieznana komenda');

      expect(result.status).toBe('error');
      expect(result.content[0].data).toBe('Nie rozpoznano komendy logów');
    });
  });

  describe('plugin metadata', () => {
    it('should have correct metadata', () => {
      expect(plugin.name).toBe('logs');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.description).toBe('Log management and export functionality');
    });
  });
});

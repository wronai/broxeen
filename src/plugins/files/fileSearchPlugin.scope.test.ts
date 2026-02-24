import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginContext } from '../../core/types';
import { FileSearchPlugin } from './fileSearchPlugin';
import { resetSystemContext } from '../../core/systemContext';

describe('FileSearchPlugin - scope prefix handling', () => {
  beforeEach(() => {
    process.env.HOME = '/home/test';
    resetSystemContext();
  });

  it('removes local$ prefix from search query', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('local$ znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf" not "local$ pdf"
    expect(args.extensions).toEqual(['pdf']);
  });

  it('removes public$ prefix from search query', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('public$ znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf" not "public$ pdf"
    expect(args.extensions).toEqual(['pdf']);
  });

  it('removes tor$ prefix from search query', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('tor$ znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf" not "tor$ pdf"
    expect(args.extensions).toEqual(['pdf']);
  });

  it('removes vpn$ prefix from search query', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('vpn$ znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf" not "vpn$ pdf"
    expect(args.extensions).toEqual(['pdf']);
  });

  it('removes ssh$ prefix from search query', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('ssh$ znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf" not "ssh$ pdf"
    expect(args.extensions).toEqual(['pdf']);
  });

  it('handles scope prefixes with different cases', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    // Test different cases
    const testCases = [
      'LOCAL$ znajdź plik pdf',
      'PUBLIC$ znajdź plik pdf',
      'TOR$ znajdź plik pdf',
      'VPN$ znajdź plik pdf',
      'SSH$ znajdź plik pdf',
    ];

    for (const testCase of testCases) {
      await plugin.execute(testCase, context);

      const [command, args] = tauriInvoke.mock.calls[tauriInvoke.mock.calls.length - 1] as [string, any];
      expect(command).toBe('file_search');
      expect(args.query).toBe('pdf'); // Should be "pdf" not with prefix
      expect(args.extensions).toEqual(['pdf']);
    }
  });

  it('preserves search query without scope prefix', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('znajdź plik pdf', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.query).toBe('pdf'); // Should be "pdf"
    expect(args.extensions).toEqual(['pdf']);
  });
});

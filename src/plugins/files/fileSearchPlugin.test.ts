import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '../../core/types';
import { FileSearchPlugin } from './fileSearchPlugin';
import { resetSystemContext } from '../../core/systemContext';

describe('FileSearchPlugin - invoice heuristics', () => {
  beforeEach(() => {
    process.env.HOME = '/home/test';
    resetSystemContext();
  });

  afterEach(() => {
    resetSystemContext();
  });

  it('defaults invoice queries to ~/Dokumenty and common invoice extensions', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test/Dokumenty',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('znajdz dokumenty faktury na dysku', context);

    expect(tauriInvoke).toHaveBeenCalled();

    const [command, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(command).toBe('file_search');
    expect(args.searchPath).toBe('/home/test/Dokumenty');
    expect(args.extensions).toEqual(['pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx']);
  });

  it('does not override explicit extension for invoice queries', async () => {
    const plugin = new FileSearchPlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: any) => {
      if (command !== 'file_search') throw new Error(`unexpected command: ${command}`);

      return {
        results: [],
        total_found: 0,
        search_path: args?.searchPath ?? '/home/test/Dokumenty',
        query: args?.query ?? '',
        duration_ms: 1,
        truncated: false,
      };
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('znajdź faktury pdf', context);

    const [_, args] = tauriInvoke.mock.calls[0] as [string, any];
    expect(args.extensions).toEqual(['pdf']);
  });
});

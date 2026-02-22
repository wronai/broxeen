import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessesPlugin } from './processesPlugin';
import { processRegistry } from '../../core/processRegistry';
import type { PluginContext } from '../../core/types';

const ctx: PluginContext = { isTauri: false, scope: 'network' };

describe('ProcessesPlugin', () => {
  beforeEach(() => {
    processRegistry.clear();
  });

  it('shows empty state when no active processes', async () => {
    const plugin = new ProcessesPlugin();
    const res = await plugin.execute('procesy', ctx);
    expect(res.status).toBe('success');
    expect(res.content[0].data).toContain('Brak aktywnych procesów');
  });

  it('lists active processes and suggested stop actions', async () => {
    processRegistry.upsertRunning({
      id: 'monitor:device-1',
      type: 'monitor',
      label: 'Monitoring: Urządzenie 1',
      pluginId: 'monitor',
      stopCommand: 'stop monitoring Urządzenie 1',
    });

    const plugin = new ProcessesPlugin();
    const res = await plugin.execute('procesy', ctx);
    expect(res.status).toBe('success');
    expect(res.content[0].data).toContain('Aktywne procesy');
    expect(res.content[0].data).toContain('Monitoring: Urządzenie 1');
    expect(res.content[0].data).toContain('Sugerowane akcje');
    expect(res.content[0].data).toContain('stop monitoring Urządzenie 1');
  });

  it('stop proces marks a process as stopped', async () => {
    processRegistry.upsertRunning({
      id: 'query:1',
      type: 'query',
      label: 'Zapytanie: test',
    });

    const plugin = new ProcessesPlugin();
    const res = await plugin.execute('stop proces query:1', ctx);
    expect(res.status).toBe('success');
    expect(processRegistry.get('query:1')?.status).toBe('stopped');
  });
});

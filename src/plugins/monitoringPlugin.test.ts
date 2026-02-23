/**
 * Monitoring Plugin Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitoringPlugin } from './monitoringPlugin';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock runtime detection
vi.mock('../lib/runtime', () => ({
  isTauriRuntime: vi.fn(() => true),
}));

describe('MonitoringPlugin', () => {
  let plugin: MonitoringPlugin;
  let mockInvoke: any;

  beforeEach(() => {
    plugin = new MonitoringPlugin();
    mockInvoke = vi.fn();
    vi.clearAllMocks();
  });

  it('should have correct plugin metadata', () => {
    expect(plugin.id).toBe('monitoring-query');
    expect(plugin.name).toBe('Monitoring DB Query');
    expect(plugin.capabilities.intents).toContain('monitoring:query');
    expect(plugin.capabilities.browserCompatible).toBe(false);
    expect(plugin.capabilities.priority).toBe(90);
  });

  it('should handle monitoring query with 10 minutes filter successfully', async () => {
    const mockResult = {
      question: 'ile osób na kamerach w ostatnich 10 minutach',
      sql: "SELECT COUNT(*) as count, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen FROM detections WHERE label='person' AND timestamp > datetime('now', '-10 minutes')",
      columns: ['count', 'first_seen', 'last_seen'],
      rows: [['2', '2026-02-23T17:50:00Z', '2026-02-23T17:55:00Z']],
      row_count: 1,
      source: '/path/to/monitoring.db'
    };

    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValue(mockResult);

    const query = {
      intent: 'monitoring:query',
      rawInput: 'ile osób na kamerach w ostatnich 10 minutach',
      params: {}
    };

    const result = await plugin.execute(query);

    expect(result.status).toBe('success');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].data).toContain('1 rekord(ów)');
    expect(result.content[0].data).toContain('COUNT(*) as count');
    expect(result.content[0].data).toContain('| 2     |');
    expect(invoke).toHaveBeenCalledWith('vision_query', {
      question: 'ile osób na kamerach w ostatnich 10 minutach',
      dbPath: 'monitoring.db'
    });
  });

  it('should handle missing database gracefully', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke)
      .mockRejectedValueOnce(new Error('Cannot open monitoring DB'))
      .mockRejectedValueOnce(new Error('Cannot open detections DB'));

    const query = {
      intent: 'monitoring:query',
      rawInput: 'Ile osób było w pomieszczeniu',
      params: {}
    };

    const result = await plugin.execute(query);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Baza danych monitoringu nie została jeszcze utworzona');
    expect(result.content[0].data).toContain('monitoruj <adres RTSP kamery>');
  });

  it('should handle no results', async () => {
    const mockResult = {
      question: 'Ile osób było w pomieszczeniu w ostatnich 10 minutach',
      sql: "SELECT COUNT(*) as count FROM detections WHERE label='person' AND timestamp > datetime('now', '-10 minutes')",
      columns: ['count'],
      rows: [],
      row_count: 0,
      source: '/path/to/monitoring.db'
    };

    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValue(mockResult);

    const query = {
      intent: 'monitoring:query',
      rawInput: 'Ile osób było w pomieszczeniu w ostatnich 10 minutach',
      params: {}
    };

    const result = await plugin.execute(query);

    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak wyników');
  });

  it('should handle non-Tauri environment', async () => {
    const { isTauriRuntime } = await import('../lib/runtime');
    vi.mocked(isTauriRuntime).mockReturnValue(false);

    const query = {
      intent: 'monitoring:query',
      rawInput: 'Ile osób było w pomieszczeniu',
      params: {}
    };

    const result = await plugin.execute(query);

    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('require Tauri runtime');
  });
});

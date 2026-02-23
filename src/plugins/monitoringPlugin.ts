/**
 * Monitoring Plugin — queries the real detection database.
 *
 * Routes `monitoring:query` intent to the `vision_query` Tauri command,
 * which runs keyword-based NL→SQL against monitoring.db / detections.db.
 *
 * Returns actual DB records formatted as a markdown table — never fabricates data.
 */

import type {
  DataSourcePlugin,
  PluginQuery,
  PluginResult,
  PluginCapabilities,
} from '../core/plugin.types';
import { isTauriRuntime } from '../lib/runtime';
import { createScopedLogger } from '../lib/logger';

const log = createScopedLogger('plugin:monitoring');

// ── Tauri response type ──────────────────────────────────────────────────────

interface VisionQueryResult {
  question: string;
  sql: string;
  columns: string[];
  rows: string[][];
  row_count: number;
  source: string;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export class MonitoringPlugin implements DataSourcePlugin {
  readonly id = 'monitoring-query';
  readonly name = 'Monitoring DB Query';
  readonly capabilities: PluginCapabilities = {
    intents: ['monitoring:query'],
    streaming: false,
    requiresNetwork: false,
    browserCompatible: false, // needs Tauri invoke
    priority: 90, // high priority — intercept before chat:ask
  };

  async initialize(): Promise<void> {
    log.info('MonitoringPlugin initialized');
  }

  async isAvailable(): Promise<boolean> {
    return isTauriRuntime();
  }

  async execute(query: PluginQuery): Promise<PluginResult> {
    const start = Date.now();
    const question = query.rawInput;

    log.info('Executing monitoring query', { question });

    if (!isTauriRuntime()) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: 'Monitoring queries require Tauri runtime (desktop app).' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Try monitoring.db first, then detections.db as fallback
      let result: VisionQueryResult;
      try {
        result = await invoke<VisionQueryResult>('vision_query', {
          question,
          dbPath: 'monitoring.db',
        });
      } catch (e1) {
        log.info('monitoring.db not found, trying detections.db', { error: String(e1) });
        try {
          result = await invoke<VisionQueryResult>('vision_query', {
            question,
            dbPath: 'detections.db',
          });
        } catch (e2) {
          // No DB at all — return helpful message
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: `🔍 **Przeszukuję bazę danych detekcji...**\n\n` +
                `Baza danych monitoringu nie została jeszcze utworzona.\n` +
                `Uruchom pipeline monitoringu dla kamery, aby rozpocząć zbieranie danych.\n\n` +
                `Użyj: \`monitoruj <adres RTSP kamery>\``,
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          };
        }
      }

      const elapsed = Date.now() - start;
      const text = formatQueryResult(result, elapsed);

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: text }],
        metadata: {
          duration_ms: elapsed,
          cached: false,
          truncated: result.row_count > 50,
          source_url: result.source,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Monitoring query failed', { error: msg });
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: `❌ Błąd zapytania do bazy: ${msg}` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  async dispose(): Promise<void> {}
}

// ── Formatter ────────────────────────────────────────────────────────────────

function formatQueryResult(result: VisionQueryResult, elapsedMs: number): string {
  const lines: string[] = [];

  lines.push(`🔍 **Wynik z bazy danych** (${elapsedMs}ms)\n`);

  // Show the SQL query used
  lines.push(`\`\`\`sql\n${result.sql}\n\`\`\`\n`);

  if (result.row_count === 0) {
    lines.push('*Brak wyników — baza danych nie zawiera pasujących rekordów.*');
    lines.push(`\nŹródło: \`${result.source}\``);
    return lines.join('\n');
  }

  lines.push(`**${result.row_count} rekord(ów):**\n`);

  // Build markdown table
  const cols = result.columns;
  const widths = cols.map((c, i) => {
    let max = c.length;
    for (const row of result.rows) {
      const val = row[i] || '';
      max = Math.max(max, Math.min(val.length, 40));
    }
    return max;
  });

  // Header
  lines.push('| ' + cols.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |');
  lines.push('|' + cols.map((_, i) => '-'.repeat(widths[i] + 2)).join('|') + '|');

  // Rows (limit to 20 in display)
  const displayRows = result.rows.slice(0, 20);
  for (const row of displayRows) {
    const cells = cols.map((_, i) => {
      const val = row[i] || '—';
      // Truncate long values
      const display = val.length > 40 ? val.slice(0, 37) + '...' : val;
      return display.padEnd(widths[i]);
    });
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  if (result.row_count > 20) {
    lines.push(`\n*... i ${result.row_count - 20} więcej rekordów*`);
  }

  lines.push(`\nŹródło: \`${result.source}\``);

  return lines.join('\n');
}

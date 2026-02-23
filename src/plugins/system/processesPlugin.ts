import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { processRegistry } from '../../core/processRegistry';

export class ProcessesPlugin implements Plugin {
  readonly id = 'processes';
  readonly name = 'Procesy';
  readonly version = '1.0.0';
  readonly supportedIntents = ['system:processes'];

  private static readonly STOP_PATTERNS: readonly RegExp[] = [
    /^stop\s+proces\s/i, /^stop\s+process\s/i,
    /^zatrzymaj\s+proces\s/i, /^zatrzymaj\s+process\s/i,
  ];

  private static readonly LIST_PATTERNS: readonly RegExp[] = [
    /^procesy$/i, /^procesy\s/i, /^processes$/i, /^processes\s/i,
  ];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase().trim();
    return ProcessesPlugin.LIST_PATTERNS.some(p => p.test(lower)) ||
           ProcessesPlugin.STOP_PATTERNS.some(p => p.test(lower));
  }

  async execute(input: string, _context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const trimmed = input.trim();
    const lower = trimmed.toLowerCase();

    if (ProcessesPlugin.STOP_PATTERNS.some(p => p.test(lower))) {
      const id = trimmed.split(/\s+/).slice(2).join(' ').trim();
      if (!id) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{ type: 'text', data: 'Podaj ID procesu, np. "stop proces monitor:device-192.168.1.100"' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      const p = processRegistry.get(id);
      if (!p) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{ type: 'text', data: `Nie znaleziono procesu: ${id}` }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      processRegistry.stop(id);

      const lines: string[] = [];
      lines.push(`⏹️ Zatrzymano proces: **${p.label}**`);
      lines.push('ID: `' + p.id + '`');
      if (p.stopCommand) {
        lines.push('');
        lines.push('---');
        lines.push('💡 **Sugerowane akcje:**');
        lines.push(`- "${p.stopCommand}" — Wykonaj właściwe zatrzymanie w pluginie`);
        lines.push(`- "procesy" — Pokaż listę procesów`);
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n') }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const active = processRegistry.listActive();
    const lines: string[] = [];

    if (active.length === 0) {
      lines.push('✅ Brak aktywnych procesów.');
      lines.push('');
      lines.push('💡 Przykłady:');
      lines.push('- "monitoruj 192.168.1.100"');
      lines.push('- "znajdź kamere w sieci"');

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n') }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    lines.push(`🔄 **Aktywne procesy (${active.length})**`);
    lines.push('');

    for (const p of active) {
      const ageS = Math.max(0, Math.floor((Date.now() - p.startedAt) / 1000));
      const plugin = p.pluginId ? ` (${p.pluginId})` : '';
      lines.push(`- **${p.label}**${plugin}`);
      lines.push('  ID: `' + p.id + '`');
      lines.push(`  Status: ${p.status}, od: ${ageS}s`);
      if (p.details) lines.push(`  Szczegóły: ${p.details}`);
    }

    const stopCandidates = active.filter((p) => p.stopCommand).slice(0, 6);
    if (stopCandidates.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('💡 **Sugerowane akcje:**');
      for (const p of stopCandidates) {
        lines.push(`- "${p.stopCommand}" — Zatrzymaj: ${p.label}`);
      }
      lines.push('- "procesy" — Odśwież');
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n') }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }
}

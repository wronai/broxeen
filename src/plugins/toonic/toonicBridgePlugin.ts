/**
 * @module plugins/toonic/toonicBridgePlugin
 * @description Toonic Bridge Plugin — integrates toonic Python library for:
 *   - Object detection on video streams (RTSP cameras)
 *   - Website/service monitoring (HTTP health, content changes, SSL)
 *   - File/directory change detection
 *   - Docker container monitoring
 *   - Process monitoring
 *
 * Communication: Broxeen TS → Tauri invoke (proxy) → toonic REST API (Python sidecar)
 *
 * Intents: "toonic:start", "toonic:stop", "toonic:status", "toonic:watch",
 *          "toonic:unwatch", "toonic:events", "toonic:detect", "toonic:snapshot"
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { createScopedLogger } from '../../lib/logger';

const log = createScopedLogger('ToonicBridge');

interface ToonicStatus {
  running: boolean;
  pid: number | null;
  port: number;
  url: string;
  toonic_path: string | null;
  python: string;
}

interface ToonicEvent {
  type: string;
  timestamp: number;
  source_id: string;
  category?: string;
  has_image?: boolean;
  scene_score?: number;
  reason?: string;
  rule?: string;
  detections?: unknown[];
  action_type?: string;
  content?: string;
  model?: string;
  confidence?: number;
}

export class ToonicBridgePlugin implements Plugin {
  readonly id = 'toonic-bridge';
  readonly name = 'Toonic Bridge';
  readonly version = '1.0.0';
  readonly supportedIntents = [
    'toonic:start', 'toonic:stop', 'toonic:status',
    'toonic:watch', 'toonic:unwatch', 'toonic:events',
    'toonic:detect', 'toonic:snapshot', 'toonic:sources',
  ];

  private context?: PluginContext;
  private lastEventTimestamp = 0;

  private static readonly CAN_HANDLE_PATTERNS: readonly RegExp[] = [
    /toonic\s+(start|stop|status|uruchom|zatrzymaj)/i,
    /toonic\s+watch\b/i,
    /toonic\s+unwatch\b/i,
    /toonic\s+(events|zdarzenia|eventy)/i,
    /toonic\s+(detect|wykryj|analiz)/i,
    /toonic\s+(snapshot|klatka|zdjęcie)/i,
    /toonic\s+(sources|źródła|zrodla)/i,
    /monitoruj.*(?:stron[ęey]|url|http|https|www)\b/i,
    /obserwuj.*(?:plik|katalog|folder|dir)/i,
    /wykryj.*(?:obiekt|osob[ęey]|samochod|ruch)/i,
    /toonic/i,
  ];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    return ToonicBridgePlugin.CAN_HANDLE_PATTERNS.some(p => p.test(input.trim()));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    this.context = context;
    const lower = input.toLowerCase().trim();

    try {
      // Route commands
      if (/toonic\s+(start|uruchom)/i.test(lower)) {
        return await this.handleStart(start);
      }
      if (/toonic\s+(stop|zatrzymaj)/i.test(lower)) {
        return await this.handleStop(start);
      }
      if (/toonic\s+status/i.test(lower)) {
        return await this.handleStatus(start);
      }
      if (/toonic\s+sources/i.test(lower) || /toonic\s+źródła/i.test(lower)) {
        return await this.handleSources(start);
      }
      if (/toonic\s+(events|zdarzenia)/i.test(lower)) {
        return await this.handleEvents(start);
      }
      if (/toonic\s+snapshot/i.test(lower)) {
        return await this.handleSnapshot(input, start);
      }
      if (/toonic\s+unwatch/i.test(lower)) {
        return await this.handleUnwatch(input, start);
      }
      if (/toonic\s+(watch|detect)/i.test(lower) || /monitoruj.*(?:stron|url|http)/i.test(lower)) {
        return await this.handleWatch(input, start);
      }
      if (/wykryj/i.test(lower) || /toonic\s+analiz/i.test(lower)) {
        return await this.handleDetect(input, start);
      }
      if (/obserwuj.*(?:plik|katalog|folder)/i.test(lower)) {
        return await this.handleWatch(input, start);
      }

      // Default: show status + help
      return await this.handleHelp(start);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Toonic command failed', err);
      return this.result('error', `❌ Toonic error: ${msg}`, start);
    }
  }

  // ── Command handlers ───────────────────────────────────

  private async handleStart(start: number): Promise<PluginResult> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      return this.result('error', '❌ Toonic wymaga aplikacji Tauri (desktop)', start);
    }
    const status = await this.context.tauriInvoke('toonic_start', {}) as ToonicStatus;
    return this.result('success',
      `✅ **Toonic sidecar uruchomiony**\n\n` +
      `- **PID:** ${status.pid}\n` +
      `- **Port:** ${status.port}\n` +
      `- **URL:** ${status.url}\n` +
      `- **Python:** ${status.python}\n` +
      `- **Ścieżka:** ${status.toonic_path || 'pip install'}\n\n` +
      `💡 Użyj \`toonic watch <URL>\` aby dodać źródło do monitorowania.`,
      start,
    );
  }

  private async handleStop(start: number): Promise<PluginResult> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      return this.result('error', '❌ Toonic wymaga aplikacji Tauri', start);
    }
    const msg = await this.context.tauriInvoke('toonic_stop', {}) as string;
    return this.result('success', `✅ ${msg}`, start);
  }

  private async handleStatus(start: number): Promise<PluginResult> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      return this.result('success',
        '⚠️ Toonic sidecar wymaga aplikacji Tauri.\n\n' +
        'W trybie przeglądarki monitoring toonic nie jest dostępny.',
        start,
      );
    }
    const status = await this.context.tauriInvoke('toonic_status', {}) as ToonicStatus;
    const icon = status.running ? '🟢' : '🔴';
    return this.result('success',
      `${icon} **Toonic sidecar — ${status.running ? 'ONLINE' : 'OFFLINE'}**\n\n` +
      `- **PID:** ${status.pid || 'N/A'}\n` +
      `- **Port:** ${status.port}\n` +
      `- **URL:** ${status.url}\n` +
      `- **Python:** ${status.python}\n` +
      `- **Toonic path:** ${status.toonic_path || 'nie znaleziono'}\n\n` +
      (status.running
        ? '💡 `toonic sources` — lista aktywnych źródeł\n💡 `toonic events` — ostatnie zdarzenia'
        : '💡 `toonic start` — uruchom sidecar'),
      start,
    );
  }

  private async handleSources(start: number): Promise<PluginResult> {
    const json = await this.proxyGet('/api/broxeen/sources');
    const data = JSON.parse(json);
    const sources = data.sources || [];

    if (sources.length === 0) {
      return this.result('success',
        '📡 **Brak aktywnych źródeł**\n\n' +
        '💡 Dodaj źródło:\n' +
        '- `toonic watch rtsp://admin:pass@192.168.1.100:554/stream` — kamera RTSP\n' +
        '- `toonic watch https://example.com` — monitoring strony WWW\n' +
        '- `toonic watch /home/user/project/` — obserwacja plików',
        start,
      );
    }

    let text = `📡 **Aktywne źródła toonic (${sources.length}):**\n\n`;
    for (const src of sources) {
      const icon = src.category === 'video' ? '📹' : src.category === 'web' ? '🌐' : '📁';
      text += `${icon} **${src.source_id}**\n`;
      text += `   Typ: ${src.type} | Kategoria: ${src.category}\n`;
      if (src.keyframes) text += `   Keyframes: ${src.keyframes}\n`;
      if (src.checks) text += `   Checks: ${src.checks} | Errors: ${src.errors || 0} | Changes: ${src.changes || 0}\n`;
      text += '\n';
    }
    return this.result('success', text, start);
  }

  private async handleEvents(start: number): Promise<PluginResult> {
    const json = await this.proxyGet(
      `/api/broxeen/events?limit=20&since=${this.lastEventTimestamp}`,
    );
    const data = JSON.parse(json);
    const events: ToonicEvent[] = data.events || [];

    if (events.length > 0) {
      this.lastEventTimestamp = data.server_time || Date.now() / 1000;
    }

    if (events.length === 0) {
      return this.result('success', '📋 Brak nowych zdarzeń toonic.', start);
    }

    let text = `📋 **Zdarzenia toonic (${events.length}):**\n\n`;
    for (const evt of events.slice(-15)) {
      const ts = new Date(evt.timestamp * 1000).toLocaleTimeString();
      const icon = evt.type === 'action' ? '🤖' : evt.type === 'trigger' ? '⚡' : evt.type === 'context' ? '📦' : '📌';
      text += `${icon} **${ts}** — ${evt.type}`;
      if (evt.source_id) text += ` | ${evt.source_id}`;
      if (evt.reason) text += ` | ${evt.reason}`;
      if (evt.content) text += `\n   ${evt.content.slice(0, 200)}`;
      text += '\n';
    }
    return this.result('success', text, start);
  }

  private async handleWatch(input: string, start: number): Promise<PluginResult> {
    // Extract URL/path from input
    const urlMatch = input.match(/(?:watch|monitoruj|obserwuj)\s+(\S+)/i);
    const url = urlMatch?.[1];
    if (!url) {
      return this.result('error',
        '❌ Podaj URL lub ścieżkę do monitorowania:\n' +
        '- `toonic watch rtsp://admin:pass@IP:554/stream`\n' +
        '- `toonic watch https://example.com`\n' +
        '- `toonic watch /home/user/project/`',
        start,
      );
    }

    // Extract optional category
    const catMatch = input.match(/(?:category|kategoria|typ)[:\s]+(\w+)/i);
    const category = catMatch?.[1] || '';

    const body = JSON.stringify({ url, category });
    const json = await this.proxyPost('/api/broxeen/watch', body);
    const data = JSON.parse(json);

    return this.result('success',
      `✅ **Źródło dodane do monitorowania**\n\n` +
      `- **ID:** ${data.source_id}\n` +
      `- **Kategoria:** ${data.category}\n` +
      `- **Watcher:** ${data.watcher_type}\n` +
      `- **Interwał:** ${data.interval_s}s\n\n` +
      `💡 \`toonic events\` — sprawdź zdarzenia\n` +
      `💡 \`toonic unwatch ${data.source_id}\` — zatrzymaj`,
      start,
    );
  }

  private async handleUnwatch(input: string, start: number): Promise<PluginResult> {
    const idMatch = input.match(/unwatch\s+(\S+)/i);
    const sourceId = idMatch?.[1];
    if (!sourceId) {
      return this.result('error', '❌ Podaj ID źródła: `toonic unwatch <source_id>`', start);
    }

    const json = await this.proxyDelete(`/api/broxeen/watch/${encodeURIComponent(sourceId)}`);
    const data = JSON.parse(json);
    return this.result('success', `✅ Źródło **${data.source_id}** zatrzymane.`, start);
  }

  private async handleSnapshot(input: string, start: number): Promise<PluginResult> {
    const json = await this.proxyGet('/api/broxeen/snapshot');
    const data = JSON.parse(json);

    if (!data.base64) {
      return this.result('success', '📷 Brak dostępnych klatek video. Dodaj źródło RTSP: `toonic watch rtsp://...`', start);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [
        {
          type: 'image',
          data: data.base64,
          mimeType: 'image/jpeg',
          title: `Toonic snapshot (${data.source_id})`,
        },
        {
          type: 'text',
          data: `📷 **Snapshot z toonic**\n\nŹródło: ${data.source_id}\nTimestamp: ${new Date(data.timestamp * 1000).toLocaleString()}`,
        },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleDetect(input: string, start: number): Promise<PluginResult> {
    // Extract what to detect
    const goal = input.replace(/^toonic\s+(detect|analiz|wykryj)\s*/i, '').trim()
      || 'describe what you see, detect objects and anomalies';

    // Try to get latest snapshot for visual analysis
    let imageBase64 = '';
    try {
      const snapJson = await this.proxyGet('/api/broxeen/snapshot');
      const snap = JSON.parse(snapJson);
      imageBase64 = snap.base64 || '';
    } catch { /* no snapshot available */ }

    const body = JSON.stringify({
      image_base64: imageBase64,
      goal,
    });

    const json = await this.proxyPost('/api/broxeen/detect', body);
    const data = JSON.parse(json);

    return this.result('success',
      `🔍 **Wynik detekcji toonic**\n\n` +
      `- **Typ:** ${data.action_type}\n` +
      `- **Model:** ${data.model}\n` +
      `- **Pewność:** ${(data.confidence * 100).toFixed(0)}%\n` +
      `- **Czas:** ${data.duration_s?.toFixed(1)}s\n\n` +
      `**Wynik:**\n${data.content}`,
      start,
    );
  }

  private async handleHelp(start: number): Promise<PluginResult> {
    let statusLine = '🔴 Sidecar offline';
    if (this.context?.isTauri && this.context.tauriInvoke) {
      try {
        const status = await this.context.tauriInvoke('toonic_status', {}) as ToonicStatus;
        statusLine = status.running ? '🟢 Sidecar online' : '🔴 Sidecar offline';
      } catch { /* ignore */ }
    }

    return this.result('success',
      `🎵 **Toonic Bridge — monitoring i detekcja**\n\n` +
      `${statusLine}\n\n` +
      `**Komendy:**\n` +
      `- \`toonic start\` — uruchom sidecar\n` +
      `- \`toonic stop\` — zatrzymaj sidecar\n` +
      `- \`toonic status\` — sprawdź status\n` +
      `- \`toonic watch <URL/ścieżka>\` — dodaj źródło monitorowania\n` +
      `- \`toonic unwatch <ID>\` — zatrzymaj monitoring źródła\n` +
      `- \`toonic sources\` — lista aktywnych źródeł\n` +
      `- \`toonic events\` — ostatnie zdarzenia\n` +
      `- \`toonic snapshot\` — ostatnia klatka video\n` +
      `- \`toonic detect <cel>\` — jednorazowa detekcja\n\n` +
      `**Wspierane źródła:**\n` +
      `- 📹 RTSP strumienie video (kamery IP)\n` +
      `- 🌐 Strony WWW / API (health, zmiany, SSL)\n` +
      `- 📁 Pliki i katalogi (zmiany)\n` +
      `- 🐳 Kontenery Docker\n` +
      `- ⚙️ Procesy systemowe\n` +
      `- 🗄️ Bazy danych`,
      start,
    );
  }

  // ── Proxy helpers ──────────────────────────────────────

  private async proxyGet(path: string): Promise<string> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      throw new Error('Toonic wymaga Tauri');
    }
    return await this.context.tauriInvoke('toonic_proxy_get', { path }) as string;
  }

  private async proxyPost(path: string, body: string): Promise<string> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      throw new Error('Toonic wymaga Tauri');
    }
    return await this.context.tauriInvoke('toonic_proxy_post', { path, body }) as string;
  }

  private async proxyDelete(path: string): Promise<string> {
    if (!this.context?.isTauri || !this.context.tauriInvoke) {
      throw new Error('Toonic wymaga Tauri');
    }
    return await this.context.tauriInvoke('toonic_proxy_delete', { path }) as string;
  }

  // ── Result builder ─────────────────────────────────────

  private result(status: 'success' | 'error', text: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status,
      content: [{ type: 'text', data: text }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    log.info('ToonicBridgePlugin initialized');
  }

  async dispose(): Promise<void> {
    log.info('ToonicBridgePlugin disposed');
  }
}

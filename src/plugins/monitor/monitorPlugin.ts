/**
 * Monitor Plugin - enables chat-based monitoring of devices/endpoints
 *
 * Commands (via chat):
 *   "monitoruj kamerę wejściową"        → start monitoring
 *   "monitoruj 192.168.1.100 co 30s"    → start with custom interval
 *   "stop monitoring kamery"             → stop monitoring
 *   "pokaż logi monitoringu"             → show change history
 *   "aktywne monitoringi"                → list active watches
 *   "ustaw próg zmian 20%"              → configure threshold via chat
 *
 * Integrates with WatchManager + ChangeDetector for real polling,
 * and optionally with LLM for intelligent change descriptions.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { processRegistry } from '../../core/processRegistry';
import { configStore } from '../../config/configStore';

export interface MonitorTarget {
  id: string;
  type: 'camera' | 'device' | 'endpoint' | 'service';
  name: string;
  address?: string;
  intervalMs: number;
  threshold: number;
  active: boolean;
  startedAt: number;
  lastChecked?: number;
  lastChange?: number;
  changeCount: number;
  logs: MonitorLogEntry[];
  // Camera-specific fields
  rtspUrl?: string;
  rtspUsername?: string;
  rtspPassword?: string;
  lastSnapshot?: string; // base64 image data
  snapshotUrl?: string; // HTTP snapshot URL
  needsCredentials?: boolean;
}

export interface MonitorLogEntry {
  timestamp: number;
  type: 'start' | 'stop' | 'change' | 'error' | 'check' | 'snapshot';
  message: string;
  changeScore?: number;
  details?: string;
  snapshot?: string; // base64 image for visual changes
}

type MonitorUiEventDetail = {
  targetId: string;
  targetName: string;
  targetType: MonitorTarget['type'];
  timestamp: number;
  changeScore: number;
  summary: string;
  thumbnailBase64?: string;
  thumbnailMimeType?: string;
};

export class MonitorPlugin implements Plugin {
  readonly id = 'monitor';
  readonly name = 'Device Monitor';
  readonly version = '1.0.0';
  readonly supportedIntents = [
    'monitor:start', 'monitor:stop', 'monitor:list',
    'monitor:logs', 'monitor:config',
  ];

  private targets = new Map<string, MonitorTarget>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /monitoruj/i.test(lower) ||
      /obserwuj/i.test(lower) ||
      /śledź/i.test(lower) ||
      /sledz/i.test(lower) ||
      /stop.*monitor/i.test(lower) ||
      /zatrzymaj.*monitor/i.test(lower) ||
      /przestań.*monitor/i.test(lower) ||
      /przestan.*monitor/i.test(lower) ||
      /aktywne.*monitor/i.test(lower) ||
      /lista.*monitor/i.test(lower) ||
      /logi.*monitor/i.test(lower) ||
      /historia.*zmian/i.test(lower) ||
      /pokaż.*logi/i.test(lower) ||
      /pokaz.*logi/i.test(lower) ||
      /ustaw.*próg/i.test(lower) ||
      /ustaw.*prog/i.test(lower) ||
      /ustaw.*interwał/i.test(lower) ||
      /ustaw.*interwal/i.test(lower) ||
      /zmien.*interwał/i.test(lower) ||
      /zmien.*interwal/i.test(lower) ||
      /zmień.*interwał/i.test(lower) ||
      /zmień.*interwal/i.test(lower) ||
      /monitor.*flag/i.test(lower) ||
      /watch/i.test(lower) && /start|stop|list|log/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    if (/stop.*monitor|zatrzymaj.*monitor|przestań.*monitor|przestan.*monitor/i.test(lower)) {
      return this.handleStop(input, start);
    }
    if (/aktywne.*monitor|lista.*monitor|list.*watch/i.test(lower)) {
      return this.handleList(start);
    }
    if (/logi.*monitor|historia.*zmian|pokaż.*logi|pokaz.*logi|log.*monitor/i.test(lower)) {
      return this.handleLogs(input, start);
    }
    if (/ustaw.*próg|ustaw.*prog|ustaw.*interwał|ustaw.*interwal|zmien.*interwał|zmien.*interwal|zmień.*interwał|zmień.*interwal/i.test(lower)) {
      return this.handleConfig(input, start);
    }

    // Default: start monitoring
    return this.handleStart(input, context, start);
  }

  // ── Start Monitoring ────────────────────────────────────

  private async handleStart(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const parsed = this.parseTarget(input);
    if (!parsed) {
      return this.errorResult(
        'Podaj cel monitoringu, np.:\n' +
        '- "monitoruj kamerę wejściową"\n' +
        '- "monitoruj 192.168.1.100 co 30s"\n' +
        '- "obserwuj kamerę ogrodową próg 10%"',
        start,
      );
    }

    // Check if already monitoring
    if (this.targets.has(parsed.id)) {
      const existing = this.targets.get(parsed.id)!;
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `⚠️ **${parsed.name}** jest już monitorowane.\n\n` +
            `Od: ${new Date(existing.startedAt).toLocaleString('pl-PL')}\n` +
            `Interwał: ${existing.intervalMs / 1000}s\n` +
            `Próg zmian: ${(existing.threshold * 100).toFixed(0)}%\n` +
            `Wykrytych zmian: ${existing.changeCount}\n\n` +
            `💡 Użyj "stop monitoring ${parsed.name}" aby zatrzymać.\n\n` +
            `---\n` +
            `💡 **Sugerowane akcje:**\n` +
            `- "stop monitoring ${parsed.name}" — Zatrzymaj monitoring\n` +
            `- "pokaż logi monitoringu ${parsed.name}" — Zobacz ostatnie zdarzenia\n` +
            `- "aktywne monitoringi" — Lista aktywnych monitoringów`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    // Save credentials to configStore for reuse
    if (parsed.address && parsed.rtspUsername) {
      configStore.set(`camera.credentials.${parsed.address}.username`, parsed.rtspUsername);
      configStore.set(`camera.credentials.${parsed.address}.password`, parsed.rtspPassword ?? '');
    }

    // Generate RTSP URL + candidate HTTP snapshot URLs using vendor database
    let rtspUrl: string | undefined;
    let snapshotUrl: string | undefined;
    if (parsed.type === 'camera' && parsed.address) {
      const { detectCameraVendor, getVendorInfo } = await import('../camera/cameraVendorDatabase');
      const auth = parsed.rtspUsername && parsed.rtspPassword
        ? `${parsed.rtspUsername}:${parsed.rtspPassword}@`
        : parsed.rtspUsername ? `${parsed.rtspUsername}@` : '';

      // Check if user stored a working RTSP path from a previous 'pokaż live' session
      const storedRtspPath = configStore.get(`camera.rtspPath.${parsed.address}`) as string | undefined;

      // Detect vendor — prefer stored RTSP path, then hostname
      const vendorId = detectCameraVendor({
        hostname: parsed.address,
        rtspPath: storedRtspPath,
      });
      const vendor = getVendorInfo(vendorId);

      // Use stored path if available, otherwise vendor-specific main stream path
      const mainPath = storedRtspPath
        ? storedRtspPath.replace(/^rtsp:\/\/[^/]+/, '')   // strip host from full URL if stored
        : vendor.rtspPaths.find(p => p.quality === 'main')?.path || '/stream';
      rtspUrl = `rtsp://${auth}${parsed.address}:554${mainPath}`;

      // Use vendor-specific snapshot URL
      if (parsed.rtspUsername) {
        const snapshotPath = vendor.httpSnapshotPaths[0]?.path || '/snapshot.jpg';
        snapshotUrl = `http://${parsed.rtspUsername}:${parsed.rtspPassword ?? ''}@${parsed.address}${snapshotPath}`;
      }
    }

    const target: MonitorTarget = {
      id: parsed.id,
      type: parsed.type,
      name: parsed.name,
      address: parsed.address,
      intervalMs: parsed.intervalMs,
      threshold: parsed.threshold,
      active: true,
      startedAt: Date.now(),
      changeCount: 0,
      logs: [{
        timestamp: Date.now(),
        type: 'start',
        message: `Rozpoczęto monitoring: ${parsed.name}`,
      }],
      // Camera-specific
      rtspUrl,
      snapshotUrl,
      rtspUsername: parsed.rtspUsername,
      rtspPassword: parsed.rtspPassword,
      needsCredentials: !parsed.rtspUsername && parsed.type === 'camera',
    };

    this.targets.set(parsed.id, target);

    // Verify credentials for cameras with auth
    let credentialsValid = false;
    let credentialsMessage = '';
    
    if (target.type === 'camera' && target.address && target.rtspUsername) {
      try {
        credentialsValid = await this.verifyCredentials(target.address, target.rtspUsername, target.rtspPassword || '', context);
        if (credentialsValid) {
          credentialsMessage = `\n✅ **Credentials zweryfikowane** — logowanie udane (${target.rtspUsername})\n`;
        } else {
          credentialsMessage = `\n⚠️ **Credentials niepoprawne** — nie udało się zalogować (${target.rtspUsername})\n` +
            `💡 Spróbuj innych credentials lub sprawdź hasło.\n`;
        }
      } catch (err) {
        credentialsMessage = `\n⚠️ **Nie można zweryfikować credentials** — ${err instanceof Error ? err.message : 'błąd połączenia'}\n`;
      }
    }

    processRegistry.upsertRunning({
      id: `monitor:${target.id}`,
      type: 'monitor',
      label: `Monitoring: ${target.name}`,
      pluginId: this.id,
      stopCommand: `stop monitoring ${target.name}`,
    });

    // Start polling timer (simulated in browser, real in Tauri)
    const timer = setInterval(() => {
      this.poll(target, context);
    }, target.intervalMs);
    this.timers.set(parsed.id, timer);

    let data = `✅ **Monitoring uruchomiony**\n\n` +
      `📌 **Cel:** ${target.name}\n` +
      `📍 **Typ:** ${target.type}\n` +
      (target.address ? `🌐 **Adres:** ${target.address}\n` : '') +
      `⏱️ **Interwał:** co ${target.intervalMs / 1000}s\n` +
      `📊 **Próg zmian:** ${(target.threshold * 100).toFixed(0)}%\n` +
      credentialsMessage;
    
    // Live preview info for cameras
    if (target.type === 'camera' && target.address) {
      if (target.snapshotUrl) {
        data += `\n📸 **Snapshot HTTP (1fps):**\n\`${target.snapshotUrl}\`\n` +
          `*(otwórz w przeglądarce / odświeżaj co 1s)*\n\n` +
          `🎥 **RTSP stream:** \`${target.rtspUrl}\`\n` +
          `*(VLC → Media → Otwórz strumień sieciowy)*\n`;
      } else if (target.needsCredentials) {
        data += `\n⚠️ **Brak danych logowania** — live preview niedostępne.\n` +
          `💡 Restart z credentials: \`monitoruj ${target.address} user:admin admin:HASŁO\`\n\n` +
          `---\n` +
          `💡 **Sugerowane akcje:**\n` +
          `- "monitoruj ${target.address} user:admin admin:HASŁO" — Dodaj własne hasło\n` +
          `- "monitoruj ${target.address} user:admin admin:12345" — Spróbuj Hikvision\n` +
          `- "monitoruj ${target.address} user:admin admin:admin" — Spróbuj Dahua\n` +
          `- "monitoruj ${target.address} user:admin admin:" — Bez hasła\n` +
          `- "stop monitoring ${target.name}" — Zatrzymaj monitoring\n`;
      } else {
        data += `\nZmiany będą automatycznie zgłaszane w tym czacie.\n\n` +
          `💡 **Komendy:**\n` +
          `- "pokaż logi monitoringu ${target.name}"\n` +
          `- "stop monitoring ${target.name}"\n` +
          `- "aktywne monitoringi"`;
      }
    } else {
      data += `\nZmiany będą automatycznie zgłaszane w tym czacie.\n\n` +
        `💡 **Komendy:**\n` +
        `- "pokaż logi monitoringu ${target.name}"\n` +
        `- "stop monitoring ${target.name}"\n` +
        `- "aktywne monitoringi"`;
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Monitor: ${target.name}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Stop Monitoring ─────────────────────────────────────

  private handleStop(input: string, start: number): PluginResult {
    const targetName = input.replace(/^.*(?:stop|zatrzymaj|przestań|przestan)\s*(?:monitoring?\s*)?/i, '').trim().toLowerCase();

    // Find matching target
    let found: MonitorTarget | undefined;
    for (const t of this.targets.values()) {
      if (t.name.toLowerCase().includes(targetName) || t.id.includes(targetName) ||
          (t.address && t.address.includes(targetName))) {
        found = t;
        break;
      }
    }

    if (!found) {
      if (this.targets.size === 0) {
        return this.errorResult('Brak aktywnych monitoringów do zatrzymania.', start);
      }
      const names = Array.from(this.targets.values()).map(t => `- ${t.name}`).join('\n');
      return this.errorResult(`Nie znaleziono monitoringu: "${targetName}"\n\nAktywne:\n${names}`, start);
    }

    // Stop timer
    const timer = this.timers.get(found.id);
    if (timer) clearInterval(timer);
    this.timers.delete(found.id);

    // Log and deactivate
    found.active = false;
    found.logs.push({
      timestamp: Date.now(),
      type: 'stop',
      message: `Zatrzymano monitoring: ${found.name}`,
    });

    const summary = `🛑 **Monitoring zatrzymany: ${found.name}**\n\n` +
      `Czas trwania: ${this.formatDuration(Date.now() - found.startedAt)}\n` +
      `Wykrytych zmian: ${found.changeCount}\n` +
      `Sprawdzeń: ${found.logs.filter(l => l.type === 'check').length}`;

    this.targets.delete(found.id);

    processRegistry.remove(`monitor:${found.id}`);

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: summary, title: `Stop: ${found.name}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── List Active Monitors ────────────────────────────────

  private handleList(start: number): PluginResult {
    if (this.targets.size === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: '📋 **Brak aktywnych monitoringów**\n\n' +
            'Użyj "monitoruj [cel]" aby rozpocząć monitoring.\n\n' +
            'Przykłady:\n' +
            '- "monitoruj kamerę wejściową"\n' +
            '- "monitoruj 192.168.1.100 co 60s"\n' +
            '- "obserwuj kamerę ogrodową próg 5%"',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    let data = `📋 **Aktywne monitoringi** — ${this.targets.size}\n\n`;

    for (const t of this.targets.values()) {
      const uptime = this.formatDuration(Date.now() - t.startedAt);
      const lastCheck = t.lastChecked ? `${Math.round((Date.now() - t.lastChecked) / 1000)}s temu` : 'nigdy';
      const icon = t.active ? '🟢' : '🔴';

      data += `### ${icon} ${t.name}\n`;
      data += `- **Typ:** ${t.type}\n`;
      if (t.address) data += `- **Adres:** ${t.address}\n`;
      data += `- **Interwał:** co ${t.intervalMs / 1000}s\n`;
      data += `- **Próg:** ${(t.threshold * 100).toFixed(0)}%\n`;
      data += `- **Uptime:** ${uptime}\n`;
      data += `- **Ostatnie sprawdzenie:** ${lastCheck}\n`;
      data += `- **Wykryte zmiany:** ${t.changeCount}\n\n`;
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Aktywne monitoringi' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Show Logs ───────────────────────────────────────────

  private handleLogs(input: string, start: number): PluginResult {
    const targetName = input.replace(/^.*(?:logi|historia|pokaż|pokaz)\s*(?:monitoringu?\s*|zmian\s*)?/i, '').trim().toLowerCase();

    // Find matching target or show all
    let target: MonitorTarget | undefined;
    if (targetName) {
      for (const t of this.targets.values()) {
        if (t.name.toLowerCase().includes(targetName) || t.id.includes(targetName)) {
          target = t;
          break;
        }
      }
    }

    if (target) {
      return this.formatTargetLogs(target, start);
    }

    // Show combined logs from all targets
    const allLogs: Array<MonitorLogEntry & { targetName: string }> = [];
    for (const t of this.targets.values()) {
      for (const log of t.logs) {
        allLogs.push({ ...log, targetName: t.name });
      }
    }

    if (allLogs.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: '📋 Brak logów monitoringu. Uruchom monitoring poleceniem "monitoruj [cel]".' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    allLogs.sort((a, b) => b.timestamp - a.timestamp);
    const recent = allLogs.slice(0, 20);

    let data = `📋 **Logi monitoringu** — ostatnie ${recent.length} wpisów\n\n`;
    for (const log of recent) {
      const time = new Date(log.timestamp).toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const icon = this.logIcon(log.type);
      
      // Formatowanie wiadomości - skróć długie błędy
      let message = log.message;
      if (message.includes('ffmpeg exited:')) {
        // Wyodrębnij kluczową informację z błędu ffmpeg
        const authMatch = message.match(/401 (Unauthorized|authorization failed)/);
        const timeoutMatch = message.match(/timeout|Connection timed out/i);
        const connMatch = message.match(/Connection refused|No route to host/i);
        const notFoundMatch = message.match(/404 Not Found|No such file/i);
        
        if (authMatch) {
          message = '❌ Błąd autentykacji RTSP (sprawdź hasło)';
        } else if (timeoutMatch) {
          message = '⏰ Przekroczenie czasu połączenia';
        } else if (connMatch) {
          message = '🔌 Błąd połączenia z kamerą';
        } else if (notFoundMatch) {
          message = '🔍 Nie znaleziono zasobu (sprawdź URL)';
        } else {
          message = '❌ Błąd pobierania snapshotu';
        }
      } else if (message.includes('Brak snapshotu')) {
        message = '⚪ Brak snapshotu (pomijam)';
      } else if (message.includes('Zmiana wykryta')) {
        message = '🔔 Zmiana wykryta';
      } else if (message.includes('Brak zmian')) {
        message = '✅ Brak zmian';
      }
      
      data += `${icon} **${time}** \`${log.targetName}\` ${message}`;
      if (log.changeScore != null) data += ` (zmiana: ${(log.changeScore * 100).toFixed(1)}%)`;
      data += '\n';
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Logi monitoringu' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Chat-based Config ───────────────────────────────────

  private handleConfig(input: string, start: number): PluginResult {
    const lower = input.toLowerCase();

    // Parse threshold: "ustaw próg zmian 20%"
    const thresholdMatch = lower.match(/(?:próg|prog)\s*(?:zmian\s*)?(\d+)\s*%/);
    if (thresholdMatch) {
      const newThreshold = parseInt(thresholdMatch[1]) / 100;
      let updated = 0;
      for (const t of this.targets.values()) {
        t.threshold = newThreshold;
        updated++;
      }
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `✅ Próg zmian ustawiony na **${(newThreshold * 100).toFixed(0)}%** dla ${updated} monitoringów.`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    // Parse interval: "ustaw interwał 60s", "zmien interwał co 10s", "zmień interwał na 5m"
    const intervalMatch = lower.match(/(?:ustaw|zmien|zmień)\s+(?:interwał|interwal)\s+(?:co\s+)?(\d+)\s*(s|m|min)/);
    if (intervalMatch) {
      const value = parseInt(intervalMatch[1]);
      const unit = intervalMatch[2];
      const ms = unit === 'm' || unit === 'min' ? value * 60000 : value * 1000;
      let updated = 0;
      for (const t of this.targets.values()) {
        t.intervalMs = ms;
        // Restart timer
        const oldTimer = this.timers.get(t.id);
        if (oldTimer) clearInterval(oldTimer);
        const newTimer = setInterval(() => this.poll(t, { isTauri: false }), ms);
        this.timers.set(t.id, newTimer);
        updated++;
      }
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `✅ Interwał ustawiony na **${ms / 1000}s** dla ${updated} monitoringów.`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    return this.errorResult(
      'Nierozpoznana konfiguracja. Przykłady:\n' +
      '- "ustaw próg zmian 20%"\n' +
      '- "ustaw interwał 60s"\n' +
      '- "zmien interwał co 10s"\n' +
      '- "zmień interwał na 5m"',
      start,
    );
  }

  // ── Polling Logic ───────────────────────────────────────

  private async poll(target: MonitorTarget, context: PluginContext): Promise<void> {
    if (!target.active) return;

    target.lastChecked = Date.now();

    try {
      // Camera mode: capture snapshot frames, compare to previous snapshot
      if (target.type === 'camera' && target.address) {
        const snapshot = await this.captureCameraSnapshot(target, context);
        if (!snapshot) {
          target.logs.push({
            timestamp: Date.now(),
            type: 'check',
            message: `Brak snapshotu (pomijam)`,
            changeScore: 0,
          });
          return;
        }

        const previousSnapshot = target.lastSnapshot;
        target.lastSnapshot = snapshot.base64;

        if (!previousSnapshot) {
          target.logs.push({
            timestamp: Date.now(),
            type: 'snapshot',
            message: `Snapshot zapisany (pierwsza klatka)`,
            snapshot: snapshot.base64,
          });
          return;
        }

        const changeScore = await this.computeImageChangeScore(previousSnapshot, snapshot.base64);

        target.logs.push({
          timestamp: Date.now(),
          type: 'check',
          message: changeScore > target.threshold ? `Zmiana wykryta!` : `Brak zmian`,
          changeScore,
          details: `image-change:${(changeScore * 100).toFixed(1)}%`,
        });

        if (changeScore > target.threshold) {
          target.changeCount++;
          target.lastChange = Date.now();

          const llmMinChangeScore = configStore.get<number>('monitor.llmMinChangeScore') ?? 0;
          if (changeScore < llmMinChangeScore) {
            target.logs.push({
              timestamp: Date.now(),
              type: 'change',
              message: `Zmiana poniżej progu LLM (pomijam opis i powiadomienie)`,
              changeScore,
              details: `llmMinChangeScore:${(llmMinChangeScore * 100).toFixed(1)}%`,
            });
            return;
          }

          const thumbMaxWidth = configStore.get<number>('monitor.thumbnailMaxWidth') || 500;
          const thumbnail = await this.createThumbnail(snapshot.base64, snapshot.mimeType, thumbMaxWidth);

          const summary = await this.describeCameraChange(previousSnapshot, snapshot.base64, snapshot.mimeType);

          target.logs.push({
            timestamp: Date.now(),
            type: 'change',
            message: `🔔 Zmiana na ${target.name}: ${(changeScore * 100).toFixed(1)}%`,
            changeScore,
            details: summary,
            snapshot: thumbnail?.base64 ?? snapshot.base64,
          });

          if (this.isNoSignificantChangeSummary(summary)) {
            return;
          }

          this.emitUiEvent({
            targetId: target.id,
            targetName: target.name,
            targetType: target.type,
            timestamp: Date.now(),
            changeScore,
            summary,
            thumbnailBase64: thumbnail?.base64,
            thumbnailMimeType: thumbnail?.mimeType,
          });
        }

        return;
      }

      // Non-camera legacy: text polling via simulated content (or backend monitor_poll)
      let currentContent: string;

      if (context.isTauri && context.tauriInvoke) {
        currentContent = await context.tauriInvoke('monitor_poll', {
          targetId: target.id,
          targetType: target.type,
          address: target.address,
        }) as string;
      } else {
        currentContent = this.simulateContent(target);
      }

      const lastLog = target.logs.filter(l => l.type === 'check').pop();
      const previousContent = lastLog?.details || '';
      const changeScore = this.quickDiff(previousContent, currentContent);

      target.logs.push({
        timestamp: Date.now(),
        type: 'check',
        message: changeScore > target.threshold ? `Zmiana wykryta!` : `Brak zmian`,
        changeScore,
        details: currentContent.slice(0, 500),
      });

      if (changeScore > target.threshold) {
        target.changeCount++;
        target.lastChange = Date.now();

        target.logs.push({
          timestamp: Date.now(),
          type: 'change',
          message: `🔔 Zmiana na ${target.name}: ${(changeScore * 100).toFixed(1)}% różnicy`,
          changeScore,
          details: currentContent.slice(0, 200),
        });

        console.log(`🔔 [Monitor] Change detected on ${target.name}: ${(changeScore * 100).toFixed(1)}%`);
      }
    } catch (error) {
      target.logs.push({
        timestamp: Date.now(),
        type: 'error',
        message: `Błąd pollingu: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private emitUiEvent(detail: MonitorUiEventDetail): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent<MonitorUiEventDetail>('broxeen:monitor_change', { detail }));
    } catch {
      // ignore
    }
  }

  private isNoSignificantChangeSummary(summary: string): boolean {
    const normalized = (summary || '')
      .trim()
      .toLowerCase()
      .replace(/[.!?\s]+$/g, '');
    return normalized.includes('brak istotnych zmian');
  }

  private async captureCameraSnapshot(
    target: MonitorTarget,
    context: PluginContext,
  ): Promise<{ base64: string; mimeType: 'image/jpeg' | 'image/png' } | null> {
    try {
      // Prefer RTSP via Tauri when available
      if (context.isTauri && context.tauriInvoke && target.rtspUrl) {
        const result = await context.tauriInvoke('rtsp_capture_frame', {
          url: target.rtspUrl,
          cameraId: target.id,
          camera_id: target.id,
        }) as { base64: string };
        if (result?.base64) return { base64: result.base64, mimeType: 'image/jpeg' };
      }

      // HTTP snapshot fallback
      if (target.snapshotUrl) {
        const resp = await fetch(target.snapshotUrl);
        if (!resp.ok) throw new Error(`Snapshot HTTP ${resp.status}`);
        const blob = await resp.blob();
        const base64 = await this.blobToBase64(blob);
        const mimeType = (blob.type === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/jpeg' | 'image/png';
        return { base64, mimeType };
      }

      return null;
    } catch (err) {
      target.logs.push({
        timestamp: Date.now(),
        type: 'error',
        message: `Snapshot error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return null;
    }
  }

  private async describeCameraChange(
    prevBase64: string,
    currBase64: string,
    mimeType: 'image/jpeg' | 'image/png',
  ): Promise<string> {
    try {
      const { describeImageChange } = await import('../../lib/llmClient');
      const text = await describeImageChange(prevBase64, currBase64, mimeType);
      return (text || '').trim();
    } catch (err) {
      return `Zmiana wykryta, ale opis LLM nie powiódł się: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async computeImageChangeScore(prevBase64: string, currBase64: string): Promise<number> {
    // Lightweight heuristic: compare base64 prefixes in blocks.
    // This is not perceptual diff, but is stable and cheap.
    if (!prevBase64 || !currBase64) return 0;
    if (prevBase64 === currBase64) return 0;

    const a = prevBase64;
    const b = currBase64;
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    const step = 128;
    let same = 0;
    let total = 0;
    for (let i = 0; i < len; i += step) {
      total++;
      if (a.slice(i, i + step) === b.slice(i, i + step)) same++;
    }
    const diff = 1 - same / Math.max(1, total);
    return Math.max(0, Math.min(1, diff));
  }

  private async createThumbnail(
    base64: string,
    mimeType: 'image/jpeg' | 'image/png',
    maxWidth: number,
  ): Promise<{ base64: string; mimeType: 'image/jpeg' | 'image/png' } | null> {
    if (typeof document === 'undefined') return null;

    try {
      const img = await this.loadBase64Image(base64, mimeType);
      const width = img.naturalWidth || (img as any).width;
      const height = img.naturalHeight || (img as any).height;
      if (!width || !height) return null;

      if (width <= maxWidth) {
        return { base64, mimeType };
      }

      const scale = maxWidth / width;
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const outMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(outMime, outMime === 'image/jpeg' ? 0.85 : undefined);
      const outBase64 = dataUrl.split(',')[1] || '';
      if (!outBase64) return null;
      return { base64: outBase64, mimeType: outMime as any };
    } catch {
      return null;
    }
  }

  private loadBase64Image(base64: string, mimeType: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = `data:${mimeType};base64,${base64}`;
    });
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // ── Helpers ─────────────────────────────────────────────

  private parseTarget(input: string): {
    id: string; type: MonitorTarget['type']; name: string;
    address?: string; intervalMs: number; threshold: number;
    rtspUsername?: string; rtspPassword?: string;
  } | null {
    const lower = input.toLowerCase();

    // Extract interval: "co 30s" / "co 5m"
    let intervalMs = configStore.get<number>('monitor.defaultIntervalMs') || 30000;
    const intervalMatch = lower.match(/co\s+(\d+)\s*(s|m|min)/);
    if (intervalMatch) {
      const val = parseInt(intervalMatch[1]);
      intervalMs = intervalMatch[2] === 's' ? val * 1000 : val * 60000;
    }

    // Extract threshold: "próg 10%"
    let threshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
    const thresholdMatch = lower.match(/(?:próg|prog)\s*(\d+)\s*%/);
    if (thresholdMatch) threshold = parseInt(thresholdMatch[1]) / 100;

    // Extract credentials: "user:admin admin:password" or "admin:password"
    let rtspUsername: string | undefined;
    let rtspPassword: string | undefined;
    
    const userMatch = input.match(/user:(\S+)/);
    const passMatch = input.match(/(?:admin|pass|password):(\S+)/);
    
    if (userMatch) rtspUsername = userMatch[1];
    if (passMatch) rtspPassword = passMatch[1];

    // Extract IP
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) {
      return {
        id: `device-${ipMatch[0]}`,
        type: 'camera', // Assume camera if IP provided
        name: `Kamera ${ipMatch[0]}`,
        address: ipMatch[0],
        intervalMs, threshold,
        rtspUsername,
        rtspPassword,
      };
    }

    // Extract camera name
    if (/kamer/i.test(lower)) {
      let camName = 'domyślna';
      if (/wejści|front|wejsc/i.test(lower)) camName = 'wejściowa';
      else if (/ogr[oó]d|garden/i.test(lower)) camName = 'ogrodowa';
      else if (/salon|living/i.test(lower)) camName = 'salonowa';
      else if (/garaż|garage|garaz/i.test(lower)) camName = 'garażowa';

      return {
        id: `camera-${camName}`,
        type: 'camera',
        name: `Kamera ${camName}`,
        intervalMs, threshold,
      };
    }

    // Extract URL/endpoint
    const urlMatch = input.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      return {
        id: `endpoint-${urlMatch[0].replace(/[^a-z0-9]/gi, '-')}`,
        type: 'endpoint',
        name: urlMatch[0],
        address: urlMatch[0],
        intervalMs, threshold,
      };
    }

    // Generic target from remaining text
    const targetText = input.replace(/^.*(?:monitoruj|obserwuj|śledź|sledz)\s*/i, '').replace(/\s*co\s+\d+\s*(s|m|min).*/i, '').replace(/\s*próg\s+\d+\s*%.*/i, '').trim();
    if (targetText.length > 1) {
      return {
        id: `target-${targetText.replace(/\s+/g, '-').toLowerCase()}`,
        type: 'service',
        name: targetText,
        intervalMs, threshold,
      };
    }

    return null;
  }

  private simulateContent(target: MonitorTarget): string {
    const now = new Date();
    const noise = Math.random();
    // Occasionally simulate a real change
    if (noise > 0.85) {
      return `[${now.toISOString()}] ALERT: Ruch wykryty na ${target.name}. Nowy obiekt w kadrze.`;
    }
    return `[${now.toISOString()}] Status: OK. ${target.name} - brak zmian.`;
  }

  private quickDiff(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 0;
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const union = new Set([...wordsA, ...wordsB]);
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    return 1 - intersection.size / union.size;
  }

  private formatTargetLogs(target: MonitorTarget, start: number): PluginResult {
    const recent = target.logs.slice(-20).reverse();
    let data = `📋 **Logi: ${target.name}** — ${recent.length} wpisów\n\n`;
    for (const log of recent) {
      const time = new Date(log.timestamp).toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const icon = this.logIcon(log.type);
      
      // Formatowanie wiadomości - skróć długie błędy
      let message = log.message;
      if (message.includes('ffmpeg exited:')) {
        // Wyodrębnij kluczową informację z błędu ffmpeg
        const authMatch = message.match(/401 (Unauthorized|authorization failed)/);
        const timeoutMatch = message.match(/timeout|Connection timed out/i);
        const connMatch = message.match(/Connection refused|No route to host/i);
        const notFoundMatch = message.match(/404 Not Found|No such file/i);
        
        if (authMatch) {
          message = '❌ Błąd autentykacji RTSP (sprawdź hasło)';
        } else if (timeoutMatch) {
          message = '⏰ Przekroczenie czasu połączenia';
        } else if (connMatch) {
          message = '🔌 Błąd połączenia z kamerą';
        } else if (notFoundMatch) {
          message = '🔍 Nie znaleziono zasobu (sprawdź URL)';
        } else {
          message = '❌ Błąd pobierania snapshotu';
        }
      } else if (message.includes('Brak snapshotu')) {
        message = '⚪ Brak snapshotu (pomijam)';
      } else if (message.includes('Zmiana wykryta')) {
        message = '🔔 Zmiana wykryta';
      } else if (message.includes('Brak zmian')) {
        message = '✅ Brak zmian';
      }
      
      data += `${icon} **${time}** ${message}`;
      if (log.changeScore != null) data += ` (${(log.changeScore * 100).toFixed(1)}%)`;
      data += '\n';
    }
    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Logi: ${target.name}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private logIcon(type: MonitorLogEntry['type']): string {
    const icons: Record<MonitorLogEntry['type'], string> = {
      start: '▶️',
      stop: '⏹️',
      change: '🔔',
      error: '❌',
      check: '✅',
      snapshot: '📸',
    };
    return icons[type] || '📝';
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  private async verifyCredentials(
    ip: string,
    username: string,
    password: string,
    context: PluginContext
  ): Promise<boolean> {
    // Try common camera HTTP endpoints with auth
    const endpoints = [
      `/ISAPI/System/deviceInfo`,  // Hikvision
      `/cgi-bin/magicBox.cgi?action=getDeviceType`,  // Dahua
      `/api/1.0/system/deviceinfo`,  // Generic
      `/`,  // Root with auth
    ];

    for (const endpoint of endpoints) {
      try {
        const url = `http://${ip}${endpoint}`;
        const authHeader = `Basic ${btoa(`${username}:${password}`)}`;
        
        if (context.isTauri && context.tauriInvoke) {
          // Tauri backend - use browse command with auth
          const result = await context.tauriInvoke('browse', {
            url,
            headers: { Authorization: authHeader },
          }) as any;
          
          if (result && !result.error) {
            return true;
          }
        } else {
          // Browser - try fetch with credentials
          const response = await fetch(url, {
            method: 'GET',
            headers: { Authorization: authHeader },
            mode: 'no-cors',
            signal: AbortSignal.timeout(3000),
          });
          
          // In no-cors mode, we can't read status, but if it doesn't throw, connection worked
          return true;
        }
      } catch (err) {
        // Try next endpoint
        continue;
      }
    }
    
    return false;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('MonitorPlugin initialized'); }

  async dispose(): Promise<void> {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();

    for (const id of this.targets.keys()) {
      processRegistry.remove(`monitor:${id}`);
    }
    this.targets.clear();
    console.log('MonitorPlugin disposed');
  }
}

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
import type { ConfigPromptData, ConfigAction } from '../../components/ChatConfigPrompt';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { ConfiguredDeviceRepository } from '../../persistence/configuredDeviceRepository';
import type { ConfiguredDevice } from '../../persistence/configuredDeviceRepository';

export interface MonitorTarget {
  id: string;
  type: 'camera' | 'device' | 'endpoint' | 'service';
  name: string;
  address?: string;
  configuredDeviceId?: string;
  intervalMs: number;
  threshold: number;
  thresholdIsOverride?: boolean;
  intervalIsOverride?: boolean;
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
  httpUrl?: string; // HTTP interface URL
  apiToken?: string; // Reolink/API session token
  apiTokenExpiry?: number; // token expiry timestamp
  needsCredentials?: boolean;
}

export interface CaptureMetadata {
  method?: 'rtsp' | 'http' | 'none';
  url?: string;
  resolution?: string;       // e.g. '1920x1080'
  frameBytes?: number;       // base64 length as proxy for size
  captureMs?: number;        // how long capture took
  failReason?: string;       // why capture failed
  attemptsDetail?: string;   // what was tried
}

export interface MonitorLogEntry {
  timestamp: number;
  type: 'start' | 'stop' | 'change' | 'error' | 'check' | 'snapshot';
  message: string;
  changeScore?: number;
  details?: string;
  snapshot?: string; // base64 image for visual changes
  capture?: CaptureMetadata; // technical capture info
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
  private configuredDeviceRepo?: ConfiguredDeviceRepository;
  private pendingDbConflictsByIp = new Map<string, ConfiguredDevice[]>();
  private unsubscribeConfig?: () => void;

  private buildDbConflictPrompt(): string {
    if (this.pendingDbConflictsByIp.size === 0) return '';

    let data = `\n---\n⚠️ **Wykryto duplikaty w bazie danych (monitoring):**\n\n`;
    for (const [ip, devices] of this.pendingDbConflictsByIp.entries()) {
      data += `### IP: \`${ip}\` (${devices.length} wpisy)\n`;
      data += devices
        .map(d => `- **${d.label}** (id: \`${d.id}\`, interwał: ${Math.round(d.monitor_interval_ms / 1000)}s, updated: ${new Date(d.updated_at).toLocaleString('pl-PL')})`)
        .join('\n');
      data += '\n\n**Wybierz wpis do zachowania:**\n';
      data += devices.map(d => `- \`zachowaj monitoring ${d.id}\``).join('\n');
      data += '\n\n';
    }

    return data.trimEnd();
  }

  // ── Data-driven command routing table ─────────────────────────────────
  // Each entry: [pattern, handler-key]. Checked in order; first match wins.
  // Replaces 45+ individual regex tests with a single scannable table.
  private static readonly COMMAND_ROUTES: ReadonlyArray<[RegExp, string]> = [
    // Add to monitoring — website/URL monitoring
    [/\b(?:dodaj\s+do\s+monitorowania|add\s+to\s+monitoring)\b/i, 'add-to-monitoring'],
    // Vision / AI pipeline — checked first (highest priority)
    [/vision.*pipeline|pipeline.*vision|ai.*monitor|monitoring.*ai|detekcja.*ai|yolo.*monitor|start.*vision|uruchom.*vision|w[łl]ącz.*vision|status.*vision|stop.*vision|zatrzymaj.*vision/i, 'vision'],
    // DB conflict resolution
    [/\b(?:zachowaj|wybierz)\s+monitoring\s+cd_[a-z0-9_]+\b/i, 'resolve'],
    // Toggle enable/disable
    [/\b(?:w[łl]ącz|wlacz|wy[łl]ącz|wylacz)\s+monitor/i, 'toggle'],
    // Stop
    [/(?:stop|zatrzymaj|przesta[ńn]).*monitor/i, 'stop'],
    // List active
    [/(?:aktywne|lista|list).*(?:monitor|watch)/i, 'list'],
    // Logs / history — "pokaż logi", "historia zmian", "logi monitoringu"
    [/logi|historia.*zmian|poka[żz].*log/i, 'logs'],
    // Config (threshold / interval) — "ustaw próg 20%", "zmień interwał"
    [/(?:ustaw|zmie[ńn]).*(?:pr[oó]g|interwa[łl])/i, 'config'],
    // Explain / help
    [/(?:jak.*dzia[łl]a|wyja[śs]ni[jć]).*monitor|tryb.*(?:detekcji|wykrywan)|monitor.*(?:explain|help)/i, 'explain'],
  ];

  // All patterns that canHandle should match (includes COMMAND_ROUTES + start-triggers)
  private static readonly CAN_HANDLE_PATTERNS: ReadonlyArray<RegExp> = [
    // Add to monitoring
    /\b(?:dodaj\s+do\s+monitorowania|add\s+to\s+monitoring)\b/i,
    // Start / observe keywords
    /\b(?:monitoruj|obserwuj|[śs]led[źz])\b/i,
    /monitor.*flag/i,
    // All command routes
    ...MonitorPlugin.COMMAND_ROUTES.map(([pattern]) => pattern),
  ];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return MonitorPlugin.CAN_HANDLE_PATTERNS.some(p => p.test(lower));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    // Route through the command table
    for (const [pattern, key] of MonitorPlugin.COMMAND_ROUTES) {
      if (!pattern.test(lower)) continue;

      switch (key) {
        case 'add-to-monitoring':
          return await this.handleAddToMonitoring(input, context, start);
        case 'vision':
          return await this.handleVisionPipeline(input, context, start);
        case 'resolve': {
          const m = input.match(/\b(?:zachowaj|wybierz)\s+monitoring\s+(cd_[a-z0-9_]+)/i);
          if (m) return await this.handleResolveDbConflict(m[1], context, start);
          break;
        }
        case 'toggle': {
          const toggle = this.parseToggleMonitoring(input);
          if (toggle) return await this.handleToggleMonitoring(toggle.action, toggle.identifier, context, start);
          break;
        }
        case 'stop':
          return await this.handleStop(input, start);
        case 'list':
          return this.handleList(start);
        case 'logs':
          return this.handleLogs(input, start);
        case 'config':
          return this.handleConfig(input, start);
        case 'explain':
          return this.handleExplain(start);
      }
    }

    // Default: start monitoring
    return this.handleStart(input, context, start);
  }

  private parseToggleMonitoring(input: string): { action: 'enable' | 'disable'; identifier: string } | null {
    const m = input.match(/\b(w[łl]ącz|wlacz|wy[łl]ącz|wylacz)\s+monitor(?:ing)?\s+(.+)$/i);
    if (!m) return null;
    const verb = m[1].toLowerCase();
    const rest = (m[2] ?? '').trim();
    if (!rest) return null;
    const action: 'enable' | 'disable' = verb.startsWith('wy') || verb.startsWith('wyl') ? 'disable' : 'enable';
    return { action, identifier: rest };
  }

  private async handleToggleMonitoring(
    action: 'enable' | 'disable',
    identifier: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!this.configuredDeviceRepo) {
      return this.errorResult('Baza danych nie jest dostępna — nie mogę zmienić monitoringu.', start);
    }

    const idMatch = identifier.match(/\b(cd_[a-z0-9_]+)\b/i);
    const ipMatch = identifier.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    const id = idMatch?.[1];
    const ip = ipMatch?.[0];
    const label = identifier.trim();

    let device: ConfiguredDevice | null = null;
    if (id) device = await this.configuredDeviceRepo.getById(id);
    if (!device && ip) device = await this.configuredDeviceRepo.getByIp(ip);
    if (!device && label) {
      const all = await this.configuredDeviceRepo.listAll();
      device =
        all.find((d) => d.label.toLowerCase() === label.toLowerCase()) ??
        all.find((d) => d.label.toLowerCase().includes(label.toLowerCase())) ??
        null;
    }

    if (!device) {
      return this.errorResult(`Nie znaleziono urządzenia w bazie: **${identifier}**`, start);
    }

    const targetId = `camera-${device.ip}`;

    if (action === 'disable') {
      const existingTarget = this.targets.get(targetId);
      if (existingTarget) {
        const timer = this.timers.get(existingTarget.id);
        if (timer) clearInterval(timer);
        this.timers.delete(existingTarget.id);
        existingTarget.active = false;
        this.targets.delete(existingTarget.id);
        processRegistry.remove(`monitor:${existingTarget.id}`);
      }

      await this.configuredDeviceRepo.setMonitorEnabled(device.id, false);

      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `⏹️ **Wyłączono monitoring:** **${device.label}** (IP: \`${device.ip}\`, id: \`${device.id}\`)`,
          title: 'Monitoring: wyłączono',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    // enable
    await this.configuredDeviceRepo.setMonitorEnabled(device.id, true);

    if (!this.targets.has(targetId)) {
      const startedAt = Date.now();
      const defaultThreshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
      const defaultIntervalMs = configStore.get<number>('monitor.defaultIntervalMs') || 3000;
      const target: MonitorTarget = {
        id: targetId,
        configuredDeviceId: device.id,
        type: device.device_type === 'camera' ? 'camera' : 'device',
        name: device.label,
        address: device.ip,
        intervalMs: device.monitor_interval_ms,
        threshold: device.monitor_change_threshold ?? defaultThreshold,
        thresholdIsOverride: (device.monitor_change_threshold ?? defaultThreshold) !== defaultThreshold,
        intervalIsOverride: device.monitor_interval_ms !== defaultIntervalMs,
        active: true,
        startedAt,
        changeCount: 0,
        logs: [{
          timestamp: startedAt,
          type: 'start',
          message: `Rozpoczęto monitoring (włączono): ${device.label}`,
        }],
        rtspUrl: device.rtsp_url || undefined,
        httpUrl: device.http_url || undefined,
        rtspUsername: device.username || undefined,
        rtspPassword: device.password || undefined,
        snapshotUrl: device.http_url || undefined,
      };

      this.targets.set(target.id, target);
      processRegistry.upsertRunning({
        id: `monitor:${target.id}`,
        type: 'monitor',
        label: `Monitoring: ${target.name}`,
        pluginId: this.id,
        stopCommand: `stop monitoring ${target.name}`,
      });

      const timer = setInterval(() => {
        this.poll(target, context);
      }, target.intervalMs);
      this.timers.set(target.id, timer);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data:
          `✅ **Włączono monitoring:** **${device.label}** (IP: \`${device.ip}\`, id: \`${device.id}\`)\n` +
          `⏱️ Interwał: co ${Math.round(device.monitor_interval_ms / 1000)}s`,
        title: 'Monitoring: włączono',
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Add to Monitoring (Website/URL) ──────────────────────

  private async handleAddToMonitoring(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Extract URL from the command
    const urlMatch = input.match(/(?:dodaj\s+do\s+monitorowania|add\s+to\s+monitoring)\s+(https?:\/\/[^\s]+)/i);
    if (!urlMatch) {
      return this.errorResult(
        'Podaj adres URL do monitorowania, np.:\n' +
        '- "dodaj do monitorowania https://example.com"\n' +
        '- "dodaj do monitorowania https://prototypowanie.pl"',
        start,
      );
    }

    const url = urlMatch[1];
    const hostname = new URL(url).hostname;
    const targetId = `endpoint-${hostname.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    // Check if already monitoring
    if (this.targets.has(targetId)) {
      const existing = this.targets.get(targetId)!;
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `⚠️ **${hostname}** jest już monitorowane.\n\n` +
            `Od: ${new Date(existing.startedAt).toLocaleString('pl-PL')}\n` +
            `Interwał: ${existing.intervalMs / 1000}s\n` +
            `Próg zmian: ${(existing.threshold * 100).toFixed(0)}%\n` +
            `Wykrytych zmian: ${existing.changeCount}\n\n` +
            `💡 Użyj "stop monitoring ${hostname}" aby zatrzymać.`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    // Create endpoint monitoring target
    const defaultThreshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
    const defaultIntervalMs = configStore.get<number>('monitor.defaultIntervalMs') || 60000; // 1 minute for websites
    
    const target: MonitorTarget = {
      id: targetId,
      type: 'endpoint',
      name: hostname,
      address: url,
      intervalMs: defaultIntervalMs,
      threshold: defaultThreshold,
      active: true,
      startedAt: Date.now(),
      changeCount: 0,
      logs: [{
        timestamp: Date.now(),
        type: 'start',
        message: `Rozpoczęto monitoring: ${hostname}`,
      }],
      httpUrl: url, // Store the URL for polling
    };

    this.targets.set(targetId, target);

    processRegistry.upsertRunning({
      id: `monitor:${targetId}`,
      type: 'monitor',
      label: `Monitoring: ${target.name}`,
      pluginId: this.id,
      stopCommand: `stop monitoring ${target.name}`,
    });

    // Start polling timer
    const timer = setInterval(() => {
      this.pollEndpoint(target, context);
    }, target.intervalMs);
    this.timers.set(targetId, timer);

    const data = `✅ **Dodano do monitorowania:**\n\n` +
      `📌 **Cel:** ${hostname}\n` +
      `📍 **Typ:** Endpoint (strona WWW)\n` +
      `🌐 **Adres:** ${url}\n` +
      `⏱️ **Interwał:** co ${target.intervalMs / 1000}s\n` +
      `📊 **Próg zmian:** ${(target.threshold * 100).toFixed(0)}%\n\n` +
      `Zmiany będą automatycznie zgłaszane w tym czacie.\n\n` +
      `💡 **Komendy:**\n` +
      `- "pokaż logi monitoringu ${hostname}"\n` +
      `- "stop monitoring ${hostname}"\n` +
      `- "aktywne monitoringi"`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Monitor: ${hostname}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
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

    // Extract goal and when from input (set by config prompt buttons)
    const goalMatch = input.match(/goal:"([^"]+)"/i) || input.match(/goal:(\S+)/i);
    const whenMatch = input.match(/when:"([^"]+)"/i) || input.match(/when:(\S+)/i);
    const hasGoalOrWhen = !!(goalMatch || whenMatch);

    // Detect if user provided any explicit parameters (credentials, interval, threshold)
    const hasExplicitParams = !!(
      parsed.rtspUsername ||
      /\buser:/i.test(input) ||
      /\badmin:/i.test(input) ||
      /co\s+\d+\s*(s|m|min)/i.test(input) ||
      /(?:próg|prog)\s*\d+\s*%/i.test(input)
    );

    // If no goal/when AND no explicit params, show interactive config prompt
    // This allows tests and explicit commands to proceed directly
    if (!hasGoalOrWhen && !hasExplicitParams && (parsed.type === 'camera' || parsed.type === 'endpoint')) {
      return this.buildStartConfigPrompt(parsed, context, start);
    }

    // Resolve implicit targets using persisted device discovery (e.g. "monitoruj rpi")
    if (!parsed.address && parsed.type === 'device') {
      const resolvedIp = await this.resolveDeviceIp(parsed, context);
      if (resolvedIp) {
        parsed.address = resolvedIp;
        parsed.name = `${parsed.name} (${resolvedIp})`;
        parsed.id = `device-${resolvedIp}`;
      } else {
        return this.errorResult(
          `Nie mogę znaleźć adresu dla: **${parsed.name}**.\n\n` +
            `💡 Najpierw uruchom skan sieci: "skanuj sieć" (Tauri) albo podaj IP bezpośrednio: "monitoruj 192.168.x.x".`,
          start,
        );
      }
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

    // Save credentials to configStore for reuse / load stored ones
    if (parsed.address && parsed.rtspUsername) {
      configStore.set(`camera.credentials.${parsed.address}.username`, parsed.rtspUsername);
      configStore.set(`camera.credentials.${parsed.address}.password`, parsed.rtspPassword ?? '');
    } else if (parsed.address && !parsed.rtspUsername) {
      // Auto-load stored credentials
      const storedUser = configStore.get(`camera.credentials.${parsed.address}.username`) as string | undefined;
      const storedPass = configStore.get(`camera.credentials.${parsed.address}.password`) as string | undefined;
      if (storedUser) {
        parsed.rtspUsername = storedUser;
        parsed.rtspPassword = storedPass || '';
      }
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
      httpUrl: snapshotUrl,
      rtspUsername: parsed.rtspUsername,
      rtspPassword: parsed.rtspPassword,
      needsCredentials: !parsed.rtspUsername && parsed.type === 'camera',
    };

    this.targets.set(parsed.id, target);

    // Save to ConfiguredDeviceRepository if it's a device with IP
    if (this.configuredDeviceRepo && target.type === 'camera' && target.address) {
      try {
        const existing = await this.configuredDeviceRepo.listByIp(target.address);
        const enabledExisting = existing.filter(d => d.monitor_enabled);

        // Only treat as a conflict if there are multiple *enabled* rows.
        // Disabled rows may exist as historical records and should not block starting monitoring.
        if (enabledExisting.length > 1) {
          this.pendingDbConflictsByIp.set(target.address, enabledExisting);
          this.targets.delete(parsed.id);
          const choices = enabledExisting
            .map(d => `- **${d.label}** (id: \`${d.id}\`, interwał: ${Math.round(d.monitor_interval_ms / 1000)}s, updated: ${new Date(d.updated_at).toLocaleString('pl-PL')})`)
            .join('\n');
          const actions = enabledExisting
            .map(d => `- \`zachowaj monitoring ${d.id}\` — zachowaj ten wpis`)
            .join('\n');
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data:
                `⚠️ **W bazie danych są ${enabledExisting.length} aktywne wpisy dla IP ${target.address}.**\n\n` +
                `Wybierz, który wpis zachować (pozostałe zostaną wyłączone):\n\n` +
                `${choices}\n\n` +
                `**Wybór:**\n${actions}`,
              title: 'Duplikaty w bazie — wybór',
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          };
        }

        const existingId = enabledExisting[0]?.id ?? existing[0]?.id;
        const savedId = await this.configuredDeviceRepo.save({
          id: existingId,
          label: target.name,
          ip: target.address,
          device_type: 'camera',
          rtsp_url: target.rtspUrl || null,
          http_url: target.snapshotUrl || target.httpUrl || null,
          username: target.rtspUsername || null,
          password: target.rtspPassword || null,
          stream_path: null,
          monitor_enabled: true,
          monitor_interval_ms: target.intervalMs,
          monitor_change_threshold: target.threshold,
          last_snapshot_at: null,
          notes: null,
        });
        target.configuredDeviceId = savedId;
        console.log(`Saved monitoring configuration for ${target.name} to database`);
      } catch (err) {
        console.warn('Failed to save monitoring configuration to database:', err);
      }
    }

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

    // If goal/when specified, also forward to toonic sidecar for AI-powered monitoring
    const goal = goalMatch?.[1] || '';
    const when = whenMatch?.[1] || '';
    let toonicInfo = '';
    if (goal && goal !== 'pixel-diff' && context.isTauri && context.tauriInvoke) {
      try {
        const watchBody = JSON.stringify({
          url: target.rtspUrl || target.httpUrl || target.address || '',
          category: target.type === 'camera' ? 'video' : 'web',
          interval_s: target.intervalMs / 1000,
          goal,
          when,
          options: {
            detect_objects: 'true',
            detect_classes: 'person,car,truck,motorcycle,bicycle',
            detect_conf: '0.4',
            min_event_duration_s: '1.0',
          },
        });
        const resp = await context.tauriInvoke('toonic_proxy_post', { path: '/api/broxeen/watch', body: watchBody }) as string;
        const data = JSON.parse(resp);
        toonicInfo = `\n🤖 **Toonic AI aktywny:** ${data.watcher_type} (source: \`${data.source_id}\`)\n` +
          `🎯 **Goal:** ${goal}\n` +
          `⚡ **Trigger:** ${when || 'event-driven'}\n`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toonicInfo = `\n⚠️ **Toonic AI niedostępny:** ${msg}\n` +
          `💡 Uruchom sidecar: \`toonic start\`\n`;
      }
    } else if (goal && goal !== 'pixel-diff') {
      toonicInfo = `\n🎯 **Goal:** ${goal}\n` +
        (when ? `⚡ **Trigger:** ${when}\n` : '') +
        `⚠️ Toonic AI wymaga aplikacji Tauri — używam pixel-diff fallback.\n`;
    }

    let data = `✅ **Monitoring uruchomiony**\n\n` +
      `📌 **Cel:** ${target.name}\n` +
      `📍 **Typ:** ${target.type}\n` +
      (target.address ? `🌐 **Adres:** ${target.address}\n` : '') +
      `⏱️ **Interwał:** co ${target.intervalMs / 1000}s\n` +
      `📊 **Próg zmian:** ${(target.threshold * 100).toFixed(0)}%\n` +
      toonicInfo +
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

  private async handleStop(input: string, start: number): Promise<PluginResult> {
    const targetName = input.replace(/^.*(?:stop|zatrzymaj|przestań|przestan)\s*(?:monitoring?\s*)?/i, '').trim().toLowerCase();

    // Handle "stop wszystkie monitoringi"
    if (targetName === 'wszystkie' || targetName === 'all' || targetName === '') {
      if (this.targets.size === 0) {
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: 'ℹ️ Brak aktywnych monitoringów do zatrzymania.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }
      
      const stoppedTargets: string[] = [];
      for (const t of Array.from(this.targets.values())) {
        const timer = this.timers.get(t.id);
        if (timer) clearInterval(timer);
        this.timers.delete(t.id);
        t.active = false;
        t.logs.push({
          timestamp: Date.now(),
          type: 'stop',
          message: `Monitoring zatrzymany (komendą "stop wszystkie")`,
        });
        stoppedTargets.push(t.name);
        
        // Update database to disable monitoring for configured devices
        if (this.configuredDeviceRepo && t.configuredDeviceId) {
          try {
            await this.configuredDeviceRepo.setMonitorEnabled(t.configuredDeviceId, false);
          } catch (err) {
            console.warn(`Failed to disable monitoring for ${t.name} in database:`, err);
          }
        }

        processRegistry.remove(`monitor:${t.id}`);
      }

      this.targets.clear();
      this.timers.clear();
      
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `⏹️ **Zatrzymano wszystkie monitoringi** (${stoppedTargets.length})\n\n` +
            stoppedTargets.map(name => `- ${name}`).join('\n'),
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

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
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: 'ℹ️ Brak aktywnych monitoringów do zatrzymania.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
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

    if (this.configuredDeviceRepo && found.configuredDeviceId) {
      try {
        await this.configuredDeviceRepo.setMonitorEnabled(found.configuredDeviceId, false);
        console.log(`Disabled monitoring for ${found.name} in database`);
      } catch (err) {
        console.warn('Failed to disable monitoring in database:', err);
      }
    }

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
      const conflictPrompt = this.buildDbConflictPrompt();
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
            '- "obserwuj kamerę ogrodową próg 5%"' +
            (conflictPrompt ? `\n\n${conflictPrompt}` : ''),
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

    const configPrompt = this.buildMonitoringConfigPrompt();
    
    return {
      pluginId: this.id,
      status: 'success',
      content: [
        { type: 'text', data, title: 'Aktywne monitoringi' },
        { 
          type: 'config_prompt', 
          data: '⚙️ Szybkie ustawienia',
          title: '⚙️ Zarządzanie monitoringiem',
          configPrompt
        }
      ],
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  // ── Show Logs ───────────────────────────────────────────

  private handleLogs(input: string, start: number): PluginResult {
    const targetName = input.replace(/^.*(?:logi|historia|pokaż|pokaz)\s*(?:monitoringu?\s*|zmian\s*)?/i, '').trim().toLowerCase();

    // Also extract IP from original input for robust matching
    const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    const inputIp = ipMatch?.[1];

    // Find matching target: by name, id, IP address
    let target: MonitorTarget | undefined;
    if (targetName || inputIp) {
      for (const t of this.targets.values()) {
        // Match by IP address first (most reliable)
        if (inputIp && t.address === inputIp) {
          target = t;
          break;
        }
        // Match by name or id substring
        if (targetName && (t.name.toLowerCase().includes(targetName) || t.id.includes(targetName))) {
          target = t;
          break;
        }
        // Match by IP in target ID (e.g. "camera-192.168.1.100")
        if (inputIp && t.id.includes(inputIp)) {
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

    // Summary stats across all targets
    const allChecks = allLogs.filter(l => l.type === 'check');
    const allErrors = allLogs.filter(l => l.type === 'error');
    const allChanges = allLogs.filter(l => l.type === 'change');
    const lastCapture = [...allLogs].find(l => l.capture);

    let data = `📋 **Logi monitoringu** — ostatnie ${recent.length} wpisów\n`;
    data += `📊 Sprawdzeń: ${allChecks.length} | Zmian: ${allChanges.length} | Błędów: ${allErrors.length}\n`;

    if (lastCapture?.capture) {
      const c = lastCapture.capture;
      data += `🔧 Metoda: **${c.method || '?'}**`;
      if (c.resolution) data += ` | ${c.resolution}`;
      if (c.frameBytes) data += ` | ${Math.round(c.frameBytes / 1024)}kB`;
      if (c.captureMs) data += ` | ${c.captureMs}ms`;
      data += '\n';
      if (c.failReason) data += `⚠️ ${c.failReason}\n`;
    } else if (allErrors.length > 0) {
      data += `⚠️ Ostatni błąd: ${allErrors[allErrors.length - 1].message}\n`;
    }

    data += '\n';

    for (const log of recent) {
      const time = new Date(log.timestamp).toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const icon = this.logIcon(log.type);
      
      let message = log.message;
      // Shorten ffmpeg errors
      if (message.includes('ffmpeg exited:')) {
        const authMatch = message.match(/401 (Unauthorized|authorization failed)/);
        const timeoutMatch = message.match(/timeout|Connection timed out/i);
        const connMatch = message.match(/Connection refused|No route to host/i);
        
        if (authMatch) message = '❌ Błąd autentykacji RTSP';
        else if (timeoutMatch) message = '⏰ Timeout połączenia';
        else if (connMatch) message = '🔌 Błąd połączenia';
        else message = '❌ Błąd snapshotu';
      }
      
      data += `${icon} **${time}** \`${log.targetName}\` ${message}`;
      if (log.changeScore != null) data += ` (zmiana: ${(log.changeScore * 100).toFixed(1)}%)`;
      data += '\n';
      if (log.details) {
        data += `   ${log.details}\n`;
      }
    }

    // Diagnostic hints when capture is failing
    if (allChecks.length === 0 && allErrors.length > 0) {
      data += '\n---\n';
      data += '💡 **Diagnostyka:** Żadna klatka nie została pobrana.\n';
      const lastErr = allErrors[allErrors.length - 1];
      if (lastErr.capture?.attemptsDetail) {
        data += `Próby: ${lastErr.capture.attemptsDetail}\n`;
      }
      data += '**Sugestie:**\n';
      if ((import.meta as any)?.env?.DEV) {
        data += '- DEV: uruchom Vite: `pnpm dev` (proxy /api/camera-proxy dla HTTP snapshotów)\n';
        data += '- Jeśli Tauri DEV: `make tauri-dev` (RTSP via ffmpeg)\n';
      } else {
        data += '- Uruchom w Tauri: `make tauri-dev` (RTSP via ffmpeg)\n';
      }
      data += '- Podaj credentials: `monitoruj IP user:admin admin:HASŁO`\n';
      data += '- Sprawdź HTTP snapshot w przeglądarce: `http://IP/snap.jpg`\n';
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

    const scopeMatch = lower.match(/\bdla\s+(.+)$/i);
    const targetScopeRaw = scopeMatch?.[1]?.trim() || '';
    const targetScope = targetScopeRaw ? targetScopeRaw.replace(/^["'`]+|["'`]+$/g, '').trim() : '';

    // Parse threshold: "ustaw próg zmian 20%"
    const thresholdMatch = lower.match(/(?:próg|prog)\s*(?:zmian\s*)?(\d+)\s*%/);
    if (thresholdMatch) {
      const newThreshold = parseInt(thresholdMatch[1]) / 100;
      let updated = 0;
      for (const t of this.targets.values()) {
        if (targetScope) {
          const matches =
            t.id.toLowerCase().includes(targetScope.toLowerCase()) ||
            t.name.toLowerCase().includes(targetScope.toLowerCase()) ||
            (t.address ? t.address.includes(targetScope) : false);
          if (!matches) continue;
        } else {
          // global change should not override per-target overrides
          if (t.thresholdIsOverride) continue;
        }

        t.threshold = newThreshold;
        if (targetScope) t.thresholdIsOverride = true;
        updated++;

        if (this.configuredDeviceRepo && t.configuredDeviceId) {
          void this.configuredDeviceRepo.setMonitorChangeThreshold(t.configuredDeviceId, newThreshold);
        }
      }

      if (!targetScope) {
        configStore.set('monitor.defaultChangeThreshold', newThreshold);
      }
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data:
            targetScope
              ? `✅ Próg zmian ustawiony na **${(newThreshold * 100).toFixed(0)}%** dla **${updated}** monitoringów (dla: **${targetScopeRaw}**).`
              : `✅ Próg zmian ustawiony na **${(newThreshold * 100).toFixed(0)}%** dla ${updated} monitoringów.`,
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
        if (targetScope) {
          const matches =
            t.id.toLowerCase().includes(targetScope.toLowerCase()) ||
            t.name.toLowerCase().includes(targetScope.toLowerCase()) ||
            (t.address ? t.address.includes(targetScope) : false);
          if (!matches) continue;
        } else {
          // global change should not override per-target overrides
          if (t.intervalIsOverride) continue;
        }

        t.intervalMs = ms;
        if (targetScope) t.intervalIsOverride = true;
        // Restart timer
        const oldTimer = this.timers.get(t.id);
        if (oldTimer) clearInterval(oldTimer);
        const newTimer = setInterval(() => this.poll(t, { isTauri: false }), ms);
        this.timers.set(t.id, newTimer);
        updated++;

        if (this.configuredDeviceRepo && t.configuredDeviceId) {
          void this.configuredDeviceRepo.setMonitorIntervalMs(t.configuredDeviceId, ms);
        }
      }

      if (!targetScope) {
        configStore.set('monitor.defaultIntervalMs', ms);
      }
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data:
            targetScope
              ? `✅ Interwał ustawiony na **${ms / 1000}s** dla **${updated}** monitoringów (dla: **${targetScopeRaw}**).`
              : `✅ Interwał ustawiony na **${ms / 1000}s** dla ${updated} monitoringów.`,
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

  // ── Explain / Help ─────────────────────────────────────

  private handleExplain(start: number): PluginResult {
    const threshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
    const interval = configStore.get<number>('monitor.defaultIntervalMs') || 30000;
    const llmMin = configStore.get<number>('monitor.llmMinChangeScore') ?? 0;

    const data = [
      '## 🔍 Jak działa monitoring kamer',
      '',
      '### Pipeline detekcji zmian',
      '```',
      '  Kamera → [Snapshot] → [Pixel Diff] → [Próg] → [LLM opis] → Alert',
      '```',
      '',
      '**1. Pobieranie snapshotu** — co każdy interwał',
      '- **RTSP** (Tauri) — ffmpeg wyciąga klatkę z streamu (najwyższa jakość)',
      '- **HTTP snapshot** — pobiera JPEG z endpointu kamery (fallback)',
      '- **Auto-probing** — próbuje endpointy z bazy vendorów (Hikvision, Dahua, Reolink...)',
      '',
      '**2. Porównanie pikseli** (canvas pixel diff)',
      '- Oba obrazy skalowane do 200px szerokości',
      '- Porównanie RGB per-piksel (próg: 30/255 na kanał)',
      '- Wynik: % zmienionych pikseli (0-100%)',
      '',
      '**3. Filtrowanie**',
      `- **Próg zmian:** ${(threshold * 100).toFixed(0)}% — poniżej = "Brak zmian"`,
      `- **Próg LLM:** ${(llmMin * 100).toFixed(0)}% — poniżej = pomijamy opis LLM (oszczędność tokenów)`,
      '- LLM filtruje "Brak istotnych zmian" → brak alertu',
      '',
      '### ⚙️ Bieżąca konfiguracja',
      `- Interwał: **${interval / 1000}s**`,
      `- Próg wykrywania: **${(threshold * 100).toFixed(0)}%**`,
      `- Próg LLM: **${(llmMin * 100).toFixed(0)}%**`,
      '',
      '### 💡 Porady',
      '- **Za mało wykrywa?** → Ustaw niższy próg (np. 5%): `ustaw próg zmian 5%`',
      '- **Za dużo fałszywych alertów?** → Podnieś próg: `ustaw próg zmian 20%`',
      '- **Brak snapshotów?** → Podaj credentials: `monitoruj IP user:admin admin:HASŁO`',
      '- **Najlepsza jakość?** → Uruchom w Tauri: `make tauri-dev` (RTSP via ffmpeg)',
      '- **Szybsza detekcja?** → Krótszy interwał: `zmien interwał co 5s`',
    ].join('\n');

    const configPrompt: ConfigPromptData = {
      title: '⚙️ Strategia detekcji',
      description: 'Dostosuj czułość wykrywania zmian:',
      actions: [
        { id: 'sens-high', label: '🎯 Wysoka czułość (3%)', type: 'execute', executeQuery: 'ustaw próg zmian 3%', variant: 'warning', description: 'Wykrywa nawet drobne zmiany' },
        { id: 'sens-med', label: '⚖️ Średnia (10%)', type: 'execute', executeQuery: 'ustaw próg zmian 10%', variant: 'primary', description: 'Równowaga między czułością a fałszywymi alertami' },
        { id: 'sens-low', label: '🛡️ Niska (20%)', type: 'execute', executeQuery: 'ustaw próg zmian 20%', variant: 'secondary', description: 'Tylko duże zmiany w kadrze' },
        { id: 'interval-5', label: '⚡ Co 5s', type: 'execute', executeQuery: 'zmien interwał co 5s', variant: 'secondary' },
        { id: 'interval-10', label: '🔄 Co 10s', type: 'execute', executeQuery: 'zmien interwał co 10s', variant: 'secondary' },
        { id: 'interval-30', label: '⏱️ Co 30s', type: 'execute', executeQuery: 'zmien interwał co 30s', variant: 'secondary' },
        { id: 'logs', label: '📋 Pokaż logi', type: 'execute', executeQuery: 'pokaż logi monitoringu', variant: 'success' },
      ],
      layout: 'buttons',
    };

    return {
      pluginId: this.id,
      status: 'success',
      content: [
        { type: 'text', data },
        { type: 'config_prompt', data: '⚙️ Strategia detekcji', title: '⚙️ Strategia detekcji', configPrompt },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
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
          // captureCameraSnapshot already logged the error with metadata
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
            capture: snapshot.capture,
            details: this.formatCaptureDetails(snapshot.capture),
          });
          return;
        }

        const changeScore = await this.computeImageChangeScore(previousSnapshot, snapshot.base64);

        const captureInfo = this.formatCaptureDetails(snapshot.capture);
        target.logs.push({
          timestamp: Date.now(),
          type: 'check',
          message: changeScore > target.threshold
            ? `Zmiana wykryta! (${(changeScore * 100).toFixed(1)}%)`
            : `Brak zmian (${(changeScore * 100).toFixed(1)}%)`,
          changeScore,
          details: `${captureInfo} | diff:${(changeScore * 100).toFixed(1)}% próg:${(target.threshold * 100).toFixed(0)}%`,
          capture: snapshot.capture,
        });

        if (changeScore > target.threshold) {
          target.changeCount++;
          target.lastChange = Date.now();

          const llmMinChangeScore = configStore.get<number>('monitor.llmMinChangeScore') ?? 0;
          if (changeScore < llmMinChangeScore) {
            target.logs.push({
              timestamp: Date.now(),
              type: 'change',
              message: `Zmiana poniżej progu LLM (pomijam opis)`,
              changeScore,
              details: `diff:${(changeScore * 100).toFixed(1)}% < llmPróg:${(llmMinChangeScore * 100).toFixed(1)}%`,
              capture: snapshot.capture,
            });
            return;
          }

          const thumbMaxWidth = configStore.get<number>('monitor.thumbnailMaxWidth') || 500;
          console.log(`[Monitor] Creating thumbnail for ${target.name}, max width: ${thumbMaxWidth}`);
          const thumbnail = await this.createThumbnail(snapshot.base64, snapshot.mimeType, thumbMaxWidth);
          console.log(`[Monitor] Thumbnail created: ${thumbnail ? 'YES' : 'NO'}, base64 length: ${thumbnail?.base64.length || 0}`);

          const summary = await this.describeCameraChange(previousSnapshot, snapshot.base64, snapshot.mimeType);

          target.logs.push({
            timestamp: Date.now(),
            type: 'change',
            message: `🔔 Zmiana na ${target.name}: ${(changeScore * 100).toFixed(1)}%`,
            changeScore,
            details: `${summary} | ${captureInfo}`,
            snapshot: thumbnail?.base64 ?? snapshot.base64,
            capture: snapshot.capture,
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
          console.log(`[Monitor] Emitted UI event with thumbnail: ${thumbnail?.base64 ? 'YES' : 'NO'}, length: ${thumbnail?.base64?.length || 0}`);
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

  private async pollEndpoint(target: MonitorTarget, context: PluginContext): Promise<void> {
    if (!target.active || !target.httpUrl) return;

    target.lastChecked = Date.now();

    try {
      // Fetch website content
      const response = await fetch(target.httpUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Broxeen-Monitor/1.0 (Website Monitoring)',
        },
      });

      if (!response.ok) {
        target.logs.push({
          timestamp: Date.now(),
          type: 'error',
          message: `Błąd HTTP: ${response.status} ${response.statusText}`,
        });
        return;
      }

      const currentContent = await response.text();
      
      // Store content for comparison (limit size to prevent memory issues)
      const truncatedContent = currentContent.length > 50000 
        ? currentContent.slice(0, 50000) + '...[TRUNCATED]'
        : currentContent;

      // Compare with previous content
      const previousContent = target.lastSnapshot || '';
      target.lastSnapshot = truncatedContent;

      if (!previousContent) {
        target.logs.push({
          timestamp: Date.now(),
          type: 'check',
          message: `Pierwszy zapis treści strony (${truncatedContent.length} znaków)`,
          details: `URL: ${target.httpUrl} | Status: ${response.status}`,
        });
        return;
      }

      // Compute content change score
      const changeScore = this.computeTextChangeScore(previousContent, truncatedContent);

      target.logs.push({
        timestamp: Date.now(),
        type: 'check',
        message: changeScore > target.threshold
          ? `Zmiana wykryta! (${(changeScore * 100).toFixed(1)}%)`
          : `Brak zmian (${(changeScore * 100).toFixed(1)}%)`,
        changeScore,
        details: `URL: ${target.httpUrl} | Status: ${response.status} | diff:${(changeScore * 100).toFixed(1)}% próg:${(target.threshold * 100).toFixed(0)}%`,
      });

      if (changeScore > target.threshold) {
        target.changeCount++;
        target.lastChange = Date.now();

        target.logs.push({
          timestamp: Date.now(),
          type: 'change',
          message: `🔔 Zmiana na ${target.name}: ${(changeScore * 100).toFixed(1)}% różnicy`,
          changeScore,
          details: `URL: ${target.httpUrl} | Zmiana treści strony`,
        });

        console.log(`🔔 [Monitor] Change detected on ${target.name}: ${(changeScore * 100).toFixed(1)}%`);
      }
    } catch (error) {
      target.logs.push({
        timestamp: Date.now(),
        type: 'error',
        message: `Błąd pollingu: ${error instanceof Error ? error.message : String(error)}`,
        details: `URL: ${target.httpUrl}`,
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
  ): Promise<{ base64: string; mimeType: 'image/jpeg' | 'image/png'; capture: CaptureMetadata } | null> {
    const captureStart = Date.now();
    const attempts: string[] = [];
    console.log(`[Monitor] Starting snapshot capture for ${target.name} (${target.address})`);

    // ── 1. RTSP via Tauri (preferred) ──
    if (context.isTauri && context.tauriInvoke && target.rtspUrl) {
      attempts.push(`RTSP: ${target.rtspUrl}`);
      console.log(`[Monitor] Trying RTSP capture for ${target.name}`);
      try {
        const result = await context.tauriInvoke('rtsp_capture_frame', {
          url: target.rtspUrl,
          cameraId: target.id,
          camera_id: target.id,
        }) as { base64: string };
        if (result?.base64) {
          console.log(`[Monitor] RTSP capture successful for ${target.name}, frame size: ${result.base64.length} bytes`);
          const capture: CaptureMetadata = {
            method: 'rtsp',
            url: target.rtspUrl,
            frameBytes: result.base64.length,
            captureMs: Date.now() - captureStart,
            attemptsDetail: attempts.join(' → '),
          };
          // Try to extract resolution from base64 image
          capture.resolution = await this.detectResolution(result.base64, 'image/jpeg');
          return { base64: result.base64, mimeType: 'image/jpeg', capture };
        }
        attempts.push('RTSP: pusta odpowiedź');
        console.log(`[Monitor] RTSP capture failed for ${target.name}: empty response`);
      } catch (err) {
        attempts.push(`RTSP fail: ${err instanceof Error ? err.message : String(err)}`);
        console.log(`[Monitor] RTSP capture failed for ${target.name}:`, err);
      }
    } else if (!context.isTauri) {
      attempts.push('RTSP: niedostępny (tryb przeglądarkowy, brak Tauri)');
    } else if (!target.rtspUrl) {
      attempts.push('RTSP: brak URL');
      console.log(`[Monitor] No RTSP URL for ${target.name}`);
    }

    // ── 2. Configured HTTP snapshot URL ──
    if (target.snapshotUrl) {
      attempts.push(`HTTP: ${target.snapshotUrl}`);
      try {
        const result = await this.fetchHttpSnapshot(target.snapshotUrl, captureStart, attempts);
        if (result) return result;
      } catch (err) {
        attempts.push(`HTTP fail: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── 3. Reolink token-based API snapshot ──
    // Try even without explicit credentials — use stored creds or common defaults
    if (target.address) {
      // Ensure we have some credentials to try
      if (!target.rtspUsername) {
        const storedUser = configStore.get(`camera.credentials.${target.address}.username`) as string | undefined;
        if (storedUser) {
          target.rtspUsername = storedUser;
          target.rtspPassword = (configStore.get(`camera.credentials.${target.address}.password`) as string) || '';
          attempts.push(`Loaded stored credentials: ${storedUser}`);
        }
      }

      const credsToTry: Array<{ user: string; pass: string }> = [];
      if (target.rtspUsername) {
        credsToTry.push({ user: target.rtspUsername, pass: target.rtspPassword || '' });
      }
      // Common defaults as last resort
      credsToTry.push({ user: 'admin', pass: '123456' });
      credsToTry.push({ user: 'admin', pass: 'admin' });
      credsToTry.push({ user: 'admin', pass: '' });

      // Deduplicate
      const seen = new Set<string>();
      const uniqueCreds = credsToTry.filter(c => {
        const key = `${c.user}:${c.pass}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const creds of uniqueCreds) {
        try {
          // Temporarily set credentials for token login
          const origUser = target.rtspUsername;
          const origPass = target.rtspPassword;
          target.rtspUsername = creds.user;
          target.rtspPassword = creds.pass;

          const token = await this.ensureApiToken(target);
          if (token) {
            const url = `http://${target.address}/cgi-bin/api.cgi?cmd=Snap&channel=0&rs=broxeen&token=${token}`;
            attempts.push(`Reolink API (${creds.user}): token OK`);
            try {
              const result = await this.fetchHttpSnapshot(url, captureStart, attempts);
              if (result) {
                // Save working credentials
                configStore.set(`camera.credentials.${target.address}.username`, creds.user);
                configStore.set(`camera.credentials.${target.address}.password`, creds.pass);
                target.snapshotUrl = url;
                return result;
              }
            } catch (err) {
              attempts.push(`  → Reolink snap fail: ${err instanceof Error ? err.message : String(err)}`);
              target.apiToken = undefined;
              target.apiTokenExpiry = undefined;
            }
          } else {
            attempts.push(`Reolink login (${creds.user}): failed`);
          }

          // Restore if this attempt didn't work
          if (!target.snapshotUrl) {
            target.rtspUsername = origUser;
            target.rtspPassword = origPass;
          }
        } catch (err) {
          attempts.push(`Reolink (${creds.user}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ── 4. Auto-probe HTTP snapshot URLs (vendor database) ──
    if (target.address) {
      try {
        const { detectCameraVendor, getVendorInfo } = await import('../camera/cameraVendorDatabase');
        const vendorId = detectCameraVendor({ hostname: target.address });
        const vendor = getVendorInfo(vendorId);

        const auth = target.rtspUsername && target.rtspPassword
          ? `${target.rtspUsername}:${target.rtspPassword}@`
          : target.rtspUsername ? `${target.rtspUsername}@` : '';

        // Try vendor-specific snapshot URLs
        for (const snap of vendor.httpSnapshotPaths.slice(0, 4)) {
          const url = `http://${auth}${target.address}${snap.path}`;
          if (url === target.snapshotUrl) continue; // already tried above
          attempts.push(`HTTP probe: ${snap.description} (${url})`);
          try {
            const result = await this.fetchHttpSnapshot(url, captureStart, attempts);
            if (result) {
              // Cache the working URL for future polls
              target.snapshotUrl = url;
              return result;
            }
          } catch (err) {
            attempts.push(`  → fail: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch {
        attempts.push('Vendor DB: nie udało się załadować');
      }
    }

    // ── 4. All methods failed ──
    const failCapture: CaptureMetadata = {
      method: 'none',
      captureMs: Date.now() - captureStart,
      failReason: this.summarizeCaptureFailure(attempts, context),
      attemptsDetail: attempts.join(' → '),
    };

    target.logs.push({
      timestamp: Date.now(),
      type: 'error',
      message: `Brak snapshotu: ${failCapture.failReason}`,
      capture: failCapture,
    });
    return null;
  }

  private async resolveDeviceIp(
    parsed: { id: string; type: MonitorTarget['type']; name: string },
    context: PluginContext,
  ): Promise<string | null> {
    if (!context.databaseManager || !context.databaseManager.isReady()) return null;

    try {
      const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
      const devices = await repo.listDevices(100);
      const name = (parsed.name || '').toLowerCase();

      // Raspberry Pi selection: vendor/hostname contains raspberry/rpi
      if (parsed.id === 'device-rpi' || name.includes('raspberry') || name.includes('rpi')) {
        const rpi = devices.find((d) => {
          const vendor = (d.vendor || '').toLowerCase();
          const hostname = (d.hostname || '').toLowerCase();
          return vendor.includes('raspberry') || hostname.includes('raspberry') || hostname.includes('rpi');
        });
        return rpi?.ip ?? null;
      }

      // Generic fallback: try hostname contains
      const generic = devices.find((d) => (d.hostname || '').toLowerCase().includes(name));
      return generic?.ip ?? null;
    } catch (err) {
      console.warn('[MonitorPlugin] resolveDeviceIp failed:', err);
      return null;
    }
  }

  private proxyUrl(url: string): string {
    // Route camera HTTP requests through Vite dev proxy to bypass CORS.
    // Even in Tauri dev mode, browser-side fetch() to LAN camera IPs is CORS-blocked.
    // The proxy is only available in dev mode (vite dev server middleware).
    if (typeof window !== 'undefined') {
      // Check if proxy endpoint is likely available (dev mode)
      const isDev = import.meta.env?.DEV ?? false;
      if (isDev) {
        return `/api/camera-proxy?url=${encodeURIComponent(url)}`;
      }
    }
    return url;
  }

  private async fetchHttpSnapshot(
    url: string,
    captureStart: number,
    attempts: string[],
  ): Promise<{ base64: string; mimeType: 'image/jpeg' | 'image/png'; capture: CaptureMetadata } | null> {
    const fetchUrl = this.proxyUrl(url);
    const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      attempts.push(`  → HTTP ${resp.status}`);
      return null;
    }
    const blob = await resp.blob();
    if (blob.size < 200) {
      // Reolink returns small JSON error bodies (~146B) when auth fails
      if (blob.type?.includes('text') || blob.type?.includes('json')) {
        attempts.push(`  → auth error (${blob.size}B, ${blob.type})`);
        return null;
      }
      attempts.push(`  → pusta odpowiedź (${blob.size}B)`);
      return null;
    }
    const base64 = await this.blobToBase64(blob);
    const mimeType = (blob.type === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/jpeg' | 'image/png';
    const capture: CaptureMetadata = {
      method: 'http',
      url,
      frameBytes: base64.length,
      captureMs: Date.now() - captureStart,
      attemptsDetail: attempts.join(' → '),
    };
    capture.resolution = await this.detectResolution(base64, mimeType);

    return { base64, mimeType, capture };
  }

  private summarizeCaptureFailure(attempts: string[], _context: PluginContext): string {
    const text = attempts.join(' ');
    const isDev = (import.meta as any)?.env?.DEV ?? false;
    if (text.includes('Load failed') || text.includes('Failed to fetch')) {
      return isDev
        ? 'Żądania HTTP do kamery zablokowane (CORS/sieć). Uruchom Vite dev i użyj proxy (/api/camera-proxy) lub uruchom Tauri.'
        : 'Żądania HTTP do kamery zablokowane (CORS/sieć). Uruchom Tauri albo podaj snapshot URL dostępny bez CORS.';
    }
    if (text.includes('Reolink login') && text.includes('failed'))
      return 'Logowanie do kamery nie powiodło się. Sprawdź hasło: `monitoruj IP user:admin admin:HASŁO`';
    if (text.includes('401') || text.includes('Unauthorized'))
      return 'Błąd autentykacji RTSP/HTTP — sprawdź hasło kamery.';
    if (text.includes('timeout') || text.includes('Timeout'))
      return 'Przekroczenie czasu — kamera nie odpowiada.';
    if (text.includes('ECONNREFUSED') || text.includes('Connection refused'))
      return 'Połączenie odrzucone — kamera offline lub zły port.';
    if (text.includes('pusta odpowiedź') || text.includes('auth error'))
      return 'Kamera wymaga autoryzacji. Podaj credentials: `monitoruj IP user:admin admin:HASŁO`';
    return 'Wszystkie metody pobierania snapshotu nie powiodły się. Podaj credentials: `monitoruj IP user:admin admin:HASŁO`';
  }

  private async ensureApiToken(target: MonitorTarget): Promise<string | null> {
    // Return cached token if still valid (with 60s margin)
    if (target.apiToken && target.apiTokenExpiry && Date.now() < target.apiTokenExpiry - 60_000) {
      return target.apiToken;
    }

    if (!target.address || !target.rtspUsername) return null;

    try {
      const loginPayload = JSON.stringify([{
        cmd: 'Login',
        param: { User: { userName: target.rtspUsername, password: target.rtspPassword || '' } },
      }]);

      const loginUrl = `http://${target.address}/cgi-bin/api.cgi?cmd=Login`;
      const resp = await fetch(this.proxyUrl(loginUrl), {
        method: 'POST',
        body: loginPayload,
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) return null;
      const data = await resp.json();
      const tokenObj = data?.[0]?.value?.Token;
      if (!tokenObj?.name) return null;

      target.apiToken = tokenObj.name;
      target.apiTokenExpiry = Date.now() + (tokenObj.leaseTime || 3600) * 1000;
      return target.apiToken ?? null;
    } catch {
      return null;
    }
  }

  private async detectResolution(base64: string, mimeType: string): Promise<string | undefined> {
    if (typeof document === 'undefined') return undefined;
    try {
      const img = await this.loadBase64Image(base64, mimeType);
      const w = img.naturalWidth || (img as any).width;
      const h = img.naturalHeight || (img as any).height;
      if (w && h) return `${w}x${h}`;
    } catch { /* ignore */ }
    return undefined;
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

  private formatCaptureDetails(capture: CaptureMetadata): string {
    const parts: string[] = [];
    if (capture.method) parts.push(`via:${capture.method}`);
    if (capture.resolution) parts.push(capture.resolution);
    if (capture.frameBytes) parts.push(`${Math.round(capture.frameBytes / 1024)}kB`);
    if (capture.captureMs) parts.push(`${capture.captureMs}ms`);
    if (capture.failReason) parts.push(`⚠ ${capture.failReason}`);
    return parts.join(' ') || 'brak danych';
  }

  private async computeImageChangeScore(prevBase64: string, currBase64: string): Promise<number> {
    if (!prevBase64 || !currBase64) return 0;
    if (prevBase64 === currBase64) return 0;

    // ── Canvas pixel-level comparison (browser) ──
    if (typeof document !== 'undefined') {
      try {
        return await this.pixelDiff(prevBase64, currBase64);
      } catch {
        // fall through to base64 heuristic
      }
    }

    // ── Fallback: base64 block comparison (server / no canvas) ──
    const len = Math.min(prevBase64.length, currBase64.length);
    if (len === 0) return 0;
    const step = 128;
    let same = 0;
    let total = 0;
    for (let i = 0; i < len; i += step) {
      total++;
      if (prevBase64.slice(i, i + step) === currBase64.slice(i, i + step)) same++;
    }
    return Math.max(0, Math.min(1, 1 - same / Math.max(1, total)));
  }

  /**
   * Canvas-based pixel diff: compares actual pixel values between two images.
   * Downscales both images to a comparison resolution (200px wide) for speed.
   * Returns 0..1 ratio of significantly changed pixels.
   */
  private async pixelDiff(prevBase64: string, currBase64: string): Promise<number> {
    const COMPARE_WIDTH = 200;
    const PIXEL_THRESHOLD = 30; // per-channel diff threshold (0-255)

    const [imgA, imgB] = await Promise.all([
      this.loadBase64Image(prevBase64, 'image/jpeg'),
      this.loadBase64Image(currBase64, 'image/jpeg'),
    ]);

    const wA = imgA.naturalWidth || (imgA as any).width || COMPARE_WIDTH;
    const hA = imgA.naturalHeight || (imgA as any).height || COMPARE_WIDTH;
    const scale = COMPARE_WIDTH / wA;
    const w = COMPARE_WIDTH;
    const h = Math.max(1, Math.round(hA * scale));

    const canvasA = document.createElement('canvas');
    canvasA.width = w; canvasA.height = h;
    const ctxA = canvasA.getContext('2d')!;
    ctxA.drawImage(imgA, 0, 0, w, h);
    const dataA = ctxA.getImageData(0, 0, w, h).data;

    const canvasB = document.createElement('canvas');
    canvasB.width = w; canvasB.height = h;
    const ctxB = canvasB.getContext('2d')!;
    ctxB.drawImage(imgB, 0, 0, w, h);
    const dataB = ctxB.getImageData(0, 0, w, h).data;

    const totalPixels = w * h;
    let changedPixels = 0;

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      if (dr > PIXEL_THRESHOLD || dg > PIXEL_THRESHOLD || db > PIXEL_THRESHOLD) {
        changedPixels++;
      }
    }

    return changedPixels / Math.max(1, totalPixels);
  }

  private async createThumbnail(
    base64: string,
    mimeType: 'image/jpeg' | 'image/png',
    maxWidth: number,
  ): Promise<{ base64: string; mimeType: 'image/jpeg' | 'image/png' } | null> {
    // In Tauri, use the backend resize_image command
    if (typeof window === 'undefined' || (window as Window & { __TAURI__?: unknown }).__TAURI__) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const resizedBase64 = await invoke('resize_image', {
          base64,
          maxWidth,
        }) as string;
        return { base64: resizedBase64, mimeType: 'image/jpeg' };
      } catch (err) {
        console.warn('Failed to resize image in Tauri:', err);
        // Return original image as fallback
        return { base64, mimeType };
      }
    }

    // Browser fallback using canvas
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

  private computeTextChangeScore(previousContent: string, currentContent: string): number {
    if (!previousContent || !currentContent) return 0;
    if (previousContent === currentContent) return 0;

    // Normalize text content for comparison
    const normalize = (text: string) => {
      return text
        .toLowerCase()
        .replace(/\s+/g, ' ')           // normalize whitespace
        .replace(/[^\w\s]/g, ' ')       // replace punctuation with spaces
        .replace(/\s+/g, ' ')           // normalize whitespace again
        .trim();
    };

    const prevNormalized = normalize(previousContent);
    const currNormalized = normalize(currentContent);

    // Simple character-based diff
    const len = Math.min(prevNormalized.length, currNormalized.length);
    if (len === 0) return 0;

    let differences = 0;
    for (let i = 0; i < len; i++) {
      if (prevNormalized[i] !== currNormalized[i]) {
        differences++;
      }
    }

    // Account for length differences
    const lengthDiff = Math.abs(prevNormalized.length - currNormalized.length);
    const totalDiff = differences + lengthDiff;
    const maxLength = Math.max(prevNormalized.length, currNormalized.length);

    // Return ratio of differences to total length (0..1)
    return Math.max(0, Math.min(1, totalDiff / maxLength));
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
        id: `camera-${ipMatch[0]}`,
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

    // Raspberry Pi shortcut
    if (/\b(rpi|raspberry)\b/i.test(lower)) {
      return {
        id: 'device-rpi',
        type: 'device',
        name: 'Raspberry Pi',
        intervalMs,
        threshold,
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

    // Compute stats
    const checks = target.logs.filter(l => l.type === 'check');
    const errors = target.logs.filter(l => l.type === 'error');
    const changes = target.logs.filter(l => l.type === 'change');
    const lastCapture = [...target.logs].reverse().find(l => l.capture);

    let data = `📋 **Logi: ${target.name}** — ${recent.length} wpisów\n`;
    data += `📊 Sprawdzeń: ${checks.length} | Zmian: ${changes.length} | Błędów: ${errors.length}\n`;

    // Show capture pipeline info
    if (lastCapture?.capture) {
      const c = lastCapture.capture;
      data += `🔧 Metoda: **${c.method || '?'}**`;
      if (c.resolution) data += ` | ${c.resolution}`;
      if (c.frameBytes) data += ` | ${Math.round(c.frameBytes / 1024)}kB`;
      if (c.captureMs) data += ` | ${c.captureMs}ms`;
      data += '\n';
      if (c.failReason) data += `⚠️ ${c.failReason}\n`;
    } else if (errors.length > 0) {
      const lastErr = errors[errors.length - 1];
      data += `⚠️ Ostatni błąd: ${lastErr.message}\n`;
    }

    data += `⏱️ Interwał: ${target.intervalMs / 1000}s | Próg: ${(target.threshold * 100).toFixed(0)}%\n\n`;

    for (const log of recent) {
      const time = new Date(log.timestamp).toLocaleString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const icon = this.logIcon(log.type);
      
      let message = log.message;
      // Shorten ffmpeg errors
      if (message.includes('ffmpeg exited:')) {
        const authMatch = message.match(/401 (Unauthorized|authorization failed)/);
        const timeoutMatch = message.match(/timeout|Connection timed out/i);
        const connMatch = message.match(/Connection refused|No route to host/i);
        
        if (authMatch) message = '❌ Błąd autentykacji RTSP';
        else if (timeoutMatch) message = '⏰ Timeout połączenia';
        else if (connMatch) message = '🔌 Błąd połączenia';
        else message = '❌ Błąd snapshotu';
      }
      
      data += `${icon} **${time}** \`${target.name}\` ${message}`;
      if (log.changeScore != null) data += ` (zmiana: ${(log.changeScore * 100).toFixed(1)}%)`;
      data += '\n';

      // Show technical details inline for recent entries
      if (log.details) {
        data += `   ${log.details}\n`;
      }
    }

    // Add diagnostic hint if all checks failed
    if (checks.length === 0 && errors.length > 0) {
      data += '\n---\n';
      data += '💡 **Diagnostyka:**\n';
      const lastErr = errors[errors.length - 1];
      if (lastErr.capture?.attemptsDetail) {
        data += `Próby: ${lastErr.capture.attemptsDetail}\n`;
      }
      data += '**Sugestie:**\n';
      if ((import.meta as any)?.env?.DEV) {
        data += '- DEV: uruchom Vite: `pnpm dev` (proxy /api/camera-proxy dla HTTP snapshotów)\n';
        data += '- Jeśli Tauri DEV: `make tauri-dev` (RTSP via ffmpeg)\n';
      } else {
        data += '- Jeśli Tauri: `make tauri-dev` (RTSP via ffmpeg)\n';
      }
      data += '- Podaj credentials: `monitoruj IP user:admin admin:HASŁO`\n';
      data += '- Sprawdź HTTP snapshot: `http://IP/snap.jpg` w przeglądarce\n';
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

  // ── Helper Functions ───────────────────────────────────────

  private buildStartConfigPrompt(
    parsed: { id: string; type: MonitorTarget['type']; name: string; address?: string; intervalMs: number; threshold: number; rtspUsername?: string; rtspPassword?: string },
    context: PluginContext,
    start: number,
  ): PluginResult {
    const addr = parsed.address || parsed.name;
    const isCamera = parsed.type === 'camera';
    const isEndpoint = parsed.type === 'endpoint';
    const credStr = parsed.rtspUsername
      ? ` user:${parsed.rtspUsername} admin:${parsed.rtspPassword || ''}`
      : '';

    // Build goal presets per resource type
    const goalPresets: ConfigAction[] = isCamera ? [
      {
        id: 'goal-security',
        label: '🛡️ Detekcja ludzi i pojazdów',
        icon: '🛡️',
        type: 'execute',
        executeQuery: `monitoruj ${addr}${credStr} goal:"CCTV: detect people and vehicles, describe actions and movement direction" when:"person or car detected for 1 second, otherwise every 1 minute"`,
        variant: 'primary',
        description: 'YOLO + LLM: wykrywa osoby/pojazdy, opisuje akcje, kierunek ruchu',
      },
      {
        id: 'goal-intrusion',
        label: '🚨 Detekcja intruzów',
        icon: '🚨',
        type: 'execute',
        executeQuery: `monitoruj ${addr}${credStr} goal:"security: detect unauthorized persons, describe their actions, classify as resident/visitor/suspicious" when:"person detected for 2 seconds, otherwise every 2 minutes"`,
        variant: 'warning',
        description: 'Wysokie bezpieczeństwo: klasyfikacja osób, alerty o podejrzanych',
      },
      {
        id: 'goal-general',
        label: '👁️ Ogólny monitoring',
        icon: '👁️',
        type: 'execute',
        executeQuery: `monitoruj ${addr}${credStr} goal:"describe what you see in each video frame, note any changes or movement" when:"motion detected, otherwise every 1 minute"`,
        variant: 'secondary',
        description: 'Opis sceny, detekcja ruchu, raport zmian',
      },
      {
        id: 'goal-parking',
        label: '🚗 Monitoring parkingu',
        icon: '🚗',
        type: 'execute',
        executeQuery: `monitoruj ${addr}${credStr} goal:"parking monitoring: count vehicles, detect entry/exit, note illegal parking" when:"car or truck detected for 3 seconds, otherwise every 5 minutes"`,
        variant: 'secondary',
        description: 'Zliczanie pojazdów, wjazd/wyjazd, nielegalne parkowanie',
      },
      {
        id: 'goal-pixeldiff',
        label: '📊 Prosty pixel-diff (bez AI)',
        icon: '📊',
        type: 'execute',
        executeQuery: `monitoruj ${addr}${credStr} goal:"pixel-diff" when:"none"`,
        variant: 'secondary',
        description: 'Klasyczny pixel-diff bez YOLO/LLM — niskie zużycie zasobów',
      },
    ] : [
      // Endpoint/website presets
      {
        id: 'goal-uptime',
        label: '🟢 Monitoring dostępności',
        icon: '🟢',
        type: 'execute',
        executeQuery: `monitoruj ${addr} goal:"monitor availability: check HTTP status, response time, SSL certificate" when:"status changes or error detected"`,
        variant: 'primary',
        description: 'Status HTTP, czas odpowiedzi, certyfikat SSL',
      },
      {
        id: 'goal-content',
        label: '📝 Monitoring zmian treści',
        icon: '📝',
        type: 'execute',
        executeQuery: `monitoruj ${addr} goal:"detect content changes: compare page text, highlight new/removed sections" when:"content changed"`,
        variant: 'secondary',
        description: 'Porównanie treści strony, wykrywanie nowych/usuniętych sekcji',
      },
      {
        id: 'goal-keyword',
        label: '🔍 Monitoring słów kluczowych',
        icon: '🔍',
        type: 'execute',
        executeQuery: `monitoruj ${addr} goal:"keyword monitoring: watch for specific terms, price changes, new announcements" when:"keywords detected or content changed"`,
        variant: 'secondary',
        description: 'Śledzenie słów kluczowych, zmian cen, nowych ogłoszeń',
      },
    ];

    // Additional parameter actions
    const paramActions: ConfigAction[] = [
      { id: 'param-interval-10', label: '⚡ Co 10s', type: 'execute', executeQuery: `monitoruj ${addr}${credStr} co 10s goal:"pixel-diff" when:"none"`, variant: 'secondary' },
      { id: 'param-interval-30', label: '🔄 Co 30s', type: 'execute', executeQuery: `monitoruj ${addr}${credStr} co 30s goal:"pixel-diff" when:"none"`, variant: 'secondary' },
      { id: 'param-interval-60', label: '⏱️ Co 1min', type: 'execute', executeQuery: `monitoruj ${addr}${credStr} co 60s goal:"pixel-diff" when:"none"`, variant: 'secondary' },
    ];

    const typeLabel = isCamera ? '📹 Kamera' : '🌐 Strona WWW';
    const toonicHint = context.isTauri
      ? '\n\n🤖 **Toonic AI** — predefiniowane opcje z YOLO + LLM uruchomią detekcję obiektów i inteligentny opis zdarzeń.'
      : '\n\n⚠️ Opcje AI (YOLO + LLM) wymagają aplikacji Tauri i uruchomionego sidecar toonic.';

    const text =
      `⚙️ **Konfiguracja monitoringu: ${parsed.name}**\n\n` +
      `**Typ:** ${typeLabel}\n` +
      (parsed.address ? `**Adres:** \`${parsed.address}\`\n` : '') +
      `\n**Wybierz cel monitorowania (goal) i warunek wyzwalacza (trigger):**\n` +
      `Każda opcja definiuje co ma być analizowane i kiedy wysyłać klatki do LLM.\n` +
      toonicHint +
      `\n\n---\n` +
      `💡 Możesz też ręcznie wpisać parametry:\n` +
      `\`monitoruj ${addr} goal:"twój cel" when:"warunek triggera"\``;

    const configPrompt: ConfigPromptData = {
      title: `⚙️ Parametry monitorowania — ${parsed.name}`,
      description: 'Wybierz profil monitorowania lub ustaw ręcznie:',
      actions: [...goalPresets, ...paramActions],
      layout: 'cards',
    };

    return {
      pluginId: this.id,
      status: 'success',
      content: [
        { type: 'text', data: text, title: `Konfiguracja: ${parsed.name}` },
        { type: 'config_prompt', data: '⚙️ Profil monitorowania', title: '⚙️ Profil monitorowania', configPrompt },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private buildMonitoringConfigPrompt(): ConfigPromptData {
    const actions: ConfigAction[] = [];
    
    // Interval actions
    const intervalActions: ConfigAction[] = [
      { id: 'interval-10s', label: '⚡ 10s', type: 'execute', executeQuery: 'zmien interwał co 10s', variant: 'primary' },
      { id: 'interval-30s', label: '🔄 30s', type: 'execute', executeQuery: 'zmien interwał co 30s', variant: 'secondary' },
      { id: 'interval-60s', label: '⏱️ 1m', type: 'execute', executeQuery: 'zmien interwał na 1m', variant: 'secondary' },
      { id: 'interval-5m', label: '🕐 5m', type: 'execute', executeQuery: 'zmien interwał na 5m', variant: 'secondary' },
    ];
    
    // Threshold actions
    const thresholdActions: ConfigAction[] = [
      { id: 'threshold-5', label: '🎯 5%', type: 'execute', executeQuery: 'ustaw próg zmian 5%', variant: 'warning' },
      { id: 'threshold-10', label: '🎯 10%', type: 'execute', executeQuery: 'ustaw próg zmian 10%', variant: 'warning' },
      { id: 'threshold-15', label: '🎯 15%', type: 'execute', executeQuery: 'ustaw próg zmian 15%', variant: 'warning' },
      { id: 'threshold-20', label: '🎯 20%', type: 'execute', executeQuery: 'ustaw próg zmian 20%', variant: 'warning' },
    ];
    
    // Control actions
    const controlActions: ConfigAction[] = [
      { id: 'logs', label: '📋 Pokaż logi', type: 'execute', executeQuery: 'pokaż logi monitoringu', variant: 'success' },
      { id: 'stop-all', label: '⏹️ Zatrzymaj wszystkie', type: 'execute', executeQuery: 'stop wszystkie monitoringi', variant: 'danger' },
    ];
    
    return {
      title: '⚙️ Zarządzanie monitoringiem',
      description: 'Szybkie ustawienia dla wszystkich aktywnych monitoringów:',
      actions: [
        ...intervalActions,
        ...thresholdActions, 
        ...controlActions
      ],
      layout: 'buttons'
    };
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

  async initialize(context: PluginContext): Promise<void> {
    console.log('MonitorPlugin initialized');

    this.unsubscribeConfig?.();
    this.unsubscribeConfig = configStore.onChange((path, value) => {
      if (path === 'monitor.defaultChangeThreshold') {
        const v = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(v)) return;
        for (const t of this.targets.values()) {
          if (t.thresholdIsOverride) continue;
          t.threshold = v;
        }
      }

      if (path === 'monitor.defaultIntervalMs') {
        const v = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(v) || v <= 0) return;
        for (const t of this.targets.values()) {
          if (t.intervalIsOverride) continue;
          t.intervalMs = v;
          const oldTimer = this.timers.get(t.id);
          if (oldTimer) clearInterval(oldTimer);
          const newTimer = setInterval(() => {
            this.poll(t, context);
          }, v);
          this.timers.set(t.id, newTimer);
        }
      }
    });
    
    // Initialize ConfiguredDeviceRepository if database is available
    if (context.databaseManager) {
      try {
        this.configuredDeviceRepo = new ConfiguredDeviceRepository(context.databaseManager.getDevicesDb());
        await this.loadMonitoredDevices(context);
        console.log(`Loaded ${this.targets.size} monitored devices from database`);
      } catch (err) {
        console.warn('Failed to initialize ConfiguredDeviceRepository:', err);
      }
    }
  }

  /** Load monitored devices from database and start monitoring */
  private async loadMonitoredDevices(context: PluginContext): Promise<void> {
    if (!this.configuredDeviceRepo) return;

    try {
      const defaultThreshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
      const configuredDevices = await this.configuredDeviceRepo.listMonitored();

      const byIp = new Map<string, ConfiguredDevice[]>();
      for (const d of configuredDevices) {
        const list = byIp.get(d.ip) ?? [];
        list.push(d);
        byIp.set(d.ip, list);
      }

      for (const [ip, devices] of byIp.entries()) {
        if (devices.length > 1) {
          this.pendingDbConflictsByIp.set(ip, devices);
          continue;
        }

        const device = devices[0];
        const startedAt = Date.now();
        const target: MonitorTarget = {
          id: `camera-${device.ip}`,
          configuredDeviceId: device.id,
          type: device.device_type === 'camera' ? 'camera' : 'device',
          name: device.label,
          address: device.ip,
          intervalMs: device.monitor_interval_ms,
          threshold: device.monitor_change_threshold ?? defaultThreshold,
          active: true,
          startedAt,
          changeCount: 0,
          logs: [{
            timestamp: startedAt,
            type: 'start',
            message: `Rozpoczęto monitoring (z bazy): ${device.label}`,
          }],
          rtspUrl: device.rtsp_url || undefined,
          httpUrl: device.http_url || undefined,
          rtspUsername: device.username || undefined,
          rtspPassword: device.password || undefined,
          snapshotUrl: device.http_url || undefined,
        };

        // Dedupe in-memory: if already exists, keep the existing one.
        if (this.targets.has(target.id)) continue;
        this.targets.set(target.id, target);

        processRegistry.upsertRunning({
          id: `monitor:${target.id}`,
          type: 'monitor',
          label: `Monitoring: ${target.name}`,
          pluginId: this.id,
          stopCommand: `stop monitoring ${target.name}`,
        });

        const timer = setInterval(() => {
          this.poll(target, context);
        }, target.intervalMs);
        this.timers.set(target.id, timer);
      }
    } catch (err) {
      console.error('Failed to load monitored devices:', err);
    }
  }

  private async handleResolveDbConflict(keepId: string, context: PluginContext, start: number): Promise<PluginResult> {
    if (!this.configuredDeviceRepo) {
      return this.errorResult('Baza danych nie jest dostępna — nie mogę rozwiązać konfliktu.', start);
    }

    let ip: string | null = null;
    let devices: ConfiguredDevice[] | undefined;
    for (const [k, v] of this.pendingDbConflictsByIp.entries()) {
      if (v.some(d => d.id === keepId)) {
        ip = k;
        devices = v;
        break;
      }
    }

    if (!ip || !devices) {
      return this.errorResult(`Nie widzę konfliktu dla id: \`${keepId}\`.`, start);
    }

    const keep = devices.find(d => d.id === keepId);
    if (!keep) {
      return this.errorResult(`Nie znaleziono wpisu: \`${keepId}\`.`, start);
    }

    const toDisable = devices.filter(d => d.id !== keepId);
    for (const d of toDisable) {
      await this.configuredDeviceRepo.setMonitorEnabled(d.id, false);
    }
    await this.configuredDeviceRepo.setMonitorEnabled(keepId, true);

    this.pendingDbConflictsByIp.delete(ip);

    // Start monitoring for kept record (if not already running)
    const targetId = `camera-${keep.ip}`;
    if (!this.targets.has(targetId)) {
      const startedAt = Date.now();
      const defaultThreshold = configStore.get<number>('monitor.defaultChangeThreshold') || 0.15;
      const target: MonitorTarget = {
        id: targetId,
        configuredDeviceId: keep.id,
        type: keep.device_type === 'camera' ? 'camera' : 'device',
        name: keep.label,
        address: keep.ip,
        intervalMs: keep.monitor_interval_ms,
        threshold: keep.monitor_change_threshold ?? defaultThreshold,
        active: true,
        startedAt,
        changeCount: 0,
        logs: [{
          timestamp: startedAt,
          type: 'start',
          message: `Rozpoczęto monitoring (po wyborze): ${keep.label}`,
        }],
        rtspUrl: keep.rtsp_url || undefined,
        httpUrl: keep.http_url || undefined,
        rtspUsername: keep.username || undefined,
        rtspPassword: keep.password || undefined,
        snapshotUrl: keep.http_url || undefined,
      };

      this.targets.set(target.id, target);
      processRegistry.upsertRunning({
        id: `monitor:${target.id}`,
        type: 'monitor',
        label: `Monitoring: ${target.name}`,
        pluginId: this.id,
        stopCommand: `stop monitoring ${target.name}`,
      });

      const timer = setInterval(() => {
        this.poll(target, context);
      }, target.intervalMs);
      this.timers.set(target.id, timer);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data:
          `✅ **Zachowano wpis:** \`${keep.id}\` (**${keep.label}**, IP: \`${keep.ip}\`)\n` +
          `Wyłączono pozostałe: ${toDisable.length}.\n\n` +
          `Monitoring dla tego IP jest teraz uruchomiony.`,
        title: 'Konflikt rozwiązany',
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Vision Pipeline Handler ─────────────────────────────────

  private async handleVisionPipeline(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const lower = input.toLowerCase();

    // Handle vision pipeline status
    if (/status.*vision|vision.*status/i.test(lower)) {
      return await this.handleVisionStatus(context, start);
    }

    // Handle vision pipeline stop
    if (/stop.*vision|zatrzymaj.*vision|wy[łl]ącz.*vision/i.test(lower)) {
      return await this.handleVisionStop(input, context, start);
    }

    // Default: start vision pipeline
    return await this.handleVisionStart(input, context, start);
  }

  private async handleVisionStatus(context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.tauriInvoke) {
      return this.errorResult('Vision pipeline status wymaga środowiska Tauri', start);
    }

    try {
      const status = await context.tauriInvoke('motion_pipeline_status');
      
      let data = '🤖 **Status Vision Pipeline**\n\n';
      
      if (Array.isArray(status) && status.length === 0) {
        data += '❌ **Brak aktywnych vision pipeline**\n\n';
        data += '💡 **Uruchom vision pipeline:**\n';
        data += '- "vision pipeline start rtsp://IP:554/stream"\n';
        data += '- "ai monitoring dla kamery wejściowej"\n';
        data += '- "uruchom detekcję AI dla 192.168.1.100"\n';
      } else {
        data += `✅ **Aktywne vision pipeline:** ${status.length}\n\n`;
        for (const pipeline of status) {
          data += `### 🟢 ${pipeline.camera_id}\n`;
          data += `- **RTSP:** ${pipeline.rtsp_url}\n`;
          data += `- **Baza:** ${pipeline.db_path}\n`;
          data += `- **Próg LLM:** ${pipeline.llm_threshold || 0.5}\n`;
          data += `- **Co N klatek:** ${pipeline.process_every || 4}\n`;
          data += `- **Start:** ${pipeline.started_at}\n\n`;
        }
      }

      data += '\n🎯 **Korzyści Vision Pipeline:**\n';
      data += '- ✅ Detekcja obiektów YOLO (20 klas)\n';
      data += '- ✅ Liczenie osób, pojazdów, rowerów\n';
      data += '- ✅ Analiza ruchu (prędkość, kierunek)\n';
      data += '- ✅ LLM weryfikacja dla niskiej pewności\n';
      data += '- ✅ Strukturalna baza danych z etykietami\n';
      data += '- ✅ Precyzyjne zapytania SQL o osoby\n';

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (error) {
      return this.errorResult(`Błąd sprawdzania statusu vision pipeline: ${error}`, start);
    }
  }

  private async handleVisionStop(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.tauriInvoke) {
      return this.errorResult('Vision pipeline wymaga środowiska Tauri', start);
    }

    // Extract camera ID from input
    const cameraId = input.replace(/^.*(?:stop|zatrzymaj|wy[łl]ącz)\s*(?:vision\s*)?/i, '').trim() || 'all';

    try {
      if (cameraId === 'all' || cameraId === 'wszystkie' || cameraId === 'wszystkich') {
        await context.tauriInvoke('motion_pipeline_stop', { cameraId: '' });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: '🛑 **Zatrzymano wszystkie vision pipeline**\n\n' +
              'Wszystkie procesy AI zostały zatrzymane.\n' +
              'Baza danych z detekcjami pozostaje zachowana.',
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } else {
        await context.tauriInvoke('motion_pipeline_stop', { cameraId });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `🛑 **Zatrzymano vision pipeline:** **${cameraId}**\n\n` +
              `Proces AI dla kamery ${cameraId} został zatrzymany.\n` +
              `Baza danych z detekcjami pozostaje zachowana.`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }
    } catch (error) {
      return this.errorResult(`Błąd zatrzymywania vision pipeline: ${error}`, start);
    }
  }

  private async handleVisionStart(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.tauriInvoke) {
      return this.errorResult('Vision pipeline wymaga środowiska Tauri', start);
    }

    // Parse RTSP URL and camera ID from input
    const rtspMatch = input.match(/rtsp:\/\/[^\s]+/i);
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    
    let rtspUrl = '';
    let cameraId = '';

    if (rtspMatch) {
      rtspUrl = rtspMatch[0];
      cameraId = `camera-${rtspUrl.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || 'unknown'}`;
    } else if (ipMatch) {
      const ip = ipMatch[0];
      rtspUrl = `rtsp://${ip}:554/stream`;
      cameraId = `camera-${ip}`;
    } else {
      // Try to get from active monitors
      const activeTargets = Array.from(this.targets.values());
      if (activeTargets.length > 0) {
        const target = activeTargets[0]; // Use first active monitor
        rtspUrl = target.address ?? `rtsp://${target.id}:554/stream`;
        cameraId = target.id;
      } else {
        return this.errorResult(
          'Podaj adres RTSP lub IP kamery, np.:\n' +
          '- "vision pipeline start rtsp://192.168.1.100:554/stream"\n' +
          '- "ai monitoring dla 192.168.1.100"\n' +
          '- "uruchom detekcję AI dla kamery wejściowej"',
          start
        );
      }
    }

    try {
      const request = {
        cameraId,
        rtspUrl,
        dbPath: 'monitoring.db',
        llmThreshold: 0.6,
        processEvery: 4,
        varThreshold: 40,
        bgHistory: 500,
        cooldownSec: 2.0,
        maxCropPx: 640,
      };

      await context.tauriInvoke('motion_pipeline_start', request);

      let data = `🤖 **Uruchomiono Vision Pipeline**\n\n`;
      data += `### 🟢 ${cameraId}\n`;
      data += `- **RTSP:** ${rtspUrl}\n`;
      data += `- **Baza danych:** monitoring.db\n`;
      data += `- **Próg detekcji:** 60%\n`;
      data += `- **Przetwarzanie:** co 4 klatki\n\n`;
      
      data += `🎯 **Co teraz?**\n`;
      data += `1. **Poczekaj** na pierwsze detekcje (kilka sekund)\n`;
      data += `2. **Sprawdź status:** "status vision"\n`;
      data += `3. **Query osoby:** "ile osób było w pomieszczeniu w ostatnich 10 minutach"\n`;
      data += `4. **Sprawdź logi:** "logi monitoringu"\n\n`;
      
      data += `🧠 **Możliwości AI:**\n`;
      data += `- ✅ Detekcja 20 klas obiektów (osoby, samochody, rowery...)\n`;
      data += `- ✅ Analiza ruchu i prędkości\n`;
      data += `- ✅ Śledzenie stref wejścia/wyjścia\n`;
      data += `- ✅ LLM weryfikacja niepewnych detekcji\n`;
      data += `- ✅ Precyzyjne zapytania SQL o liczbę osób`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (error) {
      if (String(error).includes('vision')) {
        return this.errorResult(
          `Vision pipeline nie jest dostępny. Zbuduj z vision feature:\n` +
          `\`cd src-tauri && cargo build --features vision\`\n\n` +
          `Błąd: ${error}`,
          start
        );
      }
      return this.errorResult(`Błąd uruchamiania vision pipeline: ${error}`, start);
    }
  }

  async dispose(): Promise<void> {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();

    this.unsubscribeConfig?.();
    this.unsubscribeConfig = undefined;

    for (const id of this.targets.keys()) {
      processRegistry.remove(`monitor:${id}`);
    }
    this.targets.clear();
    console.log('MonitorPlugin disposed');
  }
}

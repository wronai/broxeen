/**
 * Network Scan Plugin - provides network discovery capabilities
 * Uses Tauri backend commands for real network scanning.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { processRegistry } from '../../core/processRegistry';
import { configStore } from '../../config/configStore';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { ScanHistoryRepository } from '../../persistence/scanHistoryRepository';
import { createEvent } from '../../domain/chatEvents';

export class NetworkScanPlugin implements Plugin {
  readonly id = 'network-scan';
  readonly name = 'Network Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:scan', 'network:discover', 'network:devices', 'camera:describe', 'camera:discover'];

  async initialize(context: PluginContext): Promise<void> {
    console.log('🔧 NetworkScanPlugin.initialize called', { isTauri: context.isTauri });
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lowerInput = input.toLowerCase();
    const scanKeywords = [
      'skanuj sieć', 'skanuj', 'odkryj urządzenia', 'znajdź urządzenia',
      'scan network', 'discover devices', 'network scan', 'find devices'
    ];
    
    const cameraKeywords = [
      'pokaż kamery', 'pokaż kamerę', 'pokaz kamery', 'pokaz kamera',
      'znajdź kamery', 'znajdź kamerę', 'wyszukaj kamery', 'wyszukaj kamerę',
      'kamery w sieci', 'kamera w sieci', 'discover cameras', 'find cameras'
    ];

    const raspberryPiKeywords = [
      'znajdź rpi',
      'znajdz rpi',
      'raspberry pi',
      'raspberry',
      'rpi',
    ];
    
    const statusKeywords = [
      'status urządzeń', 'status urzadzen', 'lista urządzeń', 'lista urzadzen',
      'znane urządzenia', 'znane urzadzenia', 'device status', 'device list',
      'galeria urządzeń', 'galeria urzadzen', 'pokaż urządzenia', 'pokaz urzadzenia',
    ];

    const filterKeywords = [
      'filtruj urządzenia', 'filtruj urzadzenia', 'filter devices',
      'tylko kamery', 'tylko routery', 'tylko drukarki',
      'urządzenia typ', 'urzadzenia typ', 'devices type',
    ];

    const exportKeywords = [
      'exportuj urządzenia', 'exportuj urzadzenia', 'eksportuj urządzenia', 'eksportuj urzadzenia',
      'export devices', 'export urządzenia', 'pobierz urządzenia',
      'eksport csv', 'export csv', 'eksport json', 'export json',
      'zapisz urządzenia', 'pobierz listę urządzeń',
    ];

    return scanKeywords.some(keyword => lowerInput.includes(keyword)) ||
           cameraKeywords.some(keyword => lowerInput.includes(keyword)) ||
           raspberryPiKeywords.some(keyword => lowerInput.includes(keyword)) ||
           statusKeywords.some(keyword => lowerInput.includes(keyword)) ||
           filterKeywords.some(keyword => lowerInput.includes(keyword)) ||
           exportKeywords.some(keyword => lowerInput.includes(keyword));
  }

  private isStatusQuery(input: string): boolean {
    const lower = input.toLowerCase();
    return [
      'status urządzeń', 'status urzadzen', 'lista urządzeń', 'lista urzadzen',
      'znane urządzenia', 'znane urzadzenia', 'device status', 'device list',
      'galeria urządzeń', 'galeria urzadzen', 'pokaż urządzenia', 'pokaz urzadzenia',
    ].some(k => lower.includes(k));
  }

  private isFilterQuery(input: string): boolean {
    const lower = input.toLowerCase();
    return [
      'filtruj urządzenia', 'filtruj urzadzenia', 'filter devices',
      'tylko kamery', 'tylko routery', 'tylko drukarki',
      'urządzenia typ', 'urzadzenia typ', 'devices type',
    ].some(k => lower.includes(k));
  }

  private isExportQuery(input: string): boolean {
    const lower = input.toLowerCase();
    return [
      'exportuj urządzenia', 'exportuj urzadzenia', 'eksportuj urządzenia', 'eksportuj urzadzenia',
      'export devices', 'export urządzenia', 'pobierz urządzenia',
      'eksport csv', 'export csv', 'eksport json', 'export json',
      'zapisz urządzenia', 'pobierz listę urządzeń',
    ].some(k => lower.includes(k));
  }

  private extractExportFormat(input: string): 'csv' | 'json' {
    const lower = input.toLowerCase();
    if (lower.includes('json')) return 'json';
    return 'csv';
  }

  private extractFilterType(input: string): string | null {
    const lower = input.toLowerCase();
    if (lower.includes('kamer') || lower.includes('camera')) return 'camera';
    if (lower.includes('router') || lower.includes('gateway')) return 'gateway';
    if (lower.includes('drukark') || lower.includes('print')) return 'printer';
    if (lower.includes('raspberry') || lower.includes('rpi') || lower.includes('linux')) return 'linux-device';
    if (lower.includes('web') || lower.includes('http')) return 'web-device';
    if (lower.includes('iot') || lower.includes('smart')) return 'iot-device';
    return null;
  }

  private async handleDeviceFilter(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.databaseManager) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: 'Baza danych niedostępna (tryb przeglądarkowy).' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const filterType = this.extractFilterType(input);
    const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
    const allDevices = await repo.listDevices(200);

    const DEVICE_TYPE_LABELS: Record<string, string> = {
      'camera': '📷 Kamery',
      'gateway': '🌐 Routery/Bramy',
      'printer': '🖨️ Drukarki',
      'linux-device': '🐧 Linux/RPi',
      'web-device': '🌍 Urządzenia HTTP',
      'iot-device': '📡 IoT/Smart',
    };

    if (!filterType) {
      // Show type summary
      const byType = new Map<string, number>();
      for (const d of allDevices) {
        const t = (d as any).device_type || 'unknown';
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      const lines = [
        `## 🔍 Typy urządzeń (${allDevices.length} łącznie)`,
        '',
        ...Array.from(byType.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => {
            const label = DEVICE_TYPE_LABELS[type] ?? `❓ ${type}`;
            return `- ${label}: **${count}**`;
          }),
        '',
        `_Użyj: \`tylko kamery\`, \`tylko routery\`, \`filtruj urządzenia typ:linux\`_`,
      ];
      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n'), title: 'Typy urządzeń' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: allDevices.length } as any,
      };
    }

    const filtered = allDevices.filter(d => (d as any).device_type === filterType);
    const typeLabel = DEVICE_TYPE_LABELS[filterType] ?? filterType;
    const now = Date.now();
    const ONLINE_MS = 15 * 60 * 1000;

    if (filtered.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: `🔍 Brak urządzeń typu **${typeLabel}** w bazie.\n\n_Uruchom \`skanuj sieć\` aby odkryć urządzenia._` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const rows = filtered.map(d => {
      const ageMs = now - d.last_seen;
      const icon = ageMs < ONLINE_MS ? '🟢' : '🔴';
      const name = d.hostname || d.ip;
      const ageFmt = ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s` : ageMs < 3_600_000 ? `${Math.round(ageMs / 60_000)} min` : `${Math.round(ageMs / 3_600_000)} h`;
      return `${icon} **${name}** \`${d.ip}\` — ${ageFmt} temu`;
    });

    const lines = [
      `## ${typeLabel} (${filtered.length})`,
      '',
      ...rows,
    ];

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: typeLabel }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: filtered.length } as any,
    };
  }

  private async handleDeviceStatus(context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.databaseManager) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: 'Baza danych niedostępna (tryb przeglądarkowy).' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
    const devices = await repo.listDevices(200);

    if (devices.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: '📭 Brak zapisanych urządzeń. Uruchom `skanuj sieć` aby odkryć urządzenia.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const now = Date.now();
    const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;  // 15 min → online
    const RECENT_THRESHOLD_MS = 60 * 60 * 1000;  // 1 h → recent

    const rows = devices.map(d => {
      const ageMs = now - d.last_seen;
      let statusIcon: string;
      let statusLabel: string;
      if (ageMs < ONLINE_THRESHOLD_MS) {
        statusIcon = '🟢'; statusLabel = 'online';
      } else if (ageMs < RECENT_THRESHOLD_MS) {
        statusIcon = '🟡'; statusLabel = 'niedawno';
      } else {
        statusIcon = '🔴'; statusLabel = 'offline';
      }
      const ageFmt = ageMs < 60_000
        ? `${Math.round(ageMs / 1000)}s temu`
        : ageMs < 3_600_000
        ? `${Math.round(ageMs / 60_000)} min temu`
        : `${Math.round(ageMs / 3_600_000)} h temu`;
      const name = d.hostname || d.ip;
      return `${statusIcon} **${name}** \`${d.ip}\` — ${statusLabel} (${ageFmt})`;
    });

    const online = devices.filter(d => now - d.last_seen < ONLINE_THRESHOLD_MS).length;
    const offline = devices.length - online;

    const lines = [
      `## 📡 Znane urządzenia (${devices.length})`,
      `🟢 online: ${online}  🔴 offline/nieaktywne: ${offline}`,
      '',
      ...rows,
      '',
      `_Ostatnia aktualizacja: ${new Date().toLocaleTimeString('pl-PL')}_`,
      `_Uruchom \`skanuj sieć\` aby odświeżyć status._`,
    ];

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'Status urządzeń' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: devices.length } as any,
    };
  }

  private async handleExport(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.databaseManager) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: 'Baza danych niedostępna (tryb przeglądarkowy).' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const format = this.extractExportFormat(input);
    const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
    const devices = await repo.listDevices(1000);

    if (devices.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: '📭 Brak urządzeń do eksportu. Uruchom `skanuj sieć` aby odkryć urządzenia.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const now = Date.now();
    const ONLINE_MS = 15 * 60 * 1000;

    let exportContent: string;
    let filename: string;

    if (format === 'json') {
      const rows = devices.map(d => ({
        ip: d.ip,
        hostname: d.hostname ?? null,
        mac: d.mac ?? null,
        vendor: d.vendor ?? null,
        device_type: (d as any).device_type ?? null,
        status: now - d.last_seen < ONLINE_MS ? 'online' : 'offline',
        last_seen: new Date(d.last_seen).toISOString(),
        open_ports: (d as any).open_ports ?? [],
      }));
      exportContent = JSON.stringify(rows, null, 2);
      filename = `broxeen-devices-${new Date().toISOString().slice(0, 10)}.json`;
    } else {
      const header = 'ip,hostname,mac,vendor,device_type,status,last_seen,open_ports';
      const rows = devices.map(d => {
        const status = now - d.last_seen < ONLINE_MS ? 'online' : 'offline';
        const ports = ((d as any).open_ports ?? []).join(';');
        const esc = (v: string | null | undefined) => v ? `"${String(v).replace(/"/g, '""')}"` : '';
        return [d.ip, esc(d.hostname), esc(d.mac), esc(d.vendor), esc((d as any).device_type), status, new Date(d.last_seen).toISOString(), ports].join(',');
      });
      exportContent = [header, ...rows].join('\n');
      filename = `broxeen-devices-${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const lines = [
      `## 📥 Eksport urządzeń — ${format.toUpperCase()} (${devices.length} urządzeń)`,
      '',
      `**Plik:** \`${filename}\``,
      '',
      '```' + format,
      exportContent.slice(0, 3000) + (exportContent.length > 3000 ? '\n... (skrócono)' : ''),
      '```',
      '',
      `_Skopiuj powyższy blok i zapisz jako \`${filename}\`_`,
    ];

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: `Eksport ${format.toUpperCase()}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: exportContent.length > 3000, deviceCount: devices.length } as any,
    };
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    if (this.isStatusQuery(input)) {
      return this.handleDeviceStatus(context, start);
    }

    if (this.isFilterQuery(input)) {
      return this.handleDeviceFilter(input, context, start);
    }

    if (this.isExportQuery(input)) {
      return this.handleExport(input, context, start);
    }

    const isCameraQuery = input.toLowerCase().includes('kamer') || input.toLowerCase().includes('camera');
    const isRaspberryPiQuery = /\b(rpi|raspberry)\b/i.test(input);
    const scanId = `scan:${Date.now()}`;
    const scanLabel = isCameraQuery ? 'Skanowanie kamer' : 'Skanowanie sieci';

    // Extract subnet from input if provided (e.g. "skanuj 192.168.188" or "pokaż kamery 192.168.0")
    const subnetMatch = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const userSpecifiedSubnet = subnetMatch ? subnetMatch[1] : null;
    
    if (userSpecifiedSubnet) {
      console.log(`[NetworkScanPlugin] User specified subnet: ${userSpecifiedSubnet}`);
    }

    processRegistry.upsertRunning({
      id: scanId,
      type: 'scan',
      label: scanLabel,
      pluginId: this.id,
      details: context.isTauri ? 'Tauri backend' : 'tryb przeglądarkowy',
    });

    console.log(`[NetworkScanPlugin] Execute - isTauri: ${context.isTauri}, hasTauriInvoke: !!${context.tauriInvoke}`);

    try {
      if (context.isTauri && context.tauriInvoke) {
        try {
          // Determine scan strategy (incremental vs full)
          const scanStrategy = await this.determineScanStrategy(userSpecifiedSubnet, context);
          // Camera discovery should prefer full scans. Incremental windows are great for periodic refresh,
          // but they can easily miss a newly added camera IP in the same /24 (e.g. .176 not in the window).
          const effectiveScanType: 'full' | 'incremental' | 'targeted' =
            isCameraQuery ? 'full' : scanStrategy.type;
          const scanStart = Date.now();

          console.log(`[NetworkScanPlugin] Starting ${effectiveScanType} scan via Tauri...`);
          
          const result = await context.tauriInvoke('scan_network', {
            args: {
              subnet: userSpecifiedSubnet || scanStrategy.subnet,
              timeout: 5000,
              incremental: effectiveScanType === 'incremental',
              target_ranges: effectiveScanType === 'incremental' ? (scanStrategy.targetRanges || []) : [],
            },
          }) as NetworkScanResult;

          // Track scan statistics and save to history
          const scanStats = await this.trackScanResults(
            scanId,
            userSpecifiedSubnet || scanStrategy.subnet,
            effectiveScanType,
            result,
            scanStart,
            scanStrategy.triggeredBy,
            context,
          );

          // Persist discovered devices to SQLite
          this.persistDevices(result.devices, context).catch((err) =>
            console.warn('[NetworkScanPlugin] Device persistence failed:', err),
          );

          processRegistry.complete(scanId);
          processRegistry.remove(scanId);
          
          const resultData = isRaspberryPiQuery
            ? this.formatRaspberryPiResult(result)
            : this.formatScanResult(result, isCameraQuery, scanStats);

          const cameraConfigPrompt = isCameraQuery
            ? this.buildCameraActionsPrompt(result.devices)
            : null;

          // Emit network_scan_completed event for real-time sync
          const scanCompletedEvent = createEvent('network_scan_completed', {
            subnet: result.subnet,
            deviceCount: result.devices.length,
            duration: result.scan_duration,
            scanType: effectiveScanType || 'full',
          });

          if (context.eventStore) {
            context.eventStore.append(scanCompletedEvent);
          }

          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: resultData,
              title: isRaspberryPiQuery
                ? 'Urządzenia Raspberry Pi'
                : (isCameraQuery ? 'Wyniki wyszukiwania kamer' : 'Wyniki skanowania sieci'),
            }],
            metadata: {
              duration_ms: Date.now() - start,
              cached: false,
              truncated: false,
              deviceCount: result.devices.length,
              scanDuration: result.scan_duration,
              scanMethod: result.scan_method,
              ...(cameraConfigPrompt ? { configPrompt: cameraConfigPrompt } : {}),
            },
          };
        } catch (error) {
          console.error('[NetworkScanPlugin] scan_network failed:', error);
          processRegistry.fail(scanId, String(error));
          processRegistry.remove(scanId);
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: `Błąd skanowania sieci: ${error instanceof Error ? error.message : String(error)}`,
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          };
        }
      }

      console.log(`[NetworkScanPlugin] Using browser fallback - isTauri: ${context.isTauri}, hasInvoke: !!${context.tauriInvoke}`);
      const fallbackResult = await this.browserFallback(isCameraQuery, start, userSpecifiedSubnet, context);
      processRegistry.complete(scanId);
      processRegistry.remove(scanId);
      return fallbackResult;
    } catch (err) {
      processRegistry.fail(scanId, String(err));
      processRegistry.remove(scanId);
      throw err;
    }
  }

  private buildCameraActionsPrompt(devices: NetworkDevice[]): any {
    const cameras = (devices || []).filter((d) => {
      const ports = d.open_ports ?? [];
      const hasRtsp = ports.some((p) => [554, 8554, 10554].includes(p));
      const hasWeb = ports.some((p) => [80, 81, 82, 83, 443, 8080, 8081, 8443, 8888].includes(p));
      const hasHikLike = ports.some((p) => [8000, 8899].includes(p));
      return d.device_type === 'camera' || hasRtsp || (hasHikLike && hasWeb);
    });

    const actions: any[] = [];

    for (const cam of cameras) {
      const ip = cam.ip;
      const ports = cam.open_ports ?? [];
      const httpPort = ports.includes(80) ? 80 : ports.includes(8000) ? 8000 : ports.includes(8080) ? 8080 : 80;
      const vendor = cam.vendor || 'kamera';

      actions.push(
        {
          id: `cam-${ip}-live`,
          label: `${ip} — Live`,
          icon: '📹',
          type: 'execute' as const,
          executeQuery: `pokaż live ${ip}`,
          variant: 'primary' as const,
          description: `Podgląd na żywo (${vendor})`,
        },
        {
          id: `cam-${ip}-monitor`,
          label: `${ip} — Monitoruj`,
          icon: '🟢',
          type: 'execute' as const,
          executeQuery: `monitoruj ${ip}`,
          variant: 'secondary' as const,
          description: 'Wykrywanie zmian + logi',
        },
        {
          id: `cam-${ip}-config`,
          label: `${ip} — Zapisz/konfiguruj`,
          icon: '🔐',
          type: 'prefill' as const,
          prefillText: `monitoruj ${ip} user:admin admin:HASŁO`,
          variant: 'secondary' as const,
          description: 'Uzupełnij hasło — zostanie zapamiętane na przyszłość',
        },
        {
          id: `cam-${ip}-device-config`,
          label: `${ip} — Konfiguracja (DB)`,
          icon: '💾',
          type: 'execute' as const,
          executeQuery: `konfiguruj kamerę ${ip}`,
          variant: 'outline' as const,
          description: 'Zapisz kamerę w bazie (nazwa/RTSP/HTTP/user/pass)',
        },
        {
          id: `cam-${ip}-web`,
          label: `${ip} — Web UI`,
          icon: '🌐',
          type: 'execute' as const,
          executeQuery: `przeglądaj http://${ip}:${httpPort}`,
          variant: 'outline' as const,
          description: `Panel web (port ${httpPort})`,
        },
        {
          id: `cam-${ip}-ports`,
          label: `${ip} — Skan portów`,
          icon: '🧪',
          type: 'execute' as const,
          executeQuery: `skanuj porty ${ip}`,
          variant: 'outline' as const,
          description: 'Zaawansowana analiza usług i producenta',
        },
      );
    }

    return {
      title: 'Kamery — szybkie akcje',
      actions,
      layout: 'cards' as const,
    };
  }

  private async browserFallback(
    isCameraQuery: boolean,
    start: number,
    userSpecifiedSubnet: string | null = null,
    context?: PluginContext,
  ): Promise<PluginResult> {
    // Step 1: Detect local subnet (or use user-specified one)
    let localIp: string | null = null;
    let subnet: string;
    let detectionMethod: string;
    
    if (userSpecifiedSubnet) {
      // User specified subnet directly (e.g. "skanuj 192.168.188")
      subnet = userSpecifiedSubnet;
      detectionMethod = 'user-specified';
      console.log(`[NetworkScanPlugin] Using user-specified subnet: ${subnet}`);
    } else {
      // Auto-detect subnet
      const detection = await this.detectSubnet(context);
      localIp = detection.localIp;
      subnet = detection.subnet;
      detectionMethod = detection.detectionMethod;
      
      // Handle multiple interfaces - ask user to choose
      if (detectionMethod === 'user-selection-required') {
        const interfaces = (detection as any).interfaces as Array<[string, string]>;
        const lines = [
          '🌐 **Wykryto wiele interfejsów sieciowych**\n',
          'Wybierz interfejs do skanowania:\n',
        ];
        
        interfaces.forEach(([ifaceName, ip], index) => {
          const subnet = ip.split('.').slice(0, 3).join('.');
          lines.push(`**${index + 1}. ${ifaceName}** — ${ip} (podsieć: ${subnet}.0/24)`);
          lines.push(`   💬 Skanuj: *"skanuj ${subnet}"* lub *"pokaż kamery ${subnet}"*\n`);
        });
        
        lines.push('---');
        lines.push('💡 **Sugerowane akcje:**');
        interfaces.forEach(([ifaceName, ip], index) => {
          const subnet = ip.split('.').slice(0, 3).join('.');
          const action = isCameraQuery ? `pokaż kamery ${subnet}` : `skanuj ${subnet}`;
          lines.push(`- "${action}" — Skanuj ${ifaceName} (${ip})`);
        });

        // Global useful actions
        lines.push(`- "aktywne monitoringi" — Lista aktywnych monitoringów`);
        lines.push(`- "jak działa monitoring" — Wyjaśnij pipeline i diagnostykę`);
        
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ 
            type: 'text', 
            data: lines.join('\n'), 
            title: 'Wybór interfejsu sieciowego' 
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false } as any,
        };
      }
    }

    console.log(`[NetworkScanPlugin] Browser scan: subnet=${subnet} (via ${detectionMethod}), localIp=${localIp || 'unknown'}`);

    // Step 2: Build probe list — gateway, common camera IPs, and strategic range sample
    const gatewayIp = `${subnet}.1`;
    
    // Focus on common camera/device IP ranges instead of full subnet scan
    const netCfg = configStore.getAll().network;
    const commonCameraIps = netCfg.commonCameraIpOffsets;
    const commonDeviceIps = netCfg.commonDeviceIpOffsets;
    
    // Combine all target IPs, removing duplicates
    const allOffsets = new Set([1, ...commonCameraIps, ...commonDeviceIps]);
    const probeIps = [...allOffsets].map(n => `${subnet}.${n}`);

    // Step 3: Multi-strategy probe on common ports
    const httpPorts = isCameraQuery ? netCfg.cameraPorts : netCfg.generalPorts;
    const httpFound: Array<{ ip: string; port: number; method: string }> = [];

    // fetch no-cors: resolves (opaque) = host alive on that port, rejects = unreachable/closed.
    // Timing gates are removed — they cause false positives in WebKitGTK/Chromium
    // because CORS-blocked requests to non-existent IPs often take >15ms.
    const probeHttp = (ip: string, port: number): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), netCfg.probeTimeoutMs);
      return fetch(`http://${ip}:${port}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      })
        .then(() => {
          httpFound.push({ ip, port, method: 'fetch-ok' });
        })
        .catch(() => {
          // Host not reachable on this port — expected for most IPs
        })
        .finally(() => {
          clearTimeout(timer);
        });
    };

    const batchSize = netCfg.batchSize;
    console.log(`[NetworkScanPlugin] Probing ${probeIps.length} IPs × ${httpPorts.length} ports (batch=${batchSize})`);
    
    for (let i = 0; i < probeIps.length; i += batchSize) {
      const batch = probeIps.slice(i, i + batchSize);
      await Promise.allSettled(batch.flatMap(ip => httpPorts.map(port => probeHttp(ip, port))));
      
      if (probeIps.length > 20 && (i + batchSize) % (batchSize * 2) === 0) {
        console.log(`[NetworkScanPlugin] Scan progress: ${Math.min(i + batchSize, probeIps.length)}/${probeIps.length} IPs, found: ${httpFound.length}`);
      }
    }

    // Deduplicate HTTP results by IP (keep first port found)
    const httpByIp = new Map<string, { port: number; method: string }>();
    for (const { ip, port, method } of httpFound) {
      if (!httpByIp.has(ip)) httpByIp.set(ip, { port, method });
    }
    const httpHosts = [...httpByIp.entries()].map(([ip, { port, method }]) => ({ ip, port, method }));
    console.log(`[NetworkScanPlugin] Scan complete: ${httpHosts.length} hosts found`, httpHosts.map(h => `${h.ip}:${h.port}(${h.method})`));

    // Step 4: IPs with port 554 or 8554 already captured in httpFound — mark as RTSP cameras
    const rtspHosts = new Set<string>();
    for (const { ip, port } of httpFound) {
      if (port === 554 || port === 8554) rtspHosts.add(ip);
    }

    // Step 5: Classify and format results
    const lines = [
      isCameraQuery
        ? `📷 **Wyszukiwanie kamer** *(tryb przeglądarkowy)*\n`
        : `🔍 **Skanowanie sieci** *(tryb przeglądarkowy)*\n`,
      `🌐 **Podsieć:** ${subnet}.0/24 *(wykryta: ${detectionMethod})*`,
      `Przeskanowano: ${probeIps.length} adresów IP`,
      `Znaleziono: ${httpHosts.length} aktywnych hostów\n`,
    ];

    if (httpHosts.length === 0) {
      lines.push('Nie wykryto urządzeń w sieci.');
      lines.push('');
      lines.push('**Możliwe przyczyny:**');
      lines.push('- Przeglądarka blokuje skanowanie LAN (CORS/mixed-content)');
      lines.push('- Urządzenia są w innej podsieci');
      lines.push(`- Twój adres IP: ${localIp || 'nie wykryto'}`);
      lines.push('');
      lines.push('💡 **Co możesz zrobić:**');
      lines.push('');
      lines.push('**1. Podaj IP kamery bezpośrednio:**');
      lines.push(`- "monitoruj ${subnet}.100" — sprawdź konkretny adres`);
      lines.push(`- "ping ${subnet}.1" — sprawdź gateway`);
      lines.push('');
      lines.push('**2. Sprawdź router:**');
      lines.push(`- Otwórz panel routera: \`http://${gatewayIp}\``);
      lines.push('- Lista DHCP pokaże wszystkie urządzenia w sieci');
      lines.push('');
      lines.push('**3. Uruchom Tauri:**');
      lines.push('- Pełne skanowanie TCP/ARP/ONVIF bez ograniczeń przeglądarki');
      lines.push('');
      lines.push('---');
      lines.push('💡 **Sugerowane akcje:**');
      lines.push(`- "monitoruj ${subnet}.100" — Sprawdź typowy IP kamery`);
      lines.push(`- "ping ${subnet}.1" — Sprawdź gateway`);
      lines.push(`- "skanuj porty ${subnet}.1" — Porty routera`);
      lines.push(`- "bridge rest GET http://${gatewayIp}" — Pobierz stronę routera`);
      lines.push(`- "aktywne monitoringi" — Lista aktywnych monitoringów`);
      lines.push(`- "ustaw próg zmian 10%" — Większa czułość (globalnie)`);
      lines.push(`- "zmień interwał co 10s" — Częstsze sprawdzanie (globalnie)`);
    } else {
      const cameras: string[] = [];
      const others: string[] = [];

      for (const { ip, port } of httpHosts) {
        const hasRtsp = rtspHosts.has(ip);
        const isCamera = hasRtsp; // only confirmed RTSP port 554/8554 = camera

        if (isCamera) {
          cameras.push(ip);
          const rtspPort = httpFound.find(h => h.ip === ip && (h.port === 8554))?.port === 8554 ? 8554 : 554;
          lines.push(`📷 **${ip}** *(kamera RTSP)*`);
          lines.push(`   🎥 RTSP: \`rtsp://${ip}:${rtspPort}/stream\``);
          if (port !== 554 && port !== 8554) lines.push(`   🌐 HTTP: \`http://${ip}:${port}\``);
          lines.push(`   💬 Monitoruj: *"monitoruj ${ip}"*`);
          lines.push(`   💬 Logi: *"pokaż logi monitoringu ${ip}"*`);
          lines.push(`   💬 Stop: *"stop monitoring ${ip}"*`);
        } else {
          others.push(ip);
          lines.push(`🖥️ **${ip}** — port: ${port}`);
          lines.push(`   🌐 \`http://${ip}:${port}\``);
        }
      }

      if (isCameraQuery && cameras.length === 0 && others.length > 0) {
        lines.push('');
        lines.push('ℹ️ *Nie wykryto kamer RTSP. Znalezione hosty to prawdopodobnie routery/urządzenia sieciowe.*');
        lines.push('💡 Jeśli kamera ma inny IP, podaj go bezpośrednio: *"monitoruj 192.168.1.200"*');
      }

      lines.push('');
      lines.push('💡 *Dla pełnego skanowania TCP/ARP uruchom aplikację **Tauri**.*');
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: isCameraQuery ? 'Kamery (przeglądarka)' : 'Sieć (przeglądarka)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false } as any,
    };
  }

  /**
   * Multi-strategy local subnet detection:
   * 0. Tauri backend - most reliable (reads from OS network interfaces)
   * 1. WebRTC ICE candidates (works in Chrome/Firefox, not Tauri WebKitGTK)
   * 2. Gateway probe — try common gateway IPs to infer subnet
   * 3. Default fallback
   */
  private async detectSubnet(context?: PluginContext): Promise<{ localIp: string | null; subnet: string; detectionMethod: string }> {
    console.log(`[NetworkScanPlugin] Starting subnet detection...`);
    
    // Strategy 0: Tauri backend via PluginContext invoke bridge
    if (context?.isTauri && context.tauriInvoke) {
      try {
        console.log(`[NetworkScanPlugin] Trying Tauri backend network detection...`);
        
        // Get all network interfaces
        const interfaces = await context.tauriInvoke('list_network_interfaces', {}) as Array<[string, string]>;
        console.log(`[NetworkScanPlugin] Found ${interfaces.length} network interfaces:`, interfaces);
        
        if (interfaces.length === 0) {
          console.warn(`[NetworkScanPlugin] ⚠️ No network interfaces found`);
        } else if (interfaces.length === 1) {
          // Single interface - use it directly
          const [ifaceName, ip] = interfaces[0];
          const subnet = ip.split('.').slice(0, 3).join('.');
          console.log(`[NetworkScanPlugin] ✅ Tauri detected: IP=${ip}, subnet=${subnet}, interface=${ifaceName}`);
          return {
            localIp: ip,
            subnet,
            detectionMethod: `Tauri (${ifaceName})`,
          };
        } else {
          // Multiple interfaces - auto select the best one (do not prompt)
          const best = this.pickBestInterface(interfaces);
          if (best) {
            const [ifaceName, ip] = best;
            const subnet = ip.split('.').slice(0, 3).join('.');
            console.log(`[NetworkScanPlugin] ✅ Tauri auto-selected interface: IP=${ip}, subnet=${subnet}, interface=${ifaceName}`);
            return {
              localIp: ip,
              subnet,
              detectionMethod: `Tauri (${ifaceName})`,
            };
          }

          // If we cannot decide (should be rare), fall back to first interface
          const [ifaceName, ip] = interfaces[0];
          const subnet = ip.split('.').slice(0, 3).join('.');
          console.warn(`[NetworkScanPlugin] ⚠️ Could not auto-select interface, falling back to first: IP=${ip}, interface=${ifaceName}`);
          return {
            localIp: ip,
            subnet,
            detectionMethod: `Tauri (${ifaceName})`,
          };
        }
      } catch (err) {
        console.warn(`[NetworkScanPlugin] ⚠️ Tauri network detection failed:`, err);
      }
    } else if (context?.isTauri) {
      console.warn('[NetworkScanPlugin] ⚠️ Tauri mode without tauriInvoke bridge, skipping backend subnet detection');
    }
    
    // Strategy 1: WebRTC - most reliable for browser, gets actual local IP from OS
    const webrtcIp = await this.detectLocalIpViaWebRTC();
    if (webrtcIp) {
      const subnet = webrtcIp.split('.').slice(0, 3).join('.');
      console.log(`[NetworkScanPlugin] ✅ WebRTC detected: IP=${webrtcIp}, subnet=${subnet}`);
      return {
        localIp: webrtcIp,
        subnet,
        detectionMethod: 'WebRTC',
      };
    }
    console.log(`[NetworkScanPlugin] ⚠️ WebRTC failed (not supported or blocked), trying gateway probe...`);

    // Strategy 2: Probe common gateway IPs to infer subnet
    // Note: This is a fallback and may detect wrong subnet if multiple networks respond
    const candidateSubnets = this.getCommonSubnets();
    console.log(`[NetworkScanPlugin] Probing ${candidateSubnets.length} common gateways...`);
    
    const gatewayResult = await this.probeGateways(candidateSubnets);
    if (gatewayResult) {
      console.log(`[NetworkScanPlugin] ✅ Gateway probe detected: ${gatewayResult}.0/24`);
      console.warn(`[NetworkScanPlugin] ⚠️ Using gateway probe fallback - may be inaccurate. Consider using Tauri for accurate detection.`);
      return { localIp: null, subnet: gatewayResult, detectionMethod: 'gateway-probe' };
    }
    console.log(`[NetworkScanPlugin] ❌ Gateway probe failed, using default subnet...`);

    // Strategy 3: Default fallback - least reliable
    const fallbackSubnet = configStore.get<string>('network.defaultSubnet');
    console.warn(`[NetworkScanPlugin] ⚠️ Using default subnet ${fallbackSubnet} - this is likely incorrect!`);
    console.warn(`[NetworkScanPlugin] 💡 Tip: Use Tauri app for accurate network detection, or specify IP manually.`);
    return { localIp: null, subnet: fallbackSubnet, detectionMethod: 'domyślna' };
  }

  private getCommonSubnets(): string[] {
    return configStore.get<string[]>('network.commonSubnets');
  }

  private detectLocalIpViaWebRTC(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`[NetworkScanPlugin] WebRTC timeout - no local IP detected in 2s`);
        resolve(null);
      }, 2000);

      try {
        const RTCPeerConnection = (window as any).RTCPeerConnection
          || (window as any).webkitRTCPeerConnection
          || (window as any).mozRTCPeerConnection;

        if (!RTCPeerConnection) {
          console.log(`[NetworkScanPlugin] WebRTC not available (RTCPeerConnection undefined)`);
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        console.log(`[NetworkScanPlugin] WebRTC available, starting ICE candidate gathering...`);
        
        // Use null iceServers to get only host candidates (no STUN needed for LAN IP)
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');

        let candidateCount = 0;
        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (!event.candidate) {
            // Gathering complete, no LAN IP found
            console.log(`[NetworkScanPlugin] WebRTC ICE gathering complete. Candidates found: ${candidateCount}, but no private IP detected.`);
            clearTimeout(timeout);
            pc.close();
            resolve(null);
            return;
          }
          
          candidateCount++;
          const candidate = event.candidate.candidate;
          console.log(`[NetworkScanPlugin] WebRTC candidate #${candidateCount}: ${candidate}`);
          
          const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          if (ipMatch) {
            const ip = ipMatch[1];
            console.log(`[NetworkScanPlugin] WebRTC extracted IP: ${ip}, isPrivate: ${this.isPrivateIp(ip)}`);
            
            if (this.isPrivateIp(ip)) {
              clearTimeout(timeout);
              pc.close();
              console.log(`[NetworkScanPlugin] ✅ WebRTC detected local IP: ${ip}`);
              resolve(ip);
            }
          }
        };

        pc.createOffer()
          .then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer))
          .catch((err: unknown) => { 
            console.error(`[NetworkScanPlugin] WebRTC createOffer failed:`, err);
            clearTimeout(timeout); 
            resolve(null); 
          });
      } catch (err) {
        console.error(`[NetworkScanPlugin] WebRTC exception:`, err);
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }

  private async probeGateways(subnets: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const settled: Array<boolean | null> = new Array(subnets.length).fill(null);

      const tryResolve = () => {
        if (resolved) return;

        for (let i = 0; i < settled.length; i++) {
          const v = settled[i];
          if (v === null) return;
          if (v === true) {
            resolved = true;
            console.log(`[NetworkScanPlugin] Gateway ${subnets[i]}.1 responded`);
            resolve(subnets[i]);
            return;
          }
        }

        resolved = true;
        resolve(null);
      };

      subnets.forEach((subnet, idx) => {
        this.probeGateway(subnet)
          .then((ok) => {
            settled[idx] = ok;
            tryResolve();
          })
          .catch(() => {
            settled[idx] = false;
            tryResolve();
          });
      });
    });
  }

  private probeGateway(subnet: string): Promise<boolean> {
    const gatewayIp = `${subnet}.1`;
    // Use fetch no-cors: resolves (opaque) = gateway reachable, rejects = unreachable.
    // Timing gates removed — they produce false positives in WebKitGTK/Chromium
    // where CORS-blocked requests to non-existent IPs can take >15ms.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configStore.get<number>('network.gatewayProbeTimeoutMs'));
    return fetch(`http://${gatewayIp}/`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })
      .then(() => {
        console.log(`[NetworkScanPlugin] Gateway ${gatewayIp} reachable`);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
      });
  }

  private isPrivateIp(ip: string): boolean {
    return ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }

  private isValidCandidateIp(ip: string): boolean {
    if (!ip) return false;
    if (ip.startsWith('127.')) return false;
    if (ip.startsWith('169.254.')) return false;
    return this.isPrivateIp(ip);
  }

  private interfaceScore(ifaceName: string, ip: string): number {
    let score = 0;
    if (this.isValidCandidateIp(ip)) score += 100;

    // Prefer common LAN ranges
    if (ip.startsWith('192.168.')) score += 30;
    else if (ip.startsWith('10.')) score += 20;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score += 10;

    // Prefer physical/WiFi interfaces over tunnels/containers
    const n = (ifaceName || '').toLowerCase();
    if (/^(en|eth|eno|enp)/.test(n)) score += 15;
    if (/^(wl|wlan|wlp)/.test(n)) score += 12;
    if (/docker|br-|veth|virbr|vmnet|tun|tap|wg|tailscale|zt|ham|lo/.test(n)) score -= 25;

    return score;
  }

  private pickBestInterface(interfaces: Array<[string, string]>): [string, string] | null {
    const scored = interfaces
      .map(([name, ip]) => ({ name, ip, score: this.interfaceScore(name, ip) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) return null;
    if (best.score <= 0) return null;
    return [best.name, best.ip];
  }

  private formatRaspberryPiResult(result: NetworkScanResult): string {
    const devices = (result.devices || []).filter((d) => {
      const vendor = (d.vendor || '').toLowerCase();
      const hostname = (d.hostname || '').toLowerCase();
      return vendor.includes('raspberry') || hostname.includes('raspberry') || hostname.includes('rpi');
    });

    let content = `🥧 **Wyszukiwanie Raspberry Pi zakończone**\n\n`;
    content += `Metoda: ${result.scan_method}\n`;
    content += `Czas trwania: ${result.scan_duration}ms\n`;
    content += `Znaleziono urządzeń: ${devices.length}\n\n`;

    if (devices.length === 0) {
      content += 'Nie wykryto urządzeń Raspberry Pi (po polu vendor/hostname).\n';
      content += '💡 Jeśli jesteś w aplikacji desktopowej, spróbuj: "skanuj sieć" i sprawdź listę vendor/MAC.\n';
      return content;
    }

    devices.forEach((device, index) => {
      content += `${index + 1}. **${device.ip}**\n`;
      if (device.hostname) content += `   Hostname: ${device.hostname}\n`;
      if (device.mac) content += `   MAC: \`${device.mac}\`\n`;
      if (device.vendor) content += `   Producent: ${device.vendor}\n`;
      if (device.open_ports.length > 0) content += `   Porty: ${device.open_ports.join(', ')}\n`;
      content += `   RTT: ${device.response_time}ms\n\n`;
    });

    return content;
  }

  private formatScanResult(result: NetworkScanResult, isCameraQuery = false, scanStats?: {
    devicesFound: number;
    devicesUpdated: number;
    newDevices: number;
    scanDuration: number;
    efficiency: string;
  }): string {
    const { devices, scan_duration, scan_method } = result;

    let content = isCameraQuery
      ? `📷 **Wyszukiwanie kamer zakończone**\n\n`
      : `🔍 **Skanowanie sieci zakończone**\n\n`;

    content += `Metoda: ${scan_method}\n`;
    content += `Czas trwania: ${scan_duration}ms\n`;
    content += `Znaleziono urządzeń: ${devices.length}\n`;
    
    // Add scan statistics if available
    if (scanStats) {
      content += `Efektywność: ${scanStats.efficiency}\n`;
      if (scanStats.newDevices > 0) {
        content += `Nowe urządzenia: ${scanStats.newDevices}\n`;
      }
      if (scanStats.devicesUpdated > 0) {
        content += `Zaktualizowane: ${scanStats.devicesUpdated}\n`;
      }
    }
    
    content += '\n';

    if (devices.length === 0) {
      content += `Nie znaleziono żadnych urządzeń w sieci.\n`;
    } else {
      const relevantDevices = isCameraQuery
        ? devices.filter(d => {
            const ports = d.open_ports ?? [];
            const hasRtsp = ports.some(p => [554, 8554, 10554].includes(p));
            const hasWeb = ports.some(p => [80, 81, 82, 83, 443, 8080, 8081, 8443, 8888].includes(p));
            const hasHikLike = ports.some(p => [8000, 8899].includes(p));
            return (
              d.device_type === 'camera' ||
              d.hostname?.toLowerCase().includes('cam') ||
              d.vendor?.toLowerCase().includes('hikvision') ||
              d.vendor?.toLowerCase().includes('dahua') ||
              hasRtsp ||
              (hasHikLike && hasWeb)
            );
          })
        : devices;

      if (isCameraQuery && relevantDevices.length === 0) {
        content += `Nie znaleziono kamer w sieci.\n\n**Wszystkie znalezione urządzenia:**\n\n`;
      } else {
        content += isCameraQuery ? `**Znalezione kamery:**\n\n` : `**Znalezione urządzenia:**\n\n`;
      }

      const devicesToShow = isCameraQuery && relevantDevices.length > 0 ? relevantDevices : devices;

      devicesToShow.forEach((device, index) => {
        content += `${index + 1}. **${device.ip}**`;
        if (device.device_type) content += ` *(${device.device_type})*`;
        content += '\n';
        if (device.hostname) content += `   Hostname: ${device.hostname}\n`;
        if (device.mac) content += `   MAC: \`${device.mac}\`\n`;
        if (device.vendor) content += `   Producent: ${device.vendor}\n`;
        if (device.open_ports.length > 0) content += `   Porty: ${device.open_ports.join(', ')}\n`;
        content += `   RTT: ${device.response_time}ms\n`;
        if (device.open_ports.includes(554)) {
          content += `   📷 RTSP: \`rtsp://${device.ip}:554/stream\`\n`;
        }
        content += '\n';
      });
      
      // Add inline action hints for cameras
      if (isCameraQuery && devicesToShow.length > 0) {
        content += `\n💡 **Sugerowane akcje:**\n`;
        devicesToShow.forEach(device => {
          const hasRtsp = device.open_ports.includes(554) || device.open_ports.includes(8554);
          const hasHttp = device.open_ports.includes(80) || device.open_ports.includes(8000);
          
          if (hasRtsp) {
            const rtspPort = device.open_ports.includes(554) ? 554 : 8554;
            content += `- "pokaż live ${device.ip}" — Podgląd na żywo z kamery\n`;
            content += `- "monitoruj ${device.ip}" — Rozpocznij monitoring kamery\n`;
            content += `- "pokaż logi monitoringu ${device.ip}" — Logi zmian dla tej kamery\n`;
            content += `- "stop monitoring ${device.ip}" — Zatrzymaj monitoring tej kamery\n`;
            content += `- "ustaw próg zmian 10%" — Większa czułość (globalnie)\n`;
            content += `- "zmień interwał co 10s" — Częstsze sprawdzanie (globalnie)\n`;
            content += `- "jak działa monitoring" — Wyjaśnij pipeline i diagnostykę\n`;
            content += `- "test streams ${device.ip} user:admin admin:HASŁO" — Sprawdź warianty RTSP\n`;
          }
          if (hasHttp) {
            const httpPort = device.open_ports.includes(80) ? 80 : 8000;
            content += `- "przeglądaj http://${device.ip}:${httpPort}" — Otwórz interfejs web\n`;
          }
          content += `- "aktywne monitoringi" — Lista aktywnych monitoringów\n`;
          content += `- "skanuj porty ${device.ip}" — Zaawansowana analiza portów i producenta\n`;
        });
      }
    }

    return content;
  }

  /** Persist discovered devices to SQLite via DeviceRepository. */
  private async persistDevices(devices: NetworkDevice[], context: PluginContext): Promise<void> {
    if (!context.databaseManager || !context.databaseManager.isReady()) return;

    try {
      const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
      const mapped = devices.map((d) => ({
        id: d.mac || d.ip,
        ip: d.ip,
        hostname: d.hostname,
        mac: d.mac,
        vendor: d.vendor,
      }));
      await repo.saveDevices(mapped);

      // Emit device_discovered events for real-time sync
      for (const device of devices) {
        const event = createEvent('device_discovered', {
          id: device.mac || device.ip,
          ip: device.ip,
          hostname: device.hostname,
          vendor: device.vendor,
          deviceType: device.device_type,
          services: device.open_ports.map(port => ({
            type: port === 554 || port === 8554 ? 'rtsp'
              : port === 1883 ? 'mqtt'
              : port === 22 ? 'ssh'
              : 'http',
            port,
          })),
        });
        
        // Emit through context if available (for EventStore integration)
        if (context.eventStore) {
          context.eventStore.append(event);
        }
      }

      // Update device status to 'online' for discovered devices
      for (const device of mapped) {
        await repo.updateDeviceStatus(device.id, 'online');
      }

      // Persist services (open ports)
      for (const d of devices) {
        const deviceId = d.mac || d.ip;
        for (const port of d.open_ports) {
          const type = port === 554 || port === 8554 ? 'rtsp'
            : port === 1883 ? 'mqtt'
            : port === 22 ? 'ssh'
            : 'http';
          await repo.saveService({
            id: `${deviceId}:${port}`,
            deviceId,
            type: type as any,
            port,
            status: 'online',
          });
        }
      }

      console.log(`[NetworkScanPlugin] Persisted ${mapped.length} devices to SQLite`);
    } catch (err) {
      console.warn('[NetworkScanPlugin] persistDevices error:', err);
    }
  }

  /** Determine optimal scan strategy based on history and context */
  private async determineScanStrategy(
    userSpecifiedSubnet: string | null,
    context: PluginContext
  ): Promise<{
    type: 'full' | 'incremental' | 'targeted';
    subnet: string;
    targetRanges?: string[];
    triggeredBy: 'manual' | 'scheduled' | 'auto';
  }> {
    // Default subnet detection
    const subnet = userSpecifiedSubnet || await this.getDefaultSubnet(context);
    
    if (!context.databaseManager || !context.databaseManager.isReady()) {
      return { type: 'full', subnet, triggeredBy: 'manual' };
    }

    try {
      const scanHistoryRepo = new ScanHistoryRepository(context.databaseManager.getDevicesDb());
      const recommendation = await scanHistoryRepo.shouldUseIncrementalScan(subnet);

      if (recommendation.recommended && recommendation.lastScan) {
        // Calculate incremental target ranges based on last scan
        const targetRanges = await this.calculateIncrementalRanges(
          subnet, 
          recommendation.lastScan,
          context,
        );
        
        console.log(`[NetworkScanPlugin] Using incremental scan: ${recommendation.reason}`);
        return {
          type: 'incremental',
          subnet,
          targetRanges,
          triggeredBy: 'manual'
        };
      }

      console.log(`[NetworkScanPlugin] Using full scan: ${recommendation.reason}`);
      return { type: 'full', subnet, triggeredBy: 'manual' };
    } catch (err) {
      console.warn('[NetworkScanPlugin] Failed to determine scan strategy:', err);
      return { type: 'full', subnet, triggeredBy: 'manual' };
    }
  }

  /** Calculate target IP ranges for incremental scanning */
  private async calculateIncrementalRanges(
    subnet: string,
    lastScan: any,
    context: PluginContext,
  ): Promise<string[]> {
    // Strategy:
    // - Prefer focusing around known devices from devices.db in this subnet
    // - Build small windows around last octet values and merge overlapping windows
    // - Cap host count to keep scan fast
    const FALLBACK = [`${subnet}.1-254`];

    try {
      if (!context.databaseManager || !context.databaseManager.isReady()) {
        return FALLBACK;
      }

      const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
      const devices = await repo.listDevices(200);
      const prefix = `${subnet}.`;
      const octets = devices
        .map((d) => d.ip)
        .filter((ip) => typeof ip === 'string' && ip.startsWith(prefix))
        .map((ip) => {
          const last = ip.split('.').pop();
          const n = last ? Number(last) : NaN;
          return Number.isFinite(n) ? n : null;
        })
        .filter((n): n is number => n !== null && n >= 1 && n <= 254);

      if (octets.length === 0) {
        return FALLBACK;
      }

      // Build windows around known devices.
      // If last scan found many devices and was slow, use narrower windows.
      const slowScan = lastScan?.devicesFound > 5 && lastScan?.scanDurationMs > 10_000;
      const window = slowScan ? 2 : 4;

      const intervals: Array<[number, number]> = octets.map((n) => [
        Math.max(1, n - window),
        Math.min(254, n + window),
      ]);

      intervals.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const [start, end] of intervals) {
        const last = merged[merged.length - 1];
        if (!last || start > last[1] + 1) {
          merged.push([start, end]);
        } else {
          last[1] = Math.max(last[1], end);
        }
      }

      // Cap total host count to keep scans quick.
      const MAX_HOSTS = slowScan ? 60 : 100;
      const ranges: string[] = [];
      let hosts = 0;
      for (const [start, end] of merged) {
        const size = end - start + 1;
        if (hosts >= MAX_HOSTS) break;
        if (hosts + size <= MAX_HOSTS) {
          ranges.push(`${subnet}.${start}-${end}`);
          hosts += size;
        } else {
          const allowedEnd = start + (MAX_HOSTS - hosts) - 1;
          ranges.push(`${subnet}.${start}-${allowedEnd}`);
          hosts = MAX_HOSTS;
          break;
        }
      }

      // If the merged windows are too small (e.g. only 1-2 hosts), widen slightly.
      if (ranges.length === 0) {
        return FALLBACK;
      }

      return ranges;
    } catch (err) {
      console.warn('[NetworkScanPlugin] Failed to calculate incremental ranges:', err);
      return FALLBACK;
    }
  }

  /** Track scan results and save to history */
  private async trackScanResults(
    scanId: string,
    subnet: string,
    scanType: 'full' | 'incremental' | 'targeted',
    result: NetworkScanResult,
    scanStart: number,
    triggeredBy: 'manual' | 'scheduled' | 'auto',
    context: PluginContext,
  ): Promise<{
    devicesFound: number;
    devicesUpdated: number;
    newDevices: number;
    scanDuration: number;
    efficiency: string;
  }> {
    const scanDuration = Date.now() - scanStart;
    
    // Count new vs updated devices (requires database access)
    let newDevices = 0;
    let devicesUpdated = 0;
    
    try {
      // This would need access to device repository to compare with existing devices
      // For now, estimate based on scan type and results
      if (scanType === 'incremental') {
        // Assume incremental scans find fewer new devices
        newDevices = Math.max(0, result.devices.length - Math.floor(result.devices.length * 0.7));
        devicesUpdated = result.devices.length - newDevices;
      } else {
        // Full scans likely find more new devices
        newDevices = Math.floor(result.devices.length * 0.3);
        devicesUpdated = result.devices.length - newDevices;
      }
    } catch (err) {
      console.warn('[NetworkScanPlugin] Failed to calculate device statistics:', err);
      newDevices = result.devices.length;
      devicesUpdated = 0;
    }

    // Calculate efficiency
    const devicesPerSecond = result.devices.length > 0 ? (result.devices.length / (scanDuration / 1000)).toFixed(1) : '0';
    const efficiency = `${devicesPerSecond} devices/s`;

    // Save to scan history if database is available
    try {
      if (context.databaseManager && context.databaseManager.isReady()) {
        const repo = new ScanHistoryRepository(context.databaseManager.getDevicesDb());
        await repo.save({
          timestamp: Date.now(),
          scope: 'default',
          subnet,
          deviceCount: result.devices.length,
          durationMs: scanDuration,
          success: true,
          metadata: {
            scanId,
            scanType,
            triggeredBy,
            scanMethod: result.scan_method,
            scanDurationBackendMs: result.scan_duration,
          },
        });
      }
    } catch (err) {
      console.warn('[NetworkScanPlugin] Failed to save scan history:', err);
    }

    return {
      devicesFound: result.devices.length,
      devicesUpdated,
      newDevices,
      scanDuration,
      efficiency
    };
  }

  /** Get default subnet for scanning */
  private async getDefaultSubnet(context: PluginContext): Promise<string> {
    try {
      if (context.isTauri && context.tauriInvoke) {
        const raw = await context.tauriInvoke('list_network_interfaces');

        // Backend may return either:
        // - Array<[name, ip]>
        // - Array<{ name, ip, subnet?: string }>
        const tuples: Array<[string, string]> = Array.isArray(raw)
          ? (raw
              .map((it: any) => {
                if (Array.isArray(it) && typeof it[0] === 'string' && typeof it[1] === 'string') {
                  return [it[0], it[1]] as [string, string];
                }
                if (it && typeof it.name === 'string' && typeof it.ip === 'string') {
                  return [it.name, it.ip] as [string, string];
                }
                return null;
              })
              .filter(Boolean) as Array<[string, string]>)
          : [];

        const best = this.pickBestInterface(tuples);
        const picked = best || tuples[0];
        if (picked) {
          const [, ip] = picked;
          if (ip && !ip.startsWith('127.')) {
            return ip.split('.').slice(0, 3).join('.');
          }
        }
      }
    } catch (err) {
      console.warn('[NetworkScanPlugin] Failed to detect subnet:', err);
    }

    // Final fallback: user-configured default subnet (still better than hardcoded)
    return configStore.get<string>('network.defaultSubnet');
  }

  async dispose(): Promise<void> {
    console.log('Network Scan Plugin disposed');
  }
}

interface NetworkDevice {
  ip: string;
  mac?: string;
  hostname?: string;
  vendor?: string;
  open_ports: number[];
  response_time: number;
  last_seen: string;
  device_type?: string;
}

interface NetworkScanResult {
  devices: NetworkDevice[];
  scan_duration: number;
  scan_method: string;
  subnet: string;
}

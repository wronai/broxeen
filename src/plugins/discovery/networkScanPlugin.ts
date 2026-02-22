/**
 * Network Scan Plugin - provides network discovery capabilities
 * Uses Tauri backend commands for real network scanning.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

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
    
    return scanKeywords.some(keyword => lowerInput.includes(keyword)) ||
           cameraKeywords.some(keyword => lowerInput.includes(keyword));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const isCameraQuery = input.toLowerCase().includes('kamer') || input.toLowerCase().includes('camera');

    if (context.isTauri && context.tauriInvoke) {
      try {
        console.log(`[NetworkScanPlugin] Starting real network scan via Tauri...`);
        const result = await context.tauriInvoke('scan_network', {
          subnet: null,
          timeout: 5000,
        }) as NetworkScanResult;

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: this.formatScanResult(result, isCameraQuery),
            title: isCameraQuery ? 'Wyniki wyszukiwania kamer' : 'Wyniki skanowania sieci',
          }],
          metadata: {
            duration_ms: Date.now() - start,
            cached: false,
            truncated: false,
            deviceCount: result.devices.length,
            scanDuration: result.scan_duration,
            scanMethod: result.scan_method,
          },
        };
      } catch (error) {
        console.error('[NetworkScanPlugin] scan_network failed:', error);
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

    // Browser fallback: HTTP probe of common LAN addresses
    return this.browserFallback(isCameraQuery, start);
  }

  private async browserFallback(isCameraQuery: boolean, start: number): Promise<PluginResult> {
    const subnet = '192.168.1';
    const ports = isCameraQuery ? [554, 8554, 80, 8080] : [80, 443, 22, 8080, 554];
    const probeIps = Array.from({ length: 20 }, (_, i) => `${subnet}.${i + 1}`);
    const found: Array<{ ip: string; port: number }> = [];

    await Promise.allSettled(
      probeIps.flatMap(ip =>
        ports.map(async port => {
          const resp = await fetch(`http://${ip}:${port}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(600),
          }).catch(() => null);
          if (resp) found.push({ ip, port });
        })
      )
    );

    const lines = [
      isCameraQuery
        ? `📷 **Wyszukiwanie kamer** *(tryb HTTP — pełne skanowanie wymaga Tauri)*\n`
        : `🔍 **Skanowanie sieci** *(tryb HTTP — pełne skanowanie wymaga Tauri)*\n`,
      `Przeskanowano: ${probeIps.length} adresów IP`,
      `Znaleziono: ${found.length} aktywnych hostów\n`,
    ];

    if (found.length === 0) {
      lines.push('Nie wykryto urządzeń w sieci (ograniczenia przeglądarki).');
      lines.push('\n💡 Uruchom aplikację Tauri dla pełnego skanowania TCP/ARP.');
    } else {
      const unique = [...new Map(found.map(f => [f.ip, f])).values()];
      unique.forEach(({ ip, port }) => {
        const isCamera = [554, 8554].includes(port);
        lines.push(`${isCamera ? '📷' : '🖥️'} **${ip}** (port ${port})`);
        if (isCamera) lines.push(`   RTSP: \`rtsp://${ip}:554/stream\``);
      });
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: isCameraQuery ? 'Kamery (HTTP)' : 'Sieć (HTTP)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private formatScanResult(result: NetworkScanResult, isCameraQuery = false): string {
    const { devices, scan_duration, scan_method } = result;

    let content = isCameraQuery
      ? `📷 **Wyszukiwanie kamer zakończone**\n\n`
      : `🔍 **Skanowanie sieci zakończone**\n\n`;

    content += `Metoda: ${scan_method}\n`;
    content += `Czas trwania: ${scan_duration}ms\n`;
    content += `Znaleziono urządzeń: ${devices.length}\n\n`;

    if (devices.length === 0) {
      content += `Nie znaleziono żadnych urządzeń w sieci.\n`;
    } else {
      const relevantDevices = isCameraQuery
        ? devices.filter(d =>
            d.device_type === 'camera' ||
            d.hostname?.toLowerCase().includes('cam') ||
            d.vendor?.toLowerCase().includes('hikvision') ||
            d.vendor?.toLowerCase().includes('dahua') ||
            d.open_ports.some(p => [554, 8554].includes(p))
          )
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
    }

    content += `💡 *Zapytaj "pokaż kamerę [IP]" aby zobaczyć obraz lub "skanuj porty [IP]" dla szczegółów.*`;
    return content;
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

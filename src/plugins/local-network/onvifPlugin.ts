/**
 * ONVIF Plugin - discovers and controls ONVIF-compatible cameras
 * Scope: local-network, cameras
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface OnvifCamera {
  ip: string;
  port: number;
  name: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  profileToken?: string;
  streamUri?: string;
  snapshotUri?: string;
  hasPtz?: boolean;
}

export class OnvifPlugin implements Plugin {
  readonly id = 'network-onvif';
  readonly name = 'ONVIF Camera Discovery';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:onvif', 'camera:discover', 'camera:list'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /onvif/i.test(lower) ||
      /odkryj.*kamer/i.test(lower) ||
      /wyszukaj.*kamer/i.test(lower) ||
      /znajdź.*kamer/i.test(lower) ||
      /znajdz.*kamer/i.test(lower) ||
      /lista.*kamer/i.test(lower) ||
      /pokaż.*kamer/i.test(lower) ||
      /pokaz.*kamer/i.test(lower) ||
      /discover.*camera/i.test(lower) ||
      /list.*camera/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    if (context.isTauri && context.tauriInvoke) {
      try {
        const cameras = await context.tauriInvoke('onvif_discover', { timeout: 5000 }) as OnvifCamera[];
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: this.formatCameras(cameras), title: 'Kamery ONVIF' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: cameras.length },
        };
      } catch (error) {
        return this.errorResult(`Błąd ONVIF: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    const demoCameras: OnvifCamera[] = [
      {
        ip: '192.168.1.100', port: 80, name: 'Kamera Wejście',
        manufacturer: 'Hikvision', model: 'DS-2CD2032-I', firmwareVersion: '5.6.3',
        streamUri: 'rtsp://192.168.1.100:554/Streaming/Channels/101',
        snapshotUri: 'http://192.168.1.100/ISAPI/Streaming/channels/101/picture',
        hasPtz: false,
      },
      {
        ip: '192.168.1.101', port: 80, name: 'Kamera Ogród',
        manufacturer: 'Dahua', model: 'IPC-HFW2431S', firmwareVersion: '2.820.0',
        streamUri: 'rtsp://192.168.1.101:554/cam/realmonitor?channel=1&subtype=0',
        snapshotUri: 'http://192.168.1.101/cgi-bin/snapshot.cgi',
        hasPtz: true,
      },
      {
        ip: '192.168.1.102', port: 8080, name: 'Kamera Salon',
        manufacturer: 'Reolink', model: 'RLC-810A', firmwareVersion: '3.0.0',
        streamUri: 'rtsp://192.168.1.102:554/h264Preview_01_main',
        snapshotUri: 'http://192.168.1.102/cgi-bin/api.cgi?cmd=Snap',
        hasPtz: true,
      },
    ];

    const data = `🧪 **Tryb demonstracyjny — Wykrywanie kamer ONVIF**\n\n` +
      this.formatCameras(demoCameras) + '\n\n' +
      `💡 *W aplikacji Tauri wykonywane jest prawdziwe skanowanie WS-Discovery/ONVIF.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Kamery ONVIF (demo)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: demoCameras.length },
    };
  }

  private formatCameras(cameras: OnvifCamera[]): string {
    if (cameras.length === 0) return '📷 Nie znaleziono kamer ONVIF w sieci.\n';

    let out = `📷 **Kamery ONVIF** — ${cameras.length} znalezionych\n\n`;

    for (const cam of cameras) {
      out += `### ${cam.name}\n`;
      out += `- **IP:** ${cam.ip}:${cam.port}\n`;
      if (cam.manufacturer) out += `- **Producent:** ${cam.manufacturer}\n`;
      if (cam.model) out += `- **Model:** ${cam.model}\n`;
      if (cam.firmwareVersion) out += `- **Firmware:** ${cam.firmwareVersion}\n`;
      if (cam.streamUri) out += `- **Stream RTSP:** \`${cam.streamUri}\`\n`;
      if (cam.snapshotUri) out += `- **Snapshot:** \`${cam.snapshotUri}\`\n`;
      out += `- **PTZ:** ${cam.hasPtz ? '✅ Tak' : '❌ Nie'}\n\n`;
    }

    out += `💡 *Możesz teraz zapytać o podgląd konkretnej kamery lub sterować PTZ.*`;
    return out;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('OnvifPlugin initialized'); }
  async dispose(): Promise<void> { console.log('OnvifPlugin disposed'); }
}

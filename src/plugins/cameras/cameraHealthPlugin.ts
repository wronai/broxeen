/**
 * Camera Health Plugin - checks camera availability and status
 * Scope: cameras, local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface CameraStatus {
  id: string;
  name: string;
  ip: string;
  online: boolean;
  latency_ms?: number;
  uptime?: string;
  lastSnapshot?: string;
  resolution?: string;
  fps?: number;
  errorMessage?: string;
}

export class CameraHealthPlugin implements Plugin {
  readonly id = 'camera-health';
  readonly name = 'Camera Health Check';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:health', 'camera:status'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /status.*kamer/i.test(lower) ||
      /stan.*kamer/i.test(lower) ||
      /zdrowie.*kamer/i.test(lower) ||
      /health.*camera/i.test(lower) ||
      /czy.*kamer.*działa/i.test(lower) ||
      /czy.*kamer.*dziala/i.test(lower) ||
      /camera.*status/i.test(lower) ||
      /sprawdź.*kamer/i.test(lower) ||
      /sprawdz.*kamer/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const targetCamera = this.extractCameraId(input);

    if (context.isTauri && context.tauriInvoke) {
      try {
        const statuses = await context.tauriInvoke('camera_health_check', {
          cameraId: targetCamera,
        }) as CameraStatus[];

        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: this.formatStatuses(statuses), title: 'Stan kamer' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: statuses.length },
        };
      } catch (error) {
        return this.errorResult(`Błąd sprawdzania: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    const demoStatuses: CameraStatus[] = [
      {
        id: 'cam-front', name: 'Kamera Wejście', ip: '192.168.1.100',
        online: true, latency_ms: 12, uptime: '14d 6h 32m',
        resolution: '2560x1440', fps: 25,
      },
      {
        id: 'cam-garden', name: 'Kamera Ogród', ip: '192.168.1.101',
        online: true, latency_ms: 8, uptime: '7d 11h 15m',
        resolution: '1920x1080', fps: 30,
      },
      {
        id: 'cam-salon', name: 'Kamera Salon', ip: '192.168.1.102',
        online: false, errorMessage: 'Connection timeout (>5000ms)',
      },
    ];

    const filtered = targetCamera
      ? demoStatuses.filter(s => s.id === targetCamera || s.name.toLowerCase().includes(targetCamera.toLowerCase()))
      : demoStatuses;

    const data = `🧪 **Tryb demonstracyjny — Stan kamer**\n\n` +
      this.formatStatuses(filtered) + '\n\n' +
      `💡 *W aplikacji Tauri wykonywane jest prawdziwe sprawdzanie statusu kamer.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Stan kamer (demo)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: filtered.length },
    };
  }

  private formatStatuses(statuses: CameraStatus[]): string {
    if (statuses.length === 0) return '📷 Nie znaleziono kamer do sprawdzenia.\n';

    const online = statuses.filter(s => s.online).length;
    const offline = statuses.length - online;

    let out = `📷 **Stan kamer** — ${online} 🟢 online, ${offline} 🔴 offline\n\n`;

    for (const cam of statuses) {
      const icon = cam.online ? '🟢' : '🔴';
      out += `### ${icon} ${cam.name} (${cam.ip})\n`;

      if (cam.online) {
        out += `- **Status:** Online\n`;
        if (cam.latency_ms != null) out += `- **Opóźnienie:** ${cam.latency_ms}ms\n`;
        if (cam.uptime) out += `- **Uptime:** ${cam.uptime}\n`;
        if (cam.resolution) out += `- **Rozdzielczość:** ${cam.resolution}\n`;
        if (cam.fps) out += `- **FPS:** ${cam.fps}\n`;
      } else {
        out += `- **Status:** Offline\n`;
        if (cam.errorMessage) out += `- **Błąd:** ${cam.errorMessage}\n`;
      }
      out += '\n';
    }
    return out;
  }

  private extractCameraId(input: string): string | null {
    if (/wejści|front|wejsc/i.test(input)) return 'cam-front';
    if (/ogr[oó]d|garden/i.test(input)) return 'cam-garden';
    if (/salon|living/i.test(input)) return 'cam-salon';
    if (/garaż|garage|garaz/i.test(input)) return 'cam-garage';
    return null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('CameraHealthPlugin initialized'); }
  async dispose(): Promise<void> { console.log('CameraHealthPlugin disposed'); }
}

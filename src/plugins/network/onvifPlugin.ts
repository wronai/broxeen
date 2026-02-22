/**
 * @module plugins/network/onvifPlugin
 * @description ONVIF camera discovery plugin.
 * Discovers IP cameras that support the ONVIF protocol (WS-Discovery).
 *
 * Intents: "camera:discover", "camera:onvif", "network:cameras"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface OnvifCamera {
  ip: string;
  port: number;
  name?: string;
  manufacturer?: string;
  model?: string;
  firmware?: string;
  serial?: string;
  rtspUrl?: string;
  snapshotUrl?: string;
  requiresAuth: boolean;
  profiles?: string[];
}

export class OnvifPlugin implements Plugin {
  readonly id = 'network-onvif';
  readonly name = 'ONVIF Camera Discovery';
  readonly version = '1.0.0';
  readonly supportedIntents = [
    'camera:discover', 'camera:onvif', 'network:cameras',
    'camera:list', 'camera:find',
  ];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('onvif') ||
      lower.includes('pokaż kamery') ||
      lower.includes('pokaz kamery') ||
      lower.includes('znajdź kamery') ||
      lower.includes('wykryj kamery') ||
      lower.includes('kamery ip') ||
      lower.includes('kamery w sieci') ||
      lower.includes('discover cameras') ||
      lower.includes('find cameras')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    try {
      if (context.isTauri && context.tauriInvoke) {
        const cameras = await context.tauriInvoke('discover_onvif_cameras', {
          timeout: 5000,
          subnet: this.extractSubnet(input),
        }) as OnvifCamera[];
        return this.formatCameras(cameras, start);
      }

      // Browser: probe common camera ports on local subnet
      return await this.browserProbe(input, start);
    } catch (err) {
      return this.errorResult(
        `Błąd wykrywania kamer ONVIF: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private async browserProbe(input: string, start: number): Promise<PluginResult> {
    const subnet = this.extractSubnet(input) ?? '192.168.1';
    const cameraPorts = [80, 8080, 554, 8554, 8000];
    const probeIps = Array.from({ length: 20 }, (_, i) => `${subnet}.${i + 1}`);

    const found: Array<{ ip: string; port: number }> = [];

    await Promise.allSettled(
      probeIps.flatMap(ip =>
        cameraPorts.map(async port => {
          const resp = await fetch(`http://${ip}:${port}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(800),
          }).catch(() => null);
          if (resp && resp.status < 500) {
            found.push({ ip, port });
          }
        })
      )
    );

    const lines = [
      `📷 **Wykrywanie kamer ONVIF** *(tryb HTTP — pełne wykrywanie wymaga Tauri)*\n`,
      `Przeskanowano: ${probeIps.length} adresów IP`,
      `Znaleziono potencjalnych kamer: ${found.length}\n`,
    ];

    if (found.length === 0) {
      lines.push('Nie wykryto kamer w sieci.');
      lines.push('\n💡 Uruchom aplikację Tauri dla pełnego wykrywania ONVIF (WS-Discovery).');
    } else {
      found.forEach(({ ip, port }) => {
        lines.push(`📷 **${ip}:${port}** — potencjalna kamera`);
        lines.push(`   RTSP: \`rtsp://${ip}:554/stream\``);
        lines.push(`   Snapshot: \`http://${ip}:${port}/snapshot.jpg\``);
      });
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'Kamery ONVIF' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private formatCameras(cameras: OnvifCamera[], start: number): PluginResult {
    const lines = [`📷 **Wykryte kamery ONVIF**\n`];
    lines.push(`Znaleziono: ${cameras.length} kamer\n`);

    if (cameras.length === 0) {
      lines.push('Nie wykryto kamer ONVIF w sieci.');
      lines.push('\nUpewnij się że:');
      lines.push('• Kamery są podłączone do tej samej sieci');
      lines.push('• Protokół ONVIF jest włączony w kamerach');
      lines.push('• Firewall nie blokuje portów 80, 8080, 554');
    } else {
      cameras.forEach((cam: any, i: number) => {
        // Support both camelCase (TS) and snake_case (Rust) field names
        const rtspUrl = cam.rtspUrl ?? cam.rtsp_url;
        const snapshotUrl = cam.snapshotUrl ?? cam.snapshot_url;
        const requiresAuth = cam.requiresAuth ?? cam.requires_auth;
        const profiles = cam.profiles ?? [];
        lines.push(`**${i + 1}. ${cam.name ?? cam.ip}**`);
        lines.push(`   IP: \`${cam.ip}:${cam.port}\``);
        if (cam.manufacturer) lines.push(`   Producent: ${cam.manufacturer}`);
        if (cam.model) lines.push(`   Model: ${cam.model}`);
        if (cam.firmware) lines.push(`   Firmware: ${cam.firmware}`);
        if (rtspUrl) lines.push(`   RTSP: \`${rtspUrl}\``);
        if (snapshotUrl) lines.push(`   Snapshot: \`${snapshotUrl}\``);
        if (requiresAuth) lines.push(`   🔐 Wymaga hasła`);
        if (profiles.length) lines.push(`   Profile: ${profiles.join(', ')}`);
        lines.push('');
      });
      lines.push('💡 Użyj "pokaż kamerę [IP]" aby zobaczyć obraz z kamery.');
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'Kamery ONVIF' }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
        deviceCount: cameras.length,
      },
    };
  }

  private extractSubnet(input: string): string | null {
    const match = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/);
    return match ? match[1] : null;
  }

  private errorResult(msg: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'error',
      content: [{ type: 'text', data: msg }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> {}
  async dispose(): Promise<void> {}
}

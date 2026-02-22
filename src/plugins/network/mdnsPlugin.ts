/**
 * @module plugins/network/mdnsPlugin
 * @description mDNS/Bonjour discovery plugin.
 * Discovers devices advertising services via multicast DNS.
 *
 * Intents: "network:mdns", "network:discover", "network:bonjour"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface MdnsService {
  name: string;
  type: string;
  host: string;
  ip: string;
  port: number;
  txt?: Record<string, string>;
}

export class MdnsPlugin implements Plugin {
  readonly id = 'network-mdns';
  readonly name = 'mDNS Discovery';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:mdns', 'network:discover', 'network:bonjour', 'network:zeroconf'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('mdns') ||
      lower.includes('bonjour') ||
      lower.includes('zeroconf') ||
      lower.includes('odkryj urządzenia') ||
      lower.includes('urządzenia w sieci') ||
      lower.includes('local services') ||
      lower.includes('usługi lokalne')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    try {
      if (context.isTauri && context.tauriInvoke) {
        const services = await context.tauriInvoke('discover_mdns', {
          timeout: 5000,
          serviceTypes: this.extractServiceTypes(input),
        }) as MdnsService[];
        return this.formatServices(services, start);
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📡 **Wykrywanie mDNS/Bonjour**\n\nmDNS wymaga dostępu do sieci multicast, który nie jest dostępny w przeglądarce.\n\n**Uruchom aplikację Tauri** aby wykryć:\n• Drukarki (\_printer.\_tcp)\n• Kamery (\_rtsp.\_tcp, \_onvif.\_tcp)\n• Serwery NAS (\_smb.\_tcp, \_afpovertcp.\_tcp)\n• Urządzenia IoT (\_mqtt.\_tcp)\n• Serwery HTTP (\_http.\_tcp)`,
          title: 'mDNS Discovery',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(
        `Błąd wykrywania mDNS: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private formatServices(services: MdnsService[], start: number): PluginResult {
    const lines = [`📡 **Wykryte usługi mDNS/Bonjour**\n`];
    lines.push(`Znaleziono: ${services.length} usług\n`);

    if (services.length === 0) {
      lines.push('Nie wykryto usług mDNS w sieci.');
    } else {
      const grouped = this.groupByType(services);
      for (const [type, svcs] of Object.entries(grouped)) {
        lines.push(`**${this.friendlyType(type)}:**`);
        svcs.forEach(svc => {
          lines.push(`  • **${svc.name}** — \`${svc.ip}:${svc.port}\``);
          if (svc.host !== svc.ip) lines.push(`    Host: ${svc.host}`);
          if (svc.txt && Object.keys(svc.txt).length > 0) {
            const txtStr = Object.entries(svc.txt).map(([k, v]) => `${k}=${v}`).join(', ');
            lines.push(`    TXT: ${txtStr}`);
          }
        });
        lines.push('');
      }
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'mDNS Discovery' }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
        deviceCount: services.length,
      },
    };
  }

  private groupByType(services: MdnsService[]): Record<string, MdnsService[]> {
    return services.reduce((acc, svc) => {
      const key = svc.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(svc);
      return acc;
    }, {} as Record<string, MdnsService[]>);
  }

  private friendlyType(type: string): string {
    const map: Record<string, string> = {
      '_http._tcp': '🌐 Serwery HTTP',
      '_https._tcp': '🔒 Serwery HTTPS',
      '_rtsp._tcp': '📷 Kamery RTSP',
      '_onvif._tcp': '📷 Kamery ONVIF',
      '_printer._tcp': '🖨️ Drukarki',
      '_smb._tcp': '💾 Serwery SMB/NAS',
      '_mqtt._tcp': '📡 Brokerzy MQTT',
      '_ssh._tcp': '🔑 Serwery SSH',
      '_ftp._tcp': '📁 Serwery FTP',
    };
    return map[type] ?? `📦 ${type}`;
  }

  private extractServiceTypes(input: string): string[] {
    const lower = input.toLowerCase();
    const types: string[] = [];
    if (lower.includes('kamer') || lower.includes('rtsp')) types.push('_rtsp._tcp', '_onvif._tcp');
    if (lower.includes('drukark')) types.push('_printer._tcp');
    if (lower.includes('nas') || lower.includes('smb')) types.push('_smb._tcp');
    if (lower.includes('mqtt')) types.push('_mqtt._tcp');
    if (lower.includes('http')) types.push('_http._tcp');
    return types;
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

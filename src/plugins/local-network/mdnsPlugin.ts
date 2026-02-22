/**
 * mDNS Plugin - discovers services via multicast DNS (Bonjour/Avahi)
 * Scope: local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface MdnsService {
  name: string;
  type: string;
  host: string;
  port: number;
  ip?: string;
  txt?: Record<string, string>;
}

export class MdnsPlugin implements Plugin {
  readonly id = 'network-mdns';
  readonly name = 'mDNS Discovery';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:mdns', 'network:bonjour', 'network:avahi'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /mdns/i.test(lower) ||
      /bonjour/i.test(lower) ||
      /avahi/i.test(lower) ||
      /odkryj.*usługi/i.test(lower) ||
      /odkryj.*uslugi/i.test(lower) ||
      /discover.*services/i.test(lower) ||
      /znajdź.*usługi/i.test(lower) ||
      /znajdz.*uslugi/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const serviceType = this.extractServiceType(input);

    if (context.isTauri && context.tauriInvoke) {
      try {
        const services = await context.tauriInvoke('network_mdns_discover', {
          serviceType: serviceType || '_services._dns-sd._udp.local.',
          timeout: 5000,
        }) as MdnsService[];

        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: this.formatServices(services, serviceType), title: 'mDNS Discovery' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, serviceCount: services.length },
        };
      } catch (error) {
        return this.errorResult(`Błąd mDNS: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    const demoServices: MdnsService[] = [
      { name: 'Kamera Salon', type: '_rtsp._tcp', host: 'cam-salon.local', port: 554, ip: '192.168.1.100' },
      { name: 'Kamera Wejście', type: '_rtsp._tcp', host: 'cam-front.local', port: 554, ip: '192.168.1.101' },
      { name: 'NAS Synology', type: '_http._tcp', host: 'nas.local', port: 5000, ip: '192.168.1.50' },
      { name: 'Drukarki HP', type: '_ipp._tcp', host: 'printer.local', port: 631, ip: '192.168.1.30' },
      { name: 'Home Assistant', type: '_http._tcp', host: 'homeassistant.local', port: 8123, ip: '192.168.1.10' },
      { name: 'Mosquitto MQTT', type: '_mqtt._tcp', host: 'mqtt.local', port: 1883, ip: '192.168.1.10' },
    ];

    const filtered = serviceType
      ? demoServices.filter(s => s.type.includes(serviceType))
      : demoServices;

    const data = `🧪 **Tryb demonstracyjny — mDNS Discovery**\n\n` +
      this.formatServices(filtered, serviceType) + '\n\n' +
      `💡 *W aplikacji Tauri wykonywane jest prawdziwe odkrywanie usług mDNS/Bonjour.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'mDNS Discovery (demo)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, serviceCount: filtered.length },
    };
  }

  private formatServices(services: MdnsService[], serviceType?: string | null): string {
    let out = `📡 **Usługi mDNS${serviceType ? ` (${serviceType})` : ''}** — ${services.length} znalezionych\n\n`;

    if (services.length === 0) {
      out += 'Nie znaleziono usług mDNS w sieci.\n';
      return out;
    }

    out += '| Nazwa | Typ | Host | Port | IP |\n|-------|-----|------|------|----|\n';
    for (const s of services) {
      out += `| ${s.name} | ${s.type} | ${s.host} | ${s.port} | ${s.ip || '—'} |\n`;
    }
    return out;
  }

  private extractServiceType(input: string): string | null {
    if (/rtsp|kamer/i.test(input)) return '_rtsp._tcp';
    if (/http|web/i.test(input)) return '_http._tcp';
    if (/mqtt|iot/i.test(input)) return '_mqtt._tcp';
    if (/printer|druk/i.test(input)) return '_ipp._tcp';
    if (/ssh/i.test(input)) return '_ssh._tcp';
    return null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('MdnsPlugin initialized'); }
  async dispose(): Promise<void> { console.log('MdnsPlugin disposed'); }
}

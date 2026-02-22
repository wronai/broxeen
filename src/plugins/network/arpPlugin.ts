/**
 * @module plugins/network/arpPlugin
 * @description ARP scan plugin — discovers all live hosts in LAN via ARP.
 *
 * Intents: "network:arp", "network:hosts", "network:lan"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface ArpHost {
  ip: string;
  mac: string;
  vendor?: string;
  hostname?: string;
  responseTime?: number;
}

export class ArpPlugin implements Plugin {
  readonly id = 'network-arp';
  readonly name = 'ARP Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:arp', 'network:hosts', 'network:lan', 'network:devices'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('arp') ||
      lower.includes('wszystkie urządzenia') ||
      lower.includes('hosty w sieci') ||
      lower.includes('urządzenia lan') ||
      lower.includes('kto jest w sieci') ||
      lower.includes('lista urządzeń') ||
      lower.includes('skanuj lan') ||
      lower.includes('scan lan')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const subnet = this.extractSubnet(input);

    try {
      if (context.isTauri && context.tauriInvoke) {
        const hosts = await context.tauriInvoke('arp_scan', {
          subnet: subnet ?? 'auto',
          timeout: 3000,
        }) as ArpHost[];
        return this.formatHosts(hosts, subnet, start);
      }

      // Browser fallback: ping sweep via HTTP
      const targetSubnet = subnet ?? '192.168.1';
      const probeIps = Array.from({ length: 30 }, (_, i) => `${targetSubnet}.${i + 1}`);

      const alive: string[] = [];
      await Promise.allSettled(
        probeIps.map(async ip => {
          const resp = await fetch(`http://${ip}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(600),
          }).catch(() => null);
          if (resp) alive.push(ip);
        })
      );

      const lines = [
        `🔍 **Skanowanie ARP: ${targetSubnet}.0/24** *(tryb HTTP)*\n`,
        `Przeskanowano: ${probeIps.length} adresów`,
        `Aktywne hosty: ${alive.length}\n`,
      ];

      if (alive.length === 0) {
        lines.push('Nie wykryto aktywnych hostów (ograniczenia przeglądarki).');
        lines.push('\n💡 Uruchom aplikację Tauri dla pełnego skanowania ARP z adresami MAC.');
      } else {
        alive.forEach(ip => lines.push(`✅ ${ip}`));
        lines.push('\n💡 Uruchom Tauri dla adresów MAC i nazw producentów.');
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n'), title: `ARP: ${targetSubnet}.0/24` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(
        `Błąd skanowania ARP: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private formatHosts(hosts: ArpHost[], subnet: string | null, start: number): PluginResult {
    const lines = [`🔍 **Skanowanie ARP: ${subnet ?? 'auto'}.0/24**\n`];
    lines.push(`Znaleziono hostów: ${hosts.length}\n`);

    if (hosts.length === 0) {
      lines.push('Nie wykryto aktywnych hostów w sieci.');
    } else {
      hosts.forEach((host, i) => {
        lines.push(`**${i + 1}. ${host.ip}**`);
        lines.push(`   MAC: \`${host.mac}\``);
        if (host.vendor) lines.push(`   Producent: ${host.vendor}`);
        if (host.hostname) lines.push(`   Hostname: ${host.hostname}`);
        if (host.responseTime !== undefined) lines.push(`   RTT: ${host.responseTime}ms`);
        lines.push('');
      });
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'ARP Scan' }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
        deviceCount: hosts.length,
      },
    };
  }

  private extractSubnet(input: string): string | null {
    const match = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/);
    if (match) return match[1];
    const subnetMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    return subnetMatch ? subnetMatch[1] : null;
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

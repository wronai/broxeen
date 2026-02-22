/**
 * ARP Plugin - discovers devices via ARP table
 * Scope: local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface ArpEntry {
  ip: string;
  mac: string;
  vendor?: string;
  interface?: string;
}

export class ArpPlugin implements Plugin {
  readonly id = 'network-arp';
  readonly name = 'ARP Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:arp', 'network:mac'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /arp/i.test(lower) ||
      /tablica.*arp/i.test(lower) ||
      /adresy.*mac/i.test(lower) ||
      /mac.*address/i.test(lower) ||
      /pokaż.*urządzenia.*mac/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    if (context.isTauri && context.tauriInvoke) {
      try {
        const entries = await context.tauriInvoke('network_arp_scan', {}) as ArpEntry[];
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: this.formatEntries(entries), title: 'Tablica ARP' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: entries.length },
        };
      } catch (error) {
        return this.errorResult(`Błąd ARP: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    const demoEntries: ArpEntry[] = [
      { ip: '192.168.1.1', mac: 'AA:BB:CC:DD:EE:01', vendor: 'TP-Link', interface: 'eth0' },
      { ip: '192.168.1.100', mac: 'AA:BB:CC:DD:EE:02', vendor: 'Hikvision', interface: 'eth0' },
      { ip: '192.168.1.101', mac: 'AA:BB:CC:DD:EE:03', vendor: 'Dahua', interface: 'eth0' },
      { ip: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:04', vendor: 'Raspberry Pi', interface: 'wlan0' },
      { ip: '192.168.1.200', mac: 'AA:BB:CC:DD:EE:05', vendor: 'Samsung', interface: 'wlan0' },
    ];

    const data = `🧪 **Tryb demonstracyjny — Tablica ARP**\n\n` +
      this.formatEntries(demoEntries) + '\n\n' +
      `💡 *W aplikacji Tauri odczytywana jest prawdziwa tablica ARP systemu.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Tablica ARP (demo)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, deviceCount: demoEntries.length },
    };
  }

  private formatEntries(entries: ArpEntry[]): string {
    if (entries.length === 0) return 'Tablica ARP jest pusta.\n';

    let out = `📋 **Tablica ARP** — ${entries.length} wpisów\n\n`;
    out += '| IP | MAC | Producent | Interfejs |\n|----|----|-----------|----------|\n';
    for (const e of entries) {
      out += `| ${e.ip} | ${e.mac} | ${e.vendor || '—'} | ${e.interface || '—'} |\n`;
    }
    return out;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('ArpPlugin initialized'); }
  async dispose(): Promise<void> { console.log('ArpPlugin disposed'); }
}

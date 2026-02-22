/**
 * Port Scan Plugin - scans open ports on a target host
 * Scope: local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

const COMMON_PORTS: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB',
  554: 'RTSP', 993: 'IMAPS', 995: 'POP3S', 1080: 'SOCKS',
  1433: 'MSSQL', 1883: 'MQTT', 3306: 'MySQL', 3389: 'RDP',
  5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt', 8554: 'RTSP-Alt', 8883: 'MQTT-TLS',
  9001: 'MQTT-WS', 27017: 'MongoDB',
};

export class PortScanPlugin implements Plugin {
  readonly id = 'network-port-scan';
  readonly name = 'Port Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:port-scan', 'network:ports'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /skanuj.*port/i.test(lower) ||
      /otwarte.*port/i.test(lower) ||
      /sprawdź.*port/i.test(lower) ||
      /scan.*port/i.test(lower) ||
      /open.*port/i.test(lower) ||
      /jakie.*porty/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const target = this.extractTarget(input);

    if (!target) {
      return this.errorResult('Podaj adres IP, np. "skanuj porty 192.168.1.1"', start);
    }

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('network_port_scan', {
          host: target,
          ports: Object.keys(COMMON_PORTS).map(Number),
        }) as { open_ports: number[]; scan_duration_ms: number };

        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: this.formatResults(target, result.open_ports, result.scan_duration_ms) }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (error) {
        return this.errorResult(`Błąd skanowania: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo mode
    const demoPorts = [22, 80, 443, 554, 8080].filter(() => Math.random() > 0.3);
    const data = `🧪 **Tryb demonstracyjny — Skanowanie portów: ${target}**\n\n` +
      this.formatResults(target, demoPorts, 1200) + '\n\n' +
      `💡 *W aplikacji Tauri wykonywane jest prawdziwe skanowanie TCP.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Porty: ${target}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private formatResults(target: string, openPorts: number[], durationMs: number): string {
    let out = `🔍 **Skanowanie portów: ${target}**\n\n`;
    out += `Czas skanowania: ${durationMs}ms\n`;
    out += `Otwartych portów: ${openPorts.length}\n\n`;

    if (openPorts.length === 0) {
      out += 'Nie znaleziono otwartych portów.\n';
    } else {
      out += '| Port | Usługa | Status |\n|------|--------|--------|\n';
      for (const port of openPorts.sort((a, b) => a - b)) {
        const service = COMMON_PORTS[port] || 'Nieznana';
        out += `| ${port} | ${service} | 🟢 Otwarty |\n`;
      }
    }
    return out;
  }

  private extractTarget(input: string): string | null {
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) return ipMatch[0];
    const hostMatch = input.match(/(?:skanuj|scan|sprawdź|check)\s+(?:porty?\s+)?(\S+)/i);
    if (hostMatch) return hostMatch[1];
    return null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('PortScanPlugin initialized'); }
  async dispose(): Promise<void> { console.log('PortScanPlugin disposed'); }
}

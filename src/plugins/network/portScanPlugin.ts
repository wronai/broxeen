/**
 * @module plugins/network/portScanPlugin
 * @description Port scan plugin — checks open ports on a host.
 *
 * Intents: "network:port-scan", "network:ports"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

const COMMON_PORTS: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS',
  554: 'RTSP', 1883: 'MQTT', 3306: 'MySQL', 5432: 'PostgreSQL',
  6379: 'Redis', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 8554: 'RTSP-Alt',
  9001: 'MQTT-WS', 9200: 'Elasticsearch', 27017: 'MongoDB',
};

export class PortScanPlugin implements Plugin {
  readonly id = 'network-port-scan';
  readonly name = 'Port Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:port-scan', 'network:ports', 'network:services'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('skanuj porty') ||
      lower.includes('otwarte porty') ||
      lower.includes('port scan') ||
      lower.includes('sprawdź porty') ||
      lower.includes('jakie porty') ||
      lower.includes('usługi na')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const target = this.extractTarget(input);
    const ports = this.extractPorts(input);

    if (!target) {
      return this.errorResult('Podaj adres IP lub hostname do skanowania portów.', start);
    }

    try {
      if (context.isTauri && context.tauriInvoke) {
        const result = await context.tauriInvoke('scan_ports', {
          host: target,
          ports: ports.length > 0 ? ports : Object.keys(COMMON_PORTS).map(Number),
          timeout: 2000,
        }) as PortScanResult;
        return this.formatResult(target, result, start);
      }

      // Browser fallback: try HTTP probes on common web ports
      const webPorts = [80, 443, 8080, 8443, 8554, 554];
      const results = await Promise.allSettled(
        webPorts.map(async (port) => {
          const t0 = Date.now();
          const resp = await fetch(`http://${target}:${port}`, {
            method: 'HEAD',
            signal: AbortSignal.timeout(1500),
          });
          return { port, open: resp.ok || resp.status < 500, rtt: Date.now() - t0 };
        })
      );

      const openPorts = results
        .filter(r => r.status === 'fulfilled' && r.value.open)
        .map(r => (r as PromiseFulfilledResult<{ port: number; open: boolean; rtt: number }>).value);

      const lines = [`🔍 **Skanowanie portów: ${target}** *(tryb HTTP)*\n`];
      if (openPorts.length === 0) {
        lines.push('Nie wykryto otwartych portów HTTP (ograniczenia przeglądarki).');
        lines.push('Użyj aplikacji Tauri dla pełnego skanowania TCP.');
      } else {
        openPorts.forEach(({ port, rtt }) => {
          lines.push(`✅ Port ${port} (${COMMON_PORTS[port] ?? 'nieznany'}) — ${rtt}ms`);
        });
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n'), title: `Porty: ${target}` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`Błąd skanowania portów ${target}: ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  private extractTarget(input: string): string | null {
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) return ipMatch[0];
    const hostMatch = input.match(/\b([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/);
    return hostMatch ? hostMatch[0] : null;
  }

  private extractPorts(input: string): number[] {
    const portMatches = input.match(/\b(\d{1,5})\b/g);
    if (!portMatches) return [];
    return portMatches
      .map(Number)
      .filter(p => p > 0 && p <= 65535 && !input.match(new RegExp(`(?:${p})\\.(?:${p})`)));
  }

  private formatResult(target: string, result: PortScanResult, start: number): PluginResult {
    const lines = [`🔍 **Skanowanie portów: ${target}**\n`];
    lines.push(`Przeskanowano: ${result.scanned} portów`);
    lines.push(`Otwarte: ${result.open.length}\n`);

    if (result.open.length === 0) {
      lines.push('Nie znaleziono otwartych portów.');
    } else {
      lines.push('**Otwarte porty:**');
      result.open.forEach(({ port, rtt, banner }) => {
        const service = COMMON_PORTS[port] ?? 'nieznany';
        let line = `✅ **${port}** (${service})`;
        if (rtt !== undefined) line += ` — ${rtt}ms`;
        if (banner) line += `\n   Banner: \`${banner.substring(0, 80)}\``;
        lines.push(line);
      });
    }

    if (result.filtered && result.filtered.length > 0) {
      lines.push(`\n⚠️ Filtrowane porty: ${result.filtered.slice(0, 10).join(', ')}${result.filtered.length > 10 ? '...' : ''}`);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: `Porty: ${target}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
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

interface PortScanResult {
  scanned: number;
  open: Array<{ port: number; rtt?: number; banner?: string }>;
  filtered?: number[];
}

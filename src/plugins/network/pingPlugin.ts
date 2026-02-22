/**
 * @module plugins/network/pingPlugin
 * @description Ping plugin — checks reachability of hosts via Tauri or HTTP fallback.
 *
 * Intents: "network:ping", "network:check"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class PingPlugin implements Plugin {
  readonly id = 'network-ping';
  readonly name = 'Network Ping';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:ping', 'network:check', 'network:reachable'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('ping') ||
      lower.includes('sprawdź dostępność') ||
      lower.includes('czy działa') ||
      lower.includes('czy jest dostępny') ||
      lower.includes('sprawdź host') ||
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(input)
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const target = this.extractTarget(input);

    if (!target) {
      return this.errorResult('Podaj adres IP lub hostname do sprawdzenia.', start);
    }

    try {
      if (context.isTauri && context.tauriInvoke) {
        const result = await context.tauriInvoke('ping_host', { host: target, count: 3 }) as PingResult;
        return this.formatResult(target, result, start);
      }

      // Browser fallback: HTTP HEAD request
      const t0 = Date.now();
      const resp = await fetch(`http://${target}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      const rtt = Date.now() - t0;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: resp
            ? `✅ **${target}** jest dostępny\nCzas odpowiedzi HTTP: ${rtt}ms\n*(tryb przeglądarki — pełny ping wymaga Tauri)*`
            : `❌ **${target}** nie odpowiada na HTTP\n*(tryb przeglądarki — pełny ping wymaga Tauri)*`,
          title: `Ping: ${target}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`Błąd ping ${target}: ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  private extractTarget(input: string): string | null {
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) return ipMatch[0];
    const hostMatch = input.match(/\b([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/);
    if (hostMatch) return hostMatch[0];
    const words = input.split(/\s+/);
    const last = words[words.length - 1];
    if (last && !last.match(/^(ping|sprawdź|czy|działa|dostępny|host)$/i)) return last;
    return null;
  }

  private formatResult(target: string, result: PingResult, start: number): PluginResult {
    const lines: string[] = [`📡 **Ping: ${target}**\n`];
    if (result.reachable) {
      lines.push(`✅ Host dostępny`);
      lines.push(`Wysłano: ${result.sent} pakietów`);
      lines.push(`Odebrano: ${result.received} pakietów`);
      lines.push(`Utracono: ${result.lost} (${result.lossPercent}%)`);
      if (result.avgRtt !== undefined) lines.push(`Średni RTT: ${result.avgRtt}ms`);
      if (result.minRtt !== undefined) lines.push(`Min RTT: ${result.minRtt}ms`);
      if (result.maxRtt !== undefined) lines.push(`Max RTT: ${result.maxRtt}ms`);
    } else {
      lines.push(`❌ Host niedostępny`);
      lines.push(`Wysłano: ${result.sent} pakietów, odebrano: 0`);
    }
    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: `Ping: ${target}` }],
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

interface PingResult {
  reachable: boolean;
  sent: number;
  received: number;
  lost: number;
  lossPercent: number;
  avgRtt?: number;
  minRtt?: number;
  maxRtt?: number;
}

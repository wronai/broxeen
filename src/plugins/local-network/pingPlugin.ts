/**
 * Ping Plugin - checks host reachability via ICMP ping
 * Scope: local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class PingPlugin implements Plugin {
  readonly id = 'network-ping';
  readonly name = 'Network Ping';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:ping', 'network:check'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /ping\s/i.test(lower) ||
      /sprawdź.*host/i.test(lower) ||
      /czy.*działa/i.test(lower) ||
      /czy.*odpowiada/i.test(lower) ||
      /check.*host/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const target = this.extractTarget(input);

    if (!target) {
      return this.errorResult('Podaj adres IP lub hostname, np. "ping 192.168.1.1"', start);
    }

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('network_ping', { host: target }) as {
          reachable: boolean;
          latency_ms: number;
          ttl?: number;
        };

        const status = result.reachable ? '🟢 Dostępny' : '🔴 Niedostępny';
        const data = `**Ping: ${target}**\n\n` +
          `Status: ${status}\n` +
          (result.reachable ? `Opóźnienie: ${result.latency_ms}ms\n` : '') +
          (result.ttl ? `TTL: ${result.ttl}\n` : '');

        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data, title: `Ping ${target}` }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (error) {
        return this.errorResult(`Błąd ping: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo mode
    const latency = Math.floor(Math.random() * 50) + 1;
    const data = `🧪 **Tryb demonstracyjny — Ping: ${target}**\n\n` +
      `Status: 🟢 Dostępny (symulacja)\n` +
      `Opóźnienie: ${latency}ms\n` +
      `TTL: 64\n\n` +
      `💡 *W aplikacji Tauri wykonywany jest prawdziwy ping ICMP.*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Ping ${target}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private extractTarget(input: string): string | null {
    const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    if (ipMatch) return ipMatch[0];

    const hostMatch = input.match(/ping\s+(\S+)/i);
    if (hostMatch) return hostMatch[1];

    const checkMatch = input.match(/(?:sprawdź|check)\s+(\S+)/i);
    if (checkMatch) return checkMatch[1];

    return null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> {
    console.log('PingPlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('PingPlugin disposed');
  }
}

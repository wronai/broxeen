/**
 * @module plugins/network/wakeOnLanPlugin
 * @description Wake-on-LAN Plugin - sends WoL magic packets to wake devices
 *
 * Intents: "network:wol", "network:wake"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class WakeOnLanPlugin implements Plugin {
  readonly id = 'network-wol';
  readonly name = 'Wake-on-LAN';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:wol', 'network:wake'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /wake.*on.*lan/i.test(lower) ||
      /wol\s/i.test(lower) ||
      /obudź.*urządzenie/i.test(lower) ||
      /obudz.*urzadzenie/i.test(lower) ||
      /włącz.*komputer/i.test(lower) ||
      /wlacz.*komputer/i.test(lower) ||
      /wybudź/i.test(lower) ||
      /wybudz/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const mac = this.extractMac(input);

    if (!mac) {
      return this.errorResult(
        'Podaj adres MAC urządzenia, np. "obudź urządzenie AA:BB:CC:DD:EE:FF"',
        start,
      );
    }

    if (context.isTauri && context.tauriInvoke) {
      try {
        await context.tauriInvoke('network_wol', { mac });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `✅ **Wake-on-LAN wysłany**\n\nAdres MAC: \`${mac}\`\nPakiet magic wysłany pomyślnie.\n\n💡 *Urządzenie powinno się uruchomić w ciągu 30 sekund.*`,
            title: 'Wake-on-LAN',
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (error) {
        return this.errorResult(`Błąd WoL: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `🧪 **Tryb demonstracyjny — Wake-on-LAN**\n\nAdres MAC: \`${mac}\`\n\nW trybie przeglądarki wysłanie pakietu WoL nie jest możliwe.\nW aplikacji Tauri pakiet magic zostanie wysłany na adres broadcast sieci lokalnej.\n\n💡 *Uruchom aplikację Tauri, aby wysyłać prawdziwe pakiety WoL.*`,
        title: 'Wake-on-LAN (demo)',
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private extractMac(input: string): string | null {
    const macMatch = input.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
    return macMatch ? macMatch[0] : null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> {}
  async dispose(): Promise<void> {}
}

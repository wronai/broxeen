/**
 * Protocol Bridge Plugin — enables communication between protocols and text/voice
 *
 * Bridges:
 *   MQTT ↔ text ↔ voice
 *   REST API ↔ text ↔ voice
 *
 * Commands (via chat / voice):
 *   "bridge mqtt home/sensors/temperature"          → read last MQTT value as text
 *   "wyślij mqtt home/lights/living on"             → publish to MQTT topic
 *   "bridge rest GET https://api.example.com/data"  → fetch REST endpoint
 *   "wyślij rest POST https://api.example.com/cmd"  → POST to REST endpoint
 *   "dodaj bridge mqtt ws://broker:9001 home/#"     → configure new MQTT bridge
 *   "dodaj bridge rest https://api.example.com"     → configure new REST bridge
 *   "lista bridge"                                  → list configured bridges
 *   "usuń bridge mqtt-1"                            → remove a bridge
 *   "bridge status"                                 → show bridge connection status
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

// ─── Types ──────────────────────────────────────────────────

export type BridgeProtocol = 'mqtt' | 'rest';
export type BridgeDirection = 'in' | 'out' | 'bidirectional';

export interface BridgeEndpoint {
  id: string;
  protocol: BridgeProtocol;
  name: string;
  url: string;
  /** MQTT topics or REST paths */
  targets: string[];
  direction: BridgeDirection;
  active: boolean;
  createdAt: number;
  lastActivity?: number;
  messageCount: number;
}

export interface BridgeMessage {
  timestamp: number;
  bridgeId: string;
  protocol: BridgeProtocol;
  direction: 'received' | 'sent';
  target: string;
  payload: string;
  source: 'text' | 'voice' | 'api';
}

interface MqttCacheEntry {
  topic: string;
  payload: string;
  timestamp: number;
}

// ─── Plugin ─────────────────────────────────────────────────

export class ProtocolBridgePlugin implements Plugin {
  readonly id = 'protocol-bridge';
  readonly name = 'Protocol Bridge';
  readonly version = '1.0.0';
  readonly supportedIntents = [
    'bridge:read', 'bridge:send', 'bridge:add',
    'bridge:remove', 'bridge:list', 'bridge:status',
  ];

  private endpoints = new Map<string, BridgeEndpoint>();
  private history: BridgeMessage[] = [];
  private mqttCache = new Map<string, MqttCacheEntry>();

  /** Max history entries kept in memory */
  private static readonly MAX_HISTORY = 200;

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /bridge/i.test(lower) ||
      /most.*protokół|most.*protokol/i.test(lower) ||
      /mqtt.*text|mqtt.*tekst|mqtt.*głos|mqtt.*glos|mqtt.*voice/i.test(lower) ||
      /rest.*text|rest.*tekst|rest.*głos|rest.*glos|rest.*voice/i.test(lower) ||
      /wyślij.*mqtt|wyslij.*mqtt|wyślij.*rest|wyslij.*rest/i.test(lower) ||
      /odczytaj.*mqtt|odczytaj.*rest|pobierz.*rest/i.test(lower) ||
      /dodaj.*bridge|usuń.*bridge|usun.*bridge/i.test(lower) ||
      /protokół.*most|protokol.*most/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    // ── Remove bridge ────────────────────────────────────
    if (/usuń.*bridge|usun.*bridge|remove.*bridge|delete.*bridge/i.test(lower)) {
      return this.handleRemove(input, start);
    }

    // ── List bridges ─────────────────────────────────────
    if (/lista.*bridge|list.*bridge|bridge.*lista|bridge.*list|pokaż.*bridge|pokaz.*bridge/i.test(lower)) {
      return this.handleList(start);
    }

    // ── Bridge status ────────────────────────────────────
    if (/bridge.*status|status.*bridge|stan.*bridge/i.test(lower)) {
      return this.handleStatus(start);
    }

    // ── Add new bridge endpoint ──────────────────────────
    if (/dodaj.*bridge|add.*bridge|nowy.*bridge|new.*bridge|konfiguruj.*bridge|configure.*bridge/i.test(lower)) {
      return this.handleAdd(input, start);
    }

    // ── Send to protocol ─────────────────────────────────
    if (/wyślij|wyslij|send|publish|opublikuj|post\s/i.test(lower)) {
      return this.handleSend(input, context, start);
    }

    // ── Read from protocol (default) ─────────────────────
    return this.handleRead(input, context, start);
  }

  // ─── Add Bridge ─────────────────────────────────────────

  private handleAdd(input: string, start: number): PluginResult {
    const lower = input.toLowerCase();

    // Detect protocol
    let protocol: BridgeProtocol;
    if (/mqtt/i.test(lower)) {
      protocol = 'mqtt';
    } else if (/rest|api|http/i.test(lower)) {
      protocol = 'rest';
    } else {
      return this.errorResult(
        '❌ Podaj protokół mostu: `mqtt` lub `rest`.\n\n' +
        'Przykłady:\n' +
        '- "dodaj bridge mqtt ws://broker:9001 home/sensors/#"\n' +
        '- "dodaj bridge rest https://api.example.com/sensors"',
        start,
      );
    }

    // Extract URL
    const urlMatch = input.match(/(wss?:\/\/[^\s]+|https?:\/\/[^\s]+|mqtts?:\/\/[^\s]+)/i);
    if (!urlMatch) {
      return this.errorResult(
        `❌ Brak adresu URL dla mostu ${protocol.toUpperCase()}.\n\n` +
        (protocol === 'mqtt'
          ? 'Przykład: "dodaj bridge mqtt ws://192.168.1.10:9001 home/sensors/#"'
          : 'Przykład: "dodaj bridge rest https://api.example.com/sensors"'),
        start,
      );
    }
    const url = urlMatch[1];

    // Extract targets (MQTT topics or REST paths after URL)
    const afterUrl = input.slice(input.indexOf(url) + url.length).trim();
    const targets = afterUrl
      ? afterUrl.split(/\s+/).filter(t => t.length > 0 && !t.startsWith('-'))
      : protocol === 'mqtt' ? ['#'] : ['/'];

    const id = `${protocol}-${Date.now().toString(36)}`;
    const endpoint: BridgeEndpoint = {
      id,
      protocol,
      name: `${protocol.toUpperCase()} Bridge`,
      url,
      targets,
      direction: 'bidirectional',
      active: true,
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.endpoints.set(id, endpoint);

    const targetsStr = targets.map(t => `\`${t}\``).join(', ');
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `✅ **Most protokołu dodany**\n\n` +
          `📌 **ID:** \`${id}\`\n` +
          `🔌 **Protokół:** ${protocol.toUpperCase()}\n` +
          `🌐 **URL:** ${url}\n` +
          `📡 **Cele:** ${targetsStr}\n` +
          `↔️ **Kierunek:** dwukierunkowy\n\n` +
          `Teraz możesz:\n` +
          (protocol === 'mqtt'
            ? `- "bridge mqtt ${targets[0]}" — odczytaj dane\n` +
              `- "wyślij mqtt ${targets[0]} wartość" — wyślij wiadomość\n`
            : `- "bridge rest GET ${url}${targets[0]}" — pobierz dane\n` +
              `- "wyślij rest POST ${url}${targets[0]} {dane}" — wyślij dane\n`) +
          `- "lista bridge" — pokaż wszystkie mosty\n` +
          `- "usuń bridge ${id}" — usuń most`,
        title: `Bridge: ${id}`,
        summary: `Dodano most ${protocol.toUpperCase()} na ${url}`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ─── Remove Bridge ──────────────────────────────────────

  private handleRemove(input: string, start: number): PluginResult {
    const idMatch = input.match(/(mqtt-[a-z0-9]+|rest-[a-z0-9]+)/i);

    if (idMatch && this.endpoints.has(idMatch[1])) {
      const ep = this.endpoints.get(idMatch[1])!;
      this.endpoints.delete(idMatch[1]);
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `🗑️ Most **${ep.protocol.toUpperCase()}** (\`${ep.id}\`) został usunięty.\n` +
            `URL: ${ep.url}\nWiadomości: ${ep.messageCount}`,
          summary: `Usunięto most ${ep.id}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    if (this.endpoints.size === 0) {
      return this.errorResult('Brak skonfigurowanych mostów do usunięcia.', start);
    }

    const ids = Array.from(this.endpoints.values()).map(e => `- \`${e.id}\` (${e.protocol.toUpperCase()} → ${e.url})`).join('\n');
    return this.errorResult(`Nie znaleziono mostu. Dostępne:\n${ids}`, start);
  }

  // ─── List Bridges ───────────────────────────────────────

  private handleList(start: number): PluginResult {
    if (this.endpoints.size === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: '📋 **Brak skonfigurowanych mostów protokołów**\n\n' +
            'Dodaj most komendą:\n' +
            '- "dodaj bridge mqtt ws://broker:9001 home/sensors/#"\n' +
            '- "dodaj bridge rest https://api.example.com/data"\n\n' +
            'Lub użyj bezpośrednio:\n' +
            '- "bridge mqtt home/sensors/temperature" — odczytaj z MQTT\n' +
            '- "bridge rest GET https://api.example.com/status" — odczytaj z REST\n' +
            '- "wyślij mqtt home/lights/living on" — wyślij do MQTT\n' +
            '- "wyślij rest POST https://api.example.com/cmd {action: on}" — wyślij REST',
          summary: 'Brak mostów — pokaż pomoc',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    let data = `📋 **Mosty protokołów** — ${this.endpoints.size}\n\n`;

    for (const ep of this.endpoints.values()) {
      const icon = ep.active ? '🟢' : '🔴';
      const age = ep.lastActivity
        ? `${Math.round((Date.now() - ep.lastActivity) / 1000)}s temu`
        : 'brak';

      data += `### ${icon} ${ep.protocol.toUpperCase()} — \`${ep.id}\`\n`;
      data += `- **URL:** ${ep.url}\n`;
      data += `- **Cele:** ${ep.targets.map(t => `\`${t}\``).join(', ')}\n`;
      data += `- **Kierunek:** ${this.directionLabel(ep.direction)}\n`;
      data += `- **Wiadomości:** ${ep.messageCount}\n`;
      data += `- **Ostatnia aktywność:** ${age}\n\n`;
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Mosty protokołów', summary: `${this.endpoints.size} mostów aktywnych` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ─── Bridge Status ──────────────────────────────────────

  private handleStatus(start: number): PluginResult {
    const mqttBridges = Array.from(this.endpoints.values()).filter(e => e.protocol === 'mqtt');
    const restBridges = Array.from(this.endpoints.values()).filter(e => e.protocol === 'rest');
    const totalMessages = Array.from(this.endpoints.values()).reduce((sum, e) => sum + e.messageCount, 0);

    let data = `📊 **Status mostów protokołów**\n\n`;
    data += `- **MQTT mostów:** ${mqttBridges.length}\n`;
    data += `- **REST mostów:** ${restBridges.length}\n`;
    data += `- **Łączna liczba wiadomości:** ${totalMessages}\n`;
    data += `- **Historia:** ${this.history.length} wpisów\n`;
    data += `- **Cache MQTT:** ${this.mqttCache.size} tematów\n\n`;

    if (this.history.length > 0) {
      data += `### Ostatnie wiadomości\n\n`;
      const recent = this.history.slice(-5).reverse();
      for (const msg of recent) {
        const time = new Date(msg.timestamp).toLocaleTimeString('pl-PL');
        const dir = msg.direction === 'sent' ? '📤' : '📥';
        data += `${dir} **${time}** [${msg.protocol.toUpperCase()}] ${msg.target}: ${msg.payload.slice(0, 80)}\n`;
      }
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Status mostów', summary: `${this.endpoints.size} mostów, ${totalMessages} wiadomości` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ─── Send (text/voice → protocol) ──────────────────────

  private async handleSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const lower = input.toLowerCase();

    if (/mqtt/i.test(lower)) {
      return this.handleMqttSend(input, context, start);
    }
    if (/rest|api|http/i.test(lower)) {
      return this.handleRestSend(input, context, start);
    }

    return this.errorResult(
      '❌ Podaj protokół: `mqtt` lub `rest`.\n\n' +
      'Przykłady:\n' +
      '- "wyślij mqtt home/lights/living on"\n' +
      '- "wyślij rest POST https://api.example.com/cmd {action: on}"',
      start,
    );
  }

  private async handleMqttSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Parse: "wyślij mqtt <topic> <payload>"
    const match = input.match(/mqtt\s+([^\s]+)\s+(.*)/i);
    if (!match) {
      return this.errorResult(
        '❌ Format: "wyślij mqtt <temat> <wiadomość>"\n' +
        'Przykład: "wyślij mqtt home/lights/living on"',
        start,
      );
    }

    const topic = match[1];
    const payload = match[2].trim();

    // Try Tauri backend MQTT publish
    if (context.isTauri && context.tauriInvoke) {
      try {
        await context.tauriInvoke('mqtt_publish', { topic, payload });
      } catch (err) {
        console.warn('[ProtocolBridge] Tauri mqtt_publish failed, using cache fallback:', err);
      }
    }

    // Try PluginContext MQTT adapter
    if (context.mqtt?.client) {
      try {
        await context.mqtt.client.publish(topic, payload);
      } catch (err) {
        console.warn('[ProtocolBridge] MQTT client publish failed:', err);
      }
    }

    // Update cache & history
    this.mqttCache.set(topic, { topic, payload, timestamp: Date.now() });
    this.recordMessage('mqtt', 'sent', topic, payload, 'text');
    this.updateEndpointActivity('mqtt', topic);

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `📤 **Wysłano do MQTT**\n\n` +
          `📡 **Temat:** \`${topic}\`\n` +
          `💬 **Wiadomość:** ${payload}\n` +
          `⏰ **Czas:** ${new Date().toLocaleTimeString('pl-PL')}`,
        summary: `Wysłano "${payload}" do ${topic}`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleRestSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Parse: "wyślij rest <METHOD> <URL> [body]"
    const match = input.match(/(?:rest|api)\s+(GET|POST|PUT|PATCH|DELETE)\s+(https?:\/\/[^\s]+)(?:\s+(.*))?/i);
    if (!match) {
      return this.errorResult(
        '❌ Format: "wyślij rest <METODA> <URL> [treść]"\n' +
        'Przykład: "wyślij rest POST https://api.example.com/cmd {action: on}"',
        start,
      );
    }

    const method = match[1].toUpperCase();
    const url = match[2];
    const body = match[3]?.trim() || undefined;

    // Execute via Tauri backend if available for CORS-free requests
    let responseText: string;
    let statusCode = 0;

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_rest', {
          method, url, body,
        }) as { status: number; body: string };
        responseText = result.body;
        statusCode = result.status;
      } catch (err) {
        responseText = `Błąd: ${err instanceof Error ? err.message : String(err)}`;
        statusCode = 0;
      }
    } else {
      // Browser fallback
      try {
        const resp = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body && method !== 'GET' ? body : undefined,
        });
        statusCode = resp.status;
        responseText = await resp.text();
      } catch (err) {
        responseText = `Błąd połączenia: ${err instanceof Error ? err.message : String(err)}`;
        statusCode = 0;
      }
    }

    // Truncate long responses
    const truncated = responseText.length > 2000;
    const displayText = truncated ? responseText.slice(0, 2000) + '\n…(skrócono)' : responseText;

    // Try to format JSON nicely
    let formattedResponse = displayText;
    try {
      const parsed = JSON.parse(responseText);
      formattedResponse = JSON.stringify(parsed, null, 2).slice(0, 2000);
    } catch { /* not JSON */ }

    this.recordMessage('rest', 'sent', `${method} ${url}`, body || '', 'text');
    this.recordMessage('rest', 'received', `${method} ${url}`, responseText.slice(0, 500), 'api');
    this.updateEndpointActivity('rest', url);

    const statusIcon = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode === 0 ? '❌' : '⚠️';

    return {
      pluginId: this.id,
      status: statusCode >= 200 && statusCode < 300 ? 'success' : 'error',
      content: [{
        type: 'text',
        data: `${statusIcon} **REST ${method}** → ${url}\n\n` +
          `📊 **Status:** ${statusCode || 'brak połączenia'}\n` +
          (body ? `📤 **Wysłano:** ${body.slice(0, 200)}\n` : '') +
          `\n📥 **Odpowiedź:**\n\`\`\`json\n${formattedResponse}\n\`\`\``,
        summary: `REST ${method} ${url}: status ${statusCode}`,
      }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated,
        source_url: url,
      },
    };
  }

  // ─── Read (protocol → text/voice) ──────────────────────

  private async handleRead(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const lower = input.toLowerCase();

    if (/mqtt/i.test(lower)) {
      return this.handleMqttRead(input, context, start);
    }
    if (/rest|api|http/i.test(lower)) {
      return this.handleRestRead(input, context, start);
    }

    // Show general help
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: '🌉 **Protocol Bridge — Most Protokołów**\n\n' +
          'Umożliwia komunikację między protokołami a tekstem/głosem.\n\n' +
          '### MQTT ↔ Tekst ↔ Głos\n' +
          '- "bridge mqtt home/sensors/temperature" — odczytaj z MQTT\n' +
          '- "wyślij mqtt home/lights/living on" — wyślij do MQTT\n\n' +
          '### REST API ↔ Tekst ↔ Głos\n' +
          '- "bridge rest GET https://api.example.com/data" — pobierz dane\n' +
          '- "wyślij rest POST https://api.example.com/cmd {action: on}" — wyślij\n\n' +
          '### Zarządzanie mostami\n' +
          '- "dodaj bridge mqtt ws://broker:9001 home/#" — skonfiguruj most MQTT\n' +
          '- "dodaj bridge rest https://api.example.com" — skonfiguruj most REST\n' +
          '- "lista bridge" — pokaż skonfigurowane mosty\n' +
          '- "bridge status" — status połączeń\n' +
          '- "usuń bridge <id>" — usuń most\n\n' +
          '💡 Wszystkie odpowiedzi są w formacie tekstowym, gotowe do odczytu głosowego (TTS).',
        title: 'Protocol Bridge',
        summary: 'Most protokołów — MQTT i REST do tekstu i głosu',
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleMqttRead(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Extract topic from input
    const topicMatch = input.match(/mqtt\s+([^\s]+)/i);
    const topic = topicMatch ? topicMatch[1] : '#';

    // 1. Try reading from local cache
    const cached = this.findCachedMqtt(topic);
    if (cached.length > 0) {
      const lines = cached.map(e => {
        const age = Math.round((Date.now() - e.timestamp) / 1000);
        return `📡 **${e.topic}**: ${e.payload} _(${age}s temu)_`;
      });

      this.recordMessage('mqtt', 'received', topic, cached.map(c => c.payload).join(', '), 'text');

      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📥 **Odczyt MQTT** — \`${topic}\`\n\n${lines.join('\n')}`,
          summary: cached.length === 1
            ? `${cached[0].topic}: ${cached[0].payload}`
            : `${cached.length} odczytów z MQTT`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: true, truncated: false },
      };
    }

    // 2. Try MQTT adapter from context
    if (context.mqtt?.client) {
      try {
        const value = context.mqtt.client.getLastValue(topic);
        if (value != null) {
          const payload = typeof value === 'string' ? value : JSON.stringify(value);
          this.mqttCache.set(topic, { topic, payload, timestamp: Date.now() });
          this.recordMessage('mqtt', 'received', topic, payload, 'text');

          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: `📥 **Odczyt MQTT** — \`${topic}\`\n\n📡 **${topic}**: ${payload}`,
              summary: `${topic}: ${payload}`,
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          };
        }
      } catch (err) {
        console.warn('[ProtocolBridge] MQTT client read failed:', err);
      }
    }

    // 3. Try Tauri backend
    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('mqtt_read', { topic }) as { topic: string; payload: string } | null;
        if (result) {
          this.mqttCache.set(result.topic, { ...result, timestamp: Date.now() });
          this.recordMessage('mqtt', 'received', result.topic, result.payload, 'text');

          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: `📥 **Odczyt MQTT** — \`${result.topic}\`\n\n📡 **${result.topic}**: ${result.payload}`,
              summary: `${result.topic}: ${result.payload}`,
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          };
        }
      } catch (err) {
        console.warn('[ProtocolBridge] Tauri mqtt_read failed:', err);
      }
    }

    // No data available
    const available = this.mqttCache.size > 0
      ? `\n\nDostępne tematy: ${Array.from(this.mqttCache.keys()).map(t => `\`${t}\``).join(', ')}`
      : '';

    return {
      pluginId: this.id,
      status: 'partial',
      content: [{
        type: 'text',
        data: `⚠️ **Brak danych MQTT** dla tematu \`${topic}\`\n\n` +
          'Upewnij się, że:\n' +
          '1. Broker MQTT jest uruchomiony\n' +
          '2. Temat jest poprawny\n' +
          '3. Most jest skonfigurowany ("dodaj bridge mqtt ws://broker:9001 ' + topic + '")' +
          available,
        summary: `Brak danych MQTT dla ${topic}`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleRestRead(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Parse: "bridge rest [METHOD] <URL>"
    const match = input.match(/(?:rest|api)\s+(?:(GET|POST|PUT|DELETE)\s+)?(https?:\/\/[^\s]+)/i);
    if (!match) {
      return this.errorResult(
        '❌ Format: "bridge rest [GET] <URL>"\n' +
        'Przykład: "bridge rest GET https://api.example.com/sensors"',
        start,
      );
    }

    const method = (match[1] || 'GET').toUpperCase();
    const url = match[2];

    let responseText: string;
    let statusCode = 0;

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_rest', {
          method, url,
        }) as { status: number; body: string };
        responseText = result.body;
        statusCode = result.status;
      } catch (err) {
        responseText = `Błąd: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      try {
        const resp = await fetch(url, { method });
        statusCode = resp.status;
        responseText = await resp.text();
      } catch (err) {
        responseText = `Błąd połączenia: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Try to format JSON
    let formattedResponse = responseText;
    let textSummary = responseText.slice(0, 150);
    try {
      const parsed = JSON.parse(responseText);
      formattedResponse = JSON.stringify(parsed, null, 2);
      // Create voice-friendly summary from JSON
      textSummary = this.jsonToVoiceSummary(parsed);
    } catch { /* not JSON */ }

    const truncated = formattedResponse.length > 2000;
    const displayText = truncated ? formattedResponse.slice(0, 2000) + '\n…(skrócono)' : formattedResponse;

    this.recordMessage('rest', 'received', `${method} ${url}`, responseText.slice(0, 500), 'text');
    this.updateEndpointActivity('rest', url);

    const statusIcon = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode === 0 ? '❌' : '⚠️';

    return {
      pluginId: this.id,
      status: statusCode >= 200 && statusCode < 300 ? 'success' : 'partial',
      content: [{
        type: 'text',
        data: `${statusIcon} **REST ${method}** ← ${url}\n\n` +
          `📊 **Status:** ${statusCode || 'brak połączenia'}\n\n` +
          `📥 **Odpowiedź:**\n\`\`\`json\n${displayText}\n\`\`\``,
        summary: textSummary,
      }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated,
        source_url: url,
      },
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private findCachedMqtt(topicFilter: string): MqttCacheEntry[] {
    if (topicFilter === '#') {
      return Array.from(this.mqttCache.values());
    }

    const results: MqttCacheEntry[] = [];
    const filterParts = topicFilter.split('/');

    for (const entry of this.mqttCache.values()) {
      if (this.mqttTopicMatches(entry.topic, filterParts)) {
        results.push(entry);
      }
    }
    return results;
  }

  private mqttTopicMatches(topic: string, filterParts: string[]): boolean {
    // Exact match
    if (topic === filterParts.join('/')) return true;

    const topicParts = topic.split('/');

    // Wildcard matching
    for (let i = 0; i < filterParts.length; i++) {
      if (filterParts[i] === '#') return true; // multi-level wildcard
      if (filterParts[i] === '+') continue; // single-level wildcard
      if (i >= topicParts.length || filterParts[i] !== topicParts[i]) return false;
    }

    return topicParts.length === filterParts.length;
  }

  /**
   * Convert JSON response to voice-friendly text summary
   */
  private jsonToVoiceSummary(data: unknown, depth = 0): string {
    if (depth > 2) return '(zagnieżdżone dane)';

    if (Array.isArray(data)) {
      if (data.length === 0) return 'pusta lista';
      if (data.length <= 3) {
        return data.map((item, i) => `element ${i + 1}: ${this.jsonToVoiceSummary(item, depth + 1)}`).join(', ');
      }
      return `lista z ${data.length} elementami. Pierwsze: ${this.jsonToVoiceSummary(data[0], depth + 1)}`;
    }

    if (data !== null && typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>);
      if (entries.length === 0) return 'pusty obiekt';
      const summary = entries.slice(0, 5).map(([k, v]) => {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          return `${k}: ${v}`;
        }
        return `${k}: ${this.jsonToVoiceSummary(v, depth + 1)}`;
      }).join(', ');
      return entries.length > 5 ? `${summary}, i ${entries.length - 5} więcej` : summary;
    }

    return String(data);
  }

  private recordMessage(protocol: BridgeProtocol, direction: 'sent' | 'received', target: string, payload: string, source: 'text' | 'voice' | 'api'): void {
    this.history.push({
      timestamp: Date.now(),
      bridgeId: this.findEndpointForTarget(protocol, target)?.id || `${protocol}-ad-hoc`,
      protocol,
      direction,
      target,
      payload: payload.slice(0, 500),
      source,
    });

    // Trim history
    if (this.history.length > ProtocolBridgePlugin.MAX_HISTORY) {
      this.history = this.history.slice(-ProtocolBridgePlugin.MAX_HISTORY);
    }
  }

  private findEndpointForTarget(protocol: BridgeProtocol, target: string): BridgeEndpoint | undefined {
    for (const ep of this.endpoints.values()) {
      if (ep.protocol !== protocol) continue;
      if (ep.targets.some(t => target.includes(t) || t === '#')) return ep;
      if (target.includes(ep.url)) return ep;
    }
    return undefined;
  }

  private updateEndpointActivity(protocol: BridgeProtocol, target: string): void {
    const ep = this.findEndpointForTarget(protocol, target);
    if (ep) {
      ep.lastActivity = Date.now();
      ep.messageCount++;
    }
  }

  private directionLabel(dir: BridgeDirection): string {
    switch (dir) {
      case 'in': return '📥 tylko odbiór';
      case 'out': return '📤 tylko wysyłka';
      case 'bidirectional': return '↔️ dwukierunkowy';
    }
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
    console.log('[ProtocolBridge] Plugin initialized — MQTT ↔ text ↔ voice, REST ↔ text ↔ voice');

    // If MQTT config is available in context, pre-populate cache
    if (context.mqtt?.client) {
      try {
        for (const topic of context.mqtt.config.topics) {
          const val = context.mqtt.client.getLastValue(topic);
          if (val != null) {
            this.mqttCache.set(topic, {
              topic,
              payload: typeof val === 'string' ? val : JSON.stringify(val),
              timestamp: Date.now(),
            });
          }
        }
        if (this.mqttCache.size > 0) {
          console.log(`[ProtocolBridge] Pre-loaded ${this.mqttCache.size} MQTT topics from context`);
        }
      } catch (err) {
        console.warn('[ProtocolBridge] Failed to pre-load MQTT cache:', err);
      }
    }
  }

  async dispose(): Promise<void> {
    this.endpoints.clear();
    this.history = [];
    this.mqttCache.clear();
    console.log('[ProtocolBridge] Plugin disposed');
  }
}

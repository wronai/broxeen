/**
 * Protocol Bridge Plugin — enables communication between protocols and text/voice
 *
 * Protocols:
 *   MQTT        ↔ text ↔ voice   (pub/sub IoT messaging)
 *   REST API    ↔ text ↔ voice   (HTTP request/response)
 *   WebSocket   ↔ text ↔ voice   (bidirectional real-time)
 *   SSE         → text → voice   (server-sent events, read-only)
 *   GraphQL     ↔ text ↔ voice   (query/mutation API)
 *
 * Commands (chat / voice):
 *   "bridge mqtt home/sensors/temperature"          → read MQTT
 *   "wyślij mqtt home/lights/living on"             → publish MQTT
 *   "bridge rest GET https://api.example.com/data"  → fetch REST
 *   "bridge ws wss://live.example.com/feed"         → connect WebSocket
 *   "bridge sse https://api.example.com/events"     → listen SSE
 *   "bridge graphql https://api.example.com/graphql { users { name } }" → query
 *   "dodaj bridge mqtt ws://broker:9001 home/#"     → configure bridge
 *   "lista bridge" / "bridge status"                → manage bridges
 *
 * Natural language (PL):
 *   "połącz się z websocketem wss://..."            → auto-detect WebSocket
 *   "nasłuchuj na zdarzenia z https://..."          → auto-detect SSE
 *   "zapytaj api o użytkowników"                    → GraphQL with context
 *   "jaka temperatura z mqtt"                       → MQTT read shortcut
 *   "włącz światło przez mqtt"                      → MQTT write shortcut
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { logger } from '../../lib/logger';

const browseLogger = logger.scope('bridge:rss');

// ─── Types ──────────────────────────────────────────────────

export type BridgeProtocol = 'mqtt' | 'rest' | 'websocket' | 'sse' | 'graphql' | 'rss' | 'atom' | 'ftp';
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

/** Suggested follow-up action shown to user */
export interface ActionHint {
  label: string;
  command: string;
}

interface MqttCacheEntry {
  topic: string;
  payload: string;
  timestamp: number;
}

/** WebSocket connection state */
interface WsConnection {
  id: string;
  url: string;
  messages: Array<{ timestamp: number; data: string; direction: 'in' | 'out' }>;
  connectedAt: number;
  lastMessage?: number;
  messageCount: number;
}

/** SSE stream state */
interface SseStream {
  id: string;
  url: string;
  events: Array<{ timestamp: number; type: string; data: string }>;
  startedAt: number;
  eventCount: number;
}

// ─── Protocol Labels ────────────────────────────────────────

const PROTOCOL_LABELS: Record<BridgeProtocol, { icon: string; pl: string; en: string }> = {
  mqtt:      { icon: '📡', pl: 'MQTT',      en: 'MQTT' },
  rest:      { icon: '🌐', pl: 'REST API',  en: 'REST API' },
  websocket: { icon: '🔌', pl: 'WebSocket', en: 'WebSocket' },
  sse:       { icon: '📻', pl: 'SSE',       en: 'Server-Sent Events' },
  graphql:   { icon: '💎', pl: 'GraphQL',   en: 'GraphQL' },
  rss:       { icon: '📰', pl: 'RSS',       en: 'RSS' },
  atom:      { icon: '🗞️', pl: 'Atom',      en: 'Atom' },
  ftp:       { icon: '📁', pl: 'FTP',       en: 'FTP' },
};

// ─── Plugin ─────────────────────────────────────────────────

export class ProtocolBridgePlugin implements Plugin {
  readonly id = 'protocol-bridge';
  readonly name = 'Protocol Bridge';
  readonly version = '2.0.0';
  readonly supportedIntents = [
    'bridge:read', 'bridge:send', 'bridge:add',
    'bridge:remove', 'bridge:list', 'bridge:status',
  ];

  private endpoints = new Map<string, BridgeEndpoint>();
  private history: BridgeMessage[] = [];
  private mqttCache = new Map<string, MqttCacheEntry>();
  private wsConnections = new Map<string, WsConnection>();
  private sseStreams = new Map<string, SseStream>();

  /** Max history entries kept in memory */
  private static readonly MAX_HISTORY = 200;
  private static readonly MAX_WS_MESSAGES = 50;
  private static readonly MAX_SSE_EVENTS = 50;

  /** Consolidated patterns for canHandle */
  private static readonly CAN_HANDLE_PATTERNS: readonly RegExp[] = [
    /bridge/i,
    /most.*protokó?ł|most.*protokol/i,
    /mqtt.*te[xk]st|mqtt.*g[łl]os|mqtt.*voice/i,
    /rest.*te[xk]st|rest.*g[łl]os|rest.*voice/i,
    /wy[śs]lij.*(?:mqtt|rest|ws)/i, /odczytaj.*(?:mqtt|rest)/i, /pobierz.*rest/i,
    /dodaj.*bridge|usu[ńn].*bridge/i,
    /protokó?ł.*most|protokol.*most/i,
    /websocket|web.?socket/i, /po[łl][aą]cz.*ws/i,
    /\bsse\b/i, /server.?sent/i, /nas[łl]uchuj.*zdarze/i,
    /graphql/i, /zapytaj.*api/i,
    /po[łl][aą]cz.*si[eę].*z/i, /nas[łl]uchuj/i,
    /strumie[ńn].*danych/i,
    /rss|atom|kana[łl]|feed/i, /subskrybuj.*rss|subskrybuj.*atom/i,
    /czytaj.*rss|czytaj.*atom|odczytaj.*feed/i,
  ];

  /** Data-driven command routing table - [pattern, handler-key] */
  private static readonly ROUTE_TABLE: ReadonlyArray<[RegExp, string]> = [
    // Bridge management (highest priority)
    [/usu[ńn].*bridge|remove.*bridge|delete.*bridge/i, 'remove'],
    [/lista.*bridge|list.*bridge|bridge.*list[a]?|poka[żz].*bridge/i, 'list'],
    [/bridge.*status|status.*bridge|stan.*bridge/i, 'status'],
    [/dodaj.*bridge|add.*bridge|nowy?.*bridge|new.*bridge|konfiguruj.*bridge|configure.*bridge/i, 'add'],
    // Protocol operations
    [/wy[śs]lij|send|publish|opublikuj|post\s/i, 'send'],
    [/websocket|web.?socket|bridge.*ws\b|po[łl][aą]cz.*ws/i, 'websocket'],
    [/\bsse\b|server.?sent|nas[łl]uchuj.*zdarze|bridge.*sse/i, 'sse'],
    [/graphql|bridge.*graphql|zapytaj.*api/i, 'graphql'],
    [/rss|bridge.*rss|czytaj.*rss|odczytaj.*rss/i, 'rss'],
    [/atom|bridge.*atom|czytaj.*atom|odczytaj.*atom/i, 'atom'],
  ];

  private static resolveRoute(input: string): string | null {
    const lower = input.toLowerCase();
    for (const [pattern, key] of ProtocolBridgePlugin.ROUTE_TABLE) {
      if (pattern.test(lower)) return key;
    }
    return null;
  }

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return ProtocolBridgePlugin.CAN_HANDLE_PATTERNS.some(p => p.test(lower));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const route = ProtocolBridgePlugin.resolveRoute(input);

    // Special case: websocket via URL scheme (wss:// without mqtt)
    if (!route && /wss?:\/\//i.test(input) && !/mqtt/i.test(input)) {
      return this.handleWebSocket(input, context, start);
    }

    switch (route) {
      case 'remove':    return this.handleRemove(input, start);
      case 'list':      return this.handleList(start);
      case 'status':    return this.handleStatus(start);
      case 'add':       return this.handleAdd(input, start);
      case 'send':      return this.handleSend(input, context, start);
      case 'websocket': return this.handleWebSocket(input, context, start);
      case 'sse':       return this.handleSse(input, context, start);
      case 'graphql':   return this.handleGraphQL(input, context, start);
      case 'rss':       return this.handleRss(input, context, start);
      case 'atom':      return this.handleAtom(input, context, start);
    }

    // Natural language auto-detection fallback
    const autoProtocol = this.detectProtocolFromInput(input);
    if (autoProtocol) {
      switch (autoProtocol) {
        case 'websocket': return this.handleWebSocket(input, context, start);
        case 'sse': return this.handleSse(input, context, start);
        case 'graphql': return this.handleGraphQL(input, context, start);
        case 'rss': return this.handleRss(input, context, start);
        case 'atom': return this.handleAtom(input, context, start);
        default: break;
      }
    }

    // Default: read from protocol
    return this.handleRead(input, context, start);
  }

  // ─── Auto-detection from URL scheme or NL cues ────────

  private detectProtocolFromInput(input: string): BridgeProtocol | null {
    if (/wss?:\/\//i.test(input) && !/mqtt/i.test(input)) return 'websocket';
    if (/mqtts?:\/\//i.test(input)) return 'mqtt';

    const lower = input.toLowerCase();
    if (/połącz.*się.*z|polacz.*sie.*z/i.test(lower) && /wss?:\/\//i.test(input)) return 'websocket';
    if (/nasłuchuj|nasluchuj|strumień|strumien/i.test(lower) && /https?:\/\//i.test(input)) return 'sse';
    if (/zapytaj.*api/i.test(lower)) return 'graphql';
    
    // RSS/Atom detection
    if (/rss|\.xml.*rss|kana[łl].*rss/i.test(lower) || /(rss|feed)/i.test(input)) return 'rss';
    if (/atom|\.xml.*atom|kana[łl].*atom/i.test(lower) || /atom/i.test(input)) return 'atom';

    return null;
  }

  // ─── Add Bridge ─────────────────────────────────────────

  private handleAdd(input: string, start: number): PluginResult {
    const lower = input.toLowerCase();

    // Detect protocol
    let protocol: BridgeProtocol;
    if (/mqtt/i.test(lower)) {
      protocol = 'mqtt';
    } else if (/websocket|web.?socket|\bws\b/i.test(lower)) {
      protocol = 'websocket';
    } else if (/\bsse\b|server.?sent/i.test(lower)) {
      protocol = 'sse';
    } else if (/graphql/i.test(lower)) {
      protocol = 'graphql';
    } else if (/rss|feed/i.test(lower)) {
      protocol = 'rss';
    } else if (/atom/i.test(lower)) {
      protocol = 'atom';
    } else if (/rest|api|http/i.test(lower)) {
      protocol = 'rest';
    } else {
      // Try auto-detect from URL
      const autoProto = this.detectProtocolFromInput(input);
      if (autoProto) {
        protocol = autoProto;
      } else {
        return this.withHints(
          this.errorResult(
            '❌ Podaj protokół mostu.\n\n' +
            'Dostępne protokoły: `mqtt`, `rest`, `websocket`, `sse`, `graphql`, `rss`, `atom`\n\n' +
            'Przykłady:\n' +
            '- "dodaj bridge mqtt ws://broker:9001 home/sensors/#"\n' +
            '- "dodaj bridge rest https://api.example.com/sensors"\n' +
            '- "dodaj bridge ws wss://live.example.com/feed"\n' +
            '- "dodaj bridge sse https://api.example.com/events"\n' +
            '- "dodaj bridge graphql https://api.example.com/graphql"\n' +
            '- "dodaj bridge rss https://example.com/feed.xml"\n' +
            '- "dodaj bridge atom https://example.com/atom.xml"',
            start,
          ),
          [
            { label: 'MQTT', command: 'dodaj bridge mqtt ws://broker:9001 home/#' },
            { label: 'REST', command: 'dodaj bridge rest https://api.example.com' },
            { label: 'WebSocket', command: 'dodaj bridge ws wss://example.com/feed' },
            { label: 'SSE', command: 'dodaj bridge sse https://api.example.com/events' },
            { label: 'RSS', command: 'dodaj bridge rss https://example.com/feed.xml' },
            { label: 'Atom', command: 'dodaj bridge atom https://example.com/atom.xml' },
          ],
        );
      }
    }

    // Extract URL
    const urlMatch = input.match(/(wss?:\/\/[^\s]+|https?:\/\/[^\s]+|mqtts?:\/\/[^\s]+)/i);
    let url: string;
    
    if (!urlMatch && (protocol === 'rss' || protocol === 'atom')) {
      // For RSS/Atom, also accept URLs without explicit scheme if they end with .xml
      const xmlUrlMatch = input.match(/([^\s]+\.(xml|rss|atom))/i);
      if (!xmlUrlMatch) {
        const label = PROTOCOL_LABELS[protocol];
        return this.errorResult(
          `❌ Brak adresu URL dla mostu ${label.pl}.\n\n` +
          this.urlExampleForProtocol(protocol),
          start,
        );
      }
      url = `https://${xmlUrlMatch[1]}`; // Default to https for XML files
    } else if (!urlMatch) {
      const label = PROTOCOL_LABELS[protocol];
      return this.errorResult(
        `❌ Brak adresu URL dla mostu ${label.pl}.\n\n` +
        this.urlExampleForProtocol(protocol),
        start,
      );
    } else {
      url = urlMatch[1];
    }

    // Extract targets (MQTT topics or REST paths after URL)
    const afterUrl = input.slice(input.indexOf(url) + url.length).trim();
    const targets = afterUrl
      ? afterUrl.split(/\s+/).filter(t => t.length > 0 && !t.startsWith('-'))
      : protocol === 'mqtt' ? ['#'] : protocol === 'rss' || protocol === 'atom' ? ['feed'] : ['/'];

    const id = `${protocol}-${Date.now().toString(36)}`;
    const direction: BridgeDirection = protocol === 'sse' || protocol === 'rss' || protocol === 'atom' ? 'in' : 'bidirectional';
    const endpoint: BridgeEndpoint = {
      id,
      protocol,
      name: `${PROTOCOL_LABELS[protocol].pl} Bridge`,
      url,
      targets,
      direction,
      active: true,
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.endpoints.set(id, endpoint);

    const targetsStr = targets.map(t => `\`${t}\``).join(', ');
    const label = PROTOCOL_LABELS[protocol];

    return this.withHints(
      {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `✅ **Most protokołu dodany**\n\n` +
            `📌 **ID:** \`${id}\`\n` +
            `${label.icon} **Protokół:** ${label.pl}\n` +
            `🌐 **URL:** ${url}\n` +
            `📡 **Cele:** ${targetsStr}\n` +
            `↔️ **Kierunek:** ${this.directionLabel(direction)}\n\n` +
            `${this.nextStepsForProtocol(protocol, url, targets[0], id)}`,
          title: `Bridge: ${id}`,
          summary: `Dodano most ${label.pl} na ${url}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      },
      this.suggestActionsForEndpoint(protocol, url, targets[0], id),
    );
  }

  // ─── Remove Bridge ──────────────────────────────────────

  private handleRemove(input: string, start: number): PluginResult {
    const idMatch = input.match(/((?:mqtt|rest|websocket|sse|graphql)-[a-z0-9]+)/i);

    if (idMatch && this.endpoints.has(idMatch[1])) {
      const ep = this.endpoints.get(idMatch[1])!;
      this.endpoints.delete(idMatch[1]);
      return this.withHints(
        {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `🗑️ Most **${PROTOCOL_LABELS[ep.protocol].pl}** (\`${ep.id}\`) został usunięty.\n` +
              `URL: ${ep.url}\nWiadomości: ${ep.messageCount}`,
            summary: `Usunięto most ${ep.id}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        },
        [
          { label: 'Lista mostów', command: 'lista bridge' },
          { label: 'Dodaj nowy', command: 'dodaj bridge' },
        ],
      );
    }

    if (this.endpoints.size === 0) {
      return this.errorResult('Brak skonfigurowanych mostów do usunięcia.', start);
    }

    const ids = Array.from(this.endpoints.values()).map(e =>
      `- \`${e.id}\` (${PROTOCOL_LABELS[e.protocol].icon} ${e.protocol.toUpperCase()} → ${e.url})`
    ).join('\n');
    return this.errorResult(`Nie znaleziono mostu. Dostępne:\n${ids}`, start);
  }

  // ─── List Bridges ───────────────────────────────────────

  private handleList(start: number): PluginResult {
    if (this.endpoints.size === 0) {
      return this.withHints(
        {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: '📋 **Brak skonfigurowanych mostów protokołów**\n\n' +
              'Dostępne protokoły: **MQTT**, **REST**, **WebSocket**, **SSE**, **GraphQL**, **RSS**, **Atom**\n\n' +
              'Dodaj most komendą:\n' +
              '- "dodaj bridge mqtt ws://broker:9001 home/sensors/#"\n' +
              '- "dodaj bridge rest https://api.example.com/data"\n' +
              '- "dodaj bridge ws wss://live.example.com/feed"\n' +
              '- "dodaj bridge sse https://api.example.com/events"\n' +
              '- "dodaj bridge graphql https://api.example.com/graphql"\n' +
              '- "dodaj bridge rss https://example.com/feed.xml"\n' +
              '- "dodaj bridge atom https://example.com/atom.xml"\n\n' +
              'Lub użyj bezpośrednio (bez konfiguracji):\n' +
              '- "bridge mqtt home/sensors/temperature"\n' +
              '- "bridge rest GET https://api.example.com/status"\n' +
              '- "bridge ws wss://echo.websocket.org"\n' +
              '- "bridge graphql https://api.example.com/graphql { users { name } }"\n' +
              '- "bridge rss https://example.com/feed.xml"\n' +
              '- "bridge atom https://example.com/atom.xml"',
            summary: 'Brak mostów — 7 protokołów dostępnych',
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        },
        [
          { label: 'Dodaj MQTT', command: 'dodaj bridge mqtt ws://broker:9001 home/#' },
          { label: 'Dodaj REST', command: 'dodaj bridge rest https://api.example.com' },
          { label: 'Dodaj WebSocket', command: 'dodaj bridge ws wss://example.com/feed' },
          { label: 'Dodaj RSS', command: 'dodaj bridge rss https://example.com/feed.xml' },
          { label: 'Dodaj Atom', command: 'dodaj bridge atom https://example.com/atom.xml' },
          { label: 'Pomoc', command: 'bridge' },
        ],
      );
    }

    let data = `📋 **Mosty protokołów** — ${this.endpoints.size}\n\n`;

    for (const ep of this.endpoints.values()) {
      const icon = ep.active ? '🟢' : '🔴';
      const label = PROTOCOL_LABELS[ep.protocol];
      const age = ep.lastActivity
        ? `${Math.round((Date.now() - ep.lastActivity) / 1000)}s temu`
        : 'brak';

      data += `### ${icon} ${label.icon} ${label.pl} — \`${ep.id}\`\n`;
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
    const byProtocol = new Map<BridgeProtocol, number>();
    for (const ep of this.endpoints.values()) {
      byProtocol.set(ep.protocol, (byProtocol.get(ep.protocol) || 0) + 1);
    }
    const totalMessages = Array.from(this.endpoints.values()).reduce((sum, e) => sum + e.messageCount, 0);

    let data = `📊 **Status mostów protokołów**\n\n`;
    for (const [proto, count] of byProtocol) {
      const label = PROTOCOL_LABELS[proto];
      data += `- ${label.icon} **${label.pl}:** ${count} mostów\n`;
    }
    if (byProtocol.size === 0) data += `- Brak skonfigurowanych mostów\n`;
    data += `\n- **Łączna liczba wiadomości:** ${totalMessages}\n`;
    data += `- **Historia:** ${this.history.length} wpisów\n`;
    data += `- **Cache MQTT:** ${this.mqttCache.size} tematów\n`;
    data += `- **WebSocket połączenia:** ${this.wsConnections.size}\n`;
    data += `- **SSE strumienie:** ${this.sseStreams.size}\n\n`;

    if (this.history.length > 0) {
      data += `### Ostatnie wiadomości\n\n`;
      const recent = this.history.slice(-5).reverse();
      for (const msg of recent) {
        const time = new Date(msg.timestamp).toLocaleTimeString('pl-PL');
        const dir = msg.direction === 'sent' ? '📤' : '📥';
        const label = PROTOCOL_LABELS[msg.protocol];
        data += `${dir} **${time}** [${label.icon} ${label.pl}] ${msg.target}: ${msg.payload.slice(0, 80)}\n`;
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
    if (/websocket|web.?socket|\bws\b/i.test(lower)) {
      return this.handleWsSend(input, context, start);
    }
    if (/graphql/i.test(lower)) {
      return this.handleGraphQL(input, context, start);
    }
    if (/rest|api|http/i.test(lower)) {
      return this.handleRestSend(input, context, start);
    }

    return this.withHints(
      this.errorResult(
        '❌ Podaj protokół docelowy.\n\n' +
        'Dostępne: `mqtt`, `rest`, `websocket`, `graphql`\n\n' +
        'Przykłady:\n' +
        '- "wyślij mqtt home/lights/living on"\n' +
        '- "wyślij rest POST https://api.example.com/cmd {action: on}"\n' +
        '- "wyślij ws wss://example.com/feed hello"\n' +
        '- "wyślij graphql https://url { mutation { ... } }"',
        start,
      ),
      [
        { label: 'MQTT', command: 'wyślij mqtt home/lights/living on' },
        { label: 'REST POST', command: 'wyślij rest POST https://api.example.com/cmd {}' },
        { label: 'WebSocket', command: 'wyślij ws wss://example.com/feed hello' },
      ],
    );
  }

  private async handleMqttSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
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

    if (context.isTauri && context.tauriInvoke) {
      try {
        await context.tauriInvoke('mqtt_publish', { topic, payload });
      } catch (err) {
        console.warn('[ProtocolBridge] Tauri mqtt_publish failed, using cache fallback:', err);
      }
    }

    if (context.mqtt?.client) {
      try {
        await context.mqtt.client.publish(topic, payload);
      } catch (err) {
        console.warn('[ProtocolBridge] MQTT client publish failed:', err);
      }
    }

    this.mqttCache.set(topic, { topic, payload, timestamp: Date.now() });
    this.recordMessage('mqtt', 'sent', topic, payload, 'text');
    this.updateEndpointActivity('mqtt', topic);

    return this.withHints(
      {
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
      },
      [
        { label: 'Odczytaj temat', command: `bridge mqtt ${topic}` },
        { label: 'Historia', command: 'bridge status' },
      ],
    );
  }

  private async handleRestSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
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

    const { responseText, statusCode } = await this.fetchRest(method, url, body, context);

    const truncated = responseText.length > 2000;
    let formattedResponse = responseText;
    try {
      const parsed = JSON.parse(responseText);
      formattedResponse = JSON.stringify(parsed, null, 2).slice(0, 2000);
    } catch { /* not JSON */ }

    this.recordMessage('rest', 'sent', `${method} ${url}`, body || '', 'text');
    this.recordMessage('rest', 'received', `${method} ${url}`, responseText.slice(0, 500), 'api');
    this.updateEndpointActivity('rest', url);

    const statusIcon = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode === 0 ? '❌' : '⚠️';

    return this.withHints(
      {
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
        metadata: { duration_ms: Date.now() - start, cached: false, truncated, source_url: url },
      },
      [
        { label: 'Powtórz', command: `bridge rest ${method} ${url}` },
        { label: 'Status', command: 'bridge status' },
      ],
    );
  }

  // ─── WebSocket ─────────────────────────────────────────

  private async handleWebSocket(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const urlMatch = input.match(/(wss?:\/\/[^\s]+)/i);
    if (!urlMatch) {
      return this.withHints(
        this.errorResult(
          '❌ Podaj adres WebSocket (ws:// lub wss://)\n\n' +
          'Przykłady:\n' +
          '- "bridge ws wss://echo.websocket.events" — połącz i odczytaj\n' +
          '- "wyślij ws wss://example.com/feed hello" — wyślij wiadomość\n' +
          '- "połącz się z websocketem wss://live.example.com" — język naturalny',
          start,
        ),
        [
          { label: 'Echo test', command: 'bridge ws wss://echo.websocket.events' },
        ],
      );
    }

    const url = urlMatch[1];
    const existing = this.findWsConnection(url);

    // Show existing connection status
    if (existing && existing.messages.length > 0) {
      const recent = existing.messages.slice(-10).reverse();
      const lines = recent.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('pl-PL');
        const dir = m.direction === 'in' ? '📥' : '📤';
        return `${dir} **${time}** ${m.data.slice(0, 200)}`;
      });

      return this.withHints(
        {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `🔌 **WebSocket** — ${url}\n\n` +
              `📊 **Wiadomości:** ${existing.messageCount}\n` +
              `⏱️ **Połączono:** ${this.formatDuration(Date.now() - existing.connectedAt)} temu\n\n` +
              `### Ostatnie wiadomości\n\n${lines.join('\n')}`,
            summary: `WebSocket ${url}: ${existing.messageCount} wiadomości`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: true, truncated: false },
        },
        [
          { label: 'Wyślij wiadomość', command: `wyślij ws ${url} hello` },
          { label: 'Status', command: 'bridge status' },
        ],
      );
    }

    // Try connecting (Tauri backend for real WS, browser for demo)
    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_ws_connect', { url }) as { connected: boolean; message?: string };
        if (result.connected) {
          this.registerWsConnection(url);
          this.recordMessage('websocket', 'sent', url, 'CONNECT', 'text');
        }
        return this.withHints(
          {
            pluginId: this.id,
            status: result.connected ? 'success' : 'error',
            content: [{
              type: 'text',
              data: result.connected
                ? `🔌 **WebSocket połączony** — ${url}\n\n` +
                  `Teraz możesz wysyłać wiadomości:\n` +
                  `- "wyślij ws ${url} <wiadomość>"\n\n` +
                  `${result.message || ''}`
                : `❌ Nie udało się połączyć z ${url}\n\n${result.message || ''}`,
              summary: result.connected ? `Połączono z ${url}` : `Błąd WebSocket: ${url}`,
            }],
            metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
          },
          result.connected
            ? [{ label: 'Wyślij wiadomość', command: `wyślij ws ${url} hello` }]
            : [{ label: 'Spróbuj ponownie', command: `bridge ws ${url}` }],
        );
      } catch (err) {
        return this.errorResult(`❌ Błąd WebSocket: ${err instanceof Error ? err.message : String(err)}`, start);
      }
    }

    // Browser mode: demonstrate WebSocket concept
    this.registerWsConnection(url);
    this.recordMessage('websocket', 'sent', url, 'CONNECT (demo)', 'text');

    return this.withHints(
      {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `🔌 **WebSocket** — ${url}\n\n` +
            `📡 **Status:** zarejestrowano (tryb przeglądarkowy)\n\n` +
            `W trybie Tauri połączenie WebSocket jest w pełni funkcjonalne.\n` +
            `W przeglądarce rejestrujemy endpoint do zarządzania.\n\n` +
            `Komendy:\n` +
            `- "wyślij ws ${url} <wiadomość>" — wyślij dane\n` +
            `- "bridge status" — status połączeń`,
          summary: `WebSocket zarejestrowany: ${url}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      },
      [
        { label: 'Wyślij wiadomość', command: `wyślij ws ${url} hello` },
        { label: 'Status', command: 'bridge status' },
      ],
    );
  }

  private async handleWsSend(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const match = input.match(/(?:ws|websocket)\s+(wss?:\/\/[^\s]+)\s+(.*)/i);
    if (!match) {
      return this.errorResult(
        '❌ Format: "wyślij ws <URL> <wiadomość>"\n' +
        'Przykład: "wyślij ws wss://echo.websocket.events hello"',
        start,
      );
    }

    const url = match[1];
    const message = match[2].trim();

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_ws_send', { url, message }) as { sent: boolean; response?: string };
        if (result.sent) {
          this.addWsMessage(url, message, 'out');
          if (result.response) this.addWsMessage(url, result.response, 'in');
          this.recordMessage('websocket', 'sent', url, message, 'text');
        }
        return {
          pluginId: this.id,
          status: result.sent ? 'success' : 'error',
          content: [{
            type: 'text',
            data: result.sent
              ? `📤 **Wysłano do WebSocket** — ${url}\n\n💬 ${message}` +
                (result.response ? `\n\n📥 **Odpowiedź:** ${result.response.slice(0, 500)}` : '')
              : `❌ Nie udało się wysłać: połączenie nieaktywne`,
            summary: `WS → ${message.slice(0, 80)}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (err) {
        return this.errorResult(`❌ Błąd WS send: ${err instanceof Error ? err.message : String(err)}`, start);
      }
    }

    // Browser demo
    this.addWsMessage(url, message, 'out');
    this.recordMessage('websocket', 'sent', url, message, 'text');

    return this.withHints(
      {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📤 **WebSocket** → ${url}\n\n💬 **Wysłano:** ${message}\n\n` +
            `_(tryb przeglądarkowy — pełne WS w Tauri)_`,
          summary: `Wysłano "${message}" do ${url}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      },
      [
        { label: 'Wyślij kolejną', command: `wyślij ws ${url} ` },
        { label: 'Status WS', command: `bridge ws ${url}` },
      ],
    );
  }

  // ─── SSE (Server-Sent Events) ──────────────────────────

  private async handleSse(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const urlMatch = input.match(/(https?:\/\/[^\s]+)/i);
    if (!urlMatch) {
      return this.withHints(
        this.errorResult(
          '❌ Podaj adres strumienia SSE (https://...)\n\n' +
          'Przykłady:\n' +
          '- "bridge sse https://api.example.com/events"\n' +
          '- "nasłuchuj na zdarzenia z https://api.example.com/stream"\n' +
          '- "dodaj bridge sse https://api.example.com/events"',
          start,
        ),
        [
          { label: 'Pomoc SSE', command: 'bridge sse' },
        ],
      );
    }

    const url = urlMatch[1];
    const existing = this.sseStreams.get(url);

    // Show existing stream events
    if (existing && existing.events.length > 0) {
      const recent = existing.events.slice(-10).reverse();
      const lines = recent.map(e => {
        const time = new Date(e.timestamp).toLocaleTimeString('pl-PL');
        return `📻 **${time}** [${e.type}] ${e.data.slice(0, 200)}`;
      });

      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📻 **SSE Stream** — ${url}\n\n` +
            `📊 **Zdarzenia:** ${existing.eventCount}\n` +
            `⏱️ **Od:** ${this.formatDuration(Date.now() - existing.startedAt)} temu\n\n` +
            `### Ostatnie zdarzenia\n\n${lines.join('\n')}`,
          summary: `SSE ${url}: ${existing.eventCount} zdarzeń`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: true, truncated: false },
      };
    }

    // Start SSE stream (Tauri backend)
    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_sse_connect', { url }) as {
          connected: boolean; events?: Array<{ type: string; data: string }>;
        };

        if (result.connected) {
          const stream: SseStream = {
            id: `sse-${Date.now().toString(36)}`,
            url,
            events: (result.events || []).map(e => ({ ...e, timestamp: Date.now() })),
            startedAt: Date.now(),
            eventCount: result.events?.length || 0,
          };
          this.sseStreams.set(url, stream);
          this.recordMessage('sse', 'received', url, `${stream.eventCount} events`, 'api');
        }

        const eventsText = result.events?.length
          ? result.events.slice(0, 5).map(e => `📻 [${e.type}] ${e.data.slice(0, 150)}`).join('\n')
          : 'Oczekiwanie na zdarzenia...';

        return {
          pluginId: this.id,
          status: result.connected ? 'success' : 'error',
          content: [{
            type: 'text',
            data: result.connected
              ? `📻 **SSE nasłuchiwanie** — ${url}\n\n${eventsText}`
              : `❌ Nie udało się połączyć z ${url}`,
            summary: result.connected ? `SSE: nasłuchiwanie na ${url}` : `Błąd SSE: ${url}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (err) {
        return this.errorResult(`❌ Błąd SSE: ${err instanceof Error ? err.message : String(err)}`, start);
      }
    }

    // Browser mode: try native EventSource
    const stream: SseStream = {
      id: `sse-${Date.now().toString(36)}`,
      url,
      events: [],
      startedAt: Date.now(),
      eventCount: 0,
    };
    this.sseStreams.set(url, stream);
    this.recordMessage('sse', 'received', url, 'SUBSCRIBE (browser)', 'text');

    return this.withHints(
      {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📻 **SSE Stream zarejestrowany** — ${url}\n\n` +
            `Strumień Server-Sent Events został zarejestrowany.\n` +
            `W trybie Tauri zdarzenia będą automatycznie odbierane.\n\n` +
            `💡 SSE to protokół jednokierunkowy — serwer wysyła zdarzenia do klienta.`,
          summary: `SSE nasłuchiwanie na ${url}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      },
      [
        { label: 'Status', command: 'bridge status' },
        { label: 'Lista mostów', command: 'lista bridge' },
      ],
    );
  }

  // ─── GraphQL ───────────────────────────────────────────

  private async handleGraphQL(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    // Parse: "bridge graphql <URL> <query>" or "graphql <URL> { ... }"
    const urlMatch = input.match(/(https?:\/\/[^\s]+)/i);
    // Extract GraphQL query: everything in { ... } or after URL
    const queryMatch = input.match(/(\{[\s\S]*\})/);

    if (!urlMatch && !queryMatch) {
      return this.withHints(
        this.errorResult(
          '❌ Podaj adres GraphQL i zapytanie.\n\n' +
          'Format: "bridge graphql <URL> { zapytanie }"\n\n' +
          'Przykłady:\n' +
          '- "bridge graphql https://api.example.com/graphql { users { id name } }"\n' +
          '- "zapytaj api https://api.example.com/graphql { posts { title } }"\n' +
          '- "wyślij graphql https://api.example.com/graphql { mutation { createUser(name: \\"Jan\\") { id } } }"',
          start,
        ),
        [
          { label: 'Przykład query', command: 'bridge graphql https://api.example.com/graphql { users { id name } }' },
        ],
      );
    }

    const url = urlMatch ? urlMatch[1] : '';
    const query = queryMatch ? queryMatch[1] : '{ __schema { types { name } } }';

    if (!url) {
      return this.errorResult('❌ Brak adresu URL GraphQL endpoint.', start);
    }

    // Execute GraphQL query
    const gqlBody = JSON.stringify({ query });
    const { responseText, statusCode } = await this.fetchRest('POST', url, gqlBody, context);

    let formattedResponse = responseText;
    let textSummary = responseText.slice(0, 150);
    try {
      const parsed = JSON.parse(responseText);
      formattedResponse = JSON.stringify(parsed, null, 2);
      if (parsed.data) {
        textSummary = this.jsonToVoiceSummary(parsed.data);
      } else if (parsed.errors) {
        textSummary = `Błąd GraphQL: ${parsed.errors[0]?.message || 'nieznany błąd'}`;
      }
    } catch { /* not JSON */ }

    const truncated = formattedResponse.length > 2000;
    const displayText = truncated ? formattedResponse.slice(0, 2000) + '\n…(skrócono)' : formattedResponse;

    this.recordMessage('graphql', 'sent', url, query.slice(0, 200), 'text');
    this.recordMessage('graphql', 'received', url, responseText.slice(0, 500), 'api');
    this.updateEndpointActivity('graphql', url);

    const statusIcon = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode === 0 ? '❌' : '⚠️';

    return this.withHints(
      {
        pluginId: this.id,
        status: statusCode >= 200 && statusCode < 300 ? 'success' : 'error',
        content: [{
          type: 'text',
          data: `${statusIcon} **GraphQL** — ${url}\n\n` +
            `📤 **Zapytanie:**\n\`\`\`graphql\n${query.slice(0, 500)}\n\`\`\`\n\n` +
            `📥 **Odpowiedź:**\n\`\`\`json\n${displayText}\n\`\`\``,
          summary: textSummary,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated, source_url: url },
      },
      [
        { label: 'Powtórz zapytanie', command: `bridge graphql ${url} ${query.slice(0, 200)}` },
        { label: 'Schemat', command: `bridge graphql ${url} { __schema { types { name } } }` },
      ],
    );
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

    // Show general help with all protocols
    return this.withHints(
      {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: '🌉 **Protocol Bridge — Most Protokołów v2**\n\n' +
            'Komunikacja między protokołami a tekstem/głosem.\n\n' +
            '### 📡 MQTT ↔ Tekst ↔ Głos\n' +
            '- "bridge mqtt home/sensors/temperature"\n' +
            '- "wyślij mqtt home/lights/living on"\n\n' +
            '### 🌐 REST API ↔ Tekst ↔ Głos\n' +
            '- "bridge rest GET https://api.example.com/data"\n' +
            '- "wyślij rest POST https://url {body}"\n\n' +
            '### 🔌 WebSocket ↔ Tekst ↔ Głos\n' +
            '- "bridge ws wss://echo.websocket.events"\n' +
            '- "wyślij ws wss://url wiadomość"\n' +
            '- "połącz się z websocketem wss://..."\n\n' +
            '### 📻 SSE → Tekst → Głos\n' +
            '- "bridge sse https://api.example.com/events"\n' +
            '- "nasłuchuj na zdarzenia z https://..."\n\n' +
            '### 💎 GraphQL ↔ Tekst ↔ Głos\n' +
            '- "bridge graphql https://url { users { name } }"\n' +
            '- "zapytaj api https://url { posts { title } }"\n\n' +
            '### Zarządzanie\n' +
            '- "dodaj bridge <protokół> <url>" — skonfiguruj\n' +
            '- "lista bridge" / "bridge status" — przegląd\n' +
            '- "usuń bridge <id>" — usuń most\n\n' +
            '💡 Odpowiedzi w formacie tekstowym, gotowe do odczytu głosowego (TTS).',
          title: 'Protocol Bridge v2',
          summary: 'Most 5 protokołów — MQTT, REST, WebSocket, SSE, GraphQL',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      },
      [
        { label: 'MQTT odczyt', command: 'bridge mqtt home/sensors/temperature' },
        { label: 'REST GET', command: 'bridge rest GET https://api.example.com' },
        { label: 'WebSocket', command: 'bridge ws wss://echo.websocket.events' },
        { label: 'Lista mostów', command: 'lista bridge' },
      ],
    );
  }

  private async handleMqttRead(input: string, context: PluginContext, start: number): Promise<PluginResult> {
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

      return this.withHints(
        {
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
        },
        [
          { label: 'Wyślij do tematu', command: `wyślij mqtt ${topic} ` },
          { label: 'Wszystkie tematy', command: 'bridge mqtt #' },
        ],
      );
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

    return this.withHints(
      {
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
      },
      [
        { label: 'Skonfiguruj MQTT', command: `dodaj bridge mqtt ws://broker:9001 ${topic}` },
        { label: 'Wszystkie tematy', command: 'bridge mqtt #' },
      ],
    );
  }

  private async handleRestRead(input: string, context: PluginContext, start: number): Promise<PluginResult> {
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

    const { responseText, statusCode } = await this.fetchRest(method, url, undefined, context);

    let formattedResponse = responseText;
    let textSummary = responseText.slice(0, 150);
    try {
      const parsed = JSON.parse(responseText);
      formattedResponse = JSON.stringify(parsed, null, 2);
      textSummary = this.jsonToVoiceSummary(parsed);
    } catch { /* not JSON */ }

    const truncated = formattedResponse.length > 2000;
    const displayText = truncated ? formattedResponse.slice(0, 2000) + '\n…(skrócono)' : formattedResponse;

    this.recordMessage('rest', 'received', `${method} ${url}`, responseText.slice(0, 500), 'text');
    this.updateEndpointActivity('rest', url);

    const statusIcon = statusCode >= 200 && statusCode < 300 ? '✅' : statusCode === 0 ? '❌' : '⚠️';

    return this.withHints(
      {
        pluginId: this.id,
        status: statusCode >= 200 && statusCode < 300 ? 'success' : 'partial',
        content: [{
          type: 'text',
          data: `${statusIcon} **REST ${method}** ← ${url}\n\n` +
            `📊 **Status:** ${statusCode || 'brak połączenia'}\n\n` +
            `📥 **Odpowiedź:**\n\`\`\`json\n${displayText}\n\`\`\``,
          summary: textSummary,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated, source_url: url },
      },
      [
        { label: 'Powtórz', command: `bridge rest ${method} ${url}` },
        { label: 'POST', command: `wyślij rest POST ${url} {}` },
      ],
    );
  }

  // ─── Shared REST fetch helper ──────────────────────────

  private async fetchRest(method: string, url: string, body: string | undefined, context: PluginContext): Promise<{ responseText: string; statusCode: number }> {
    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('protocol_bridge_rest', { method, url, body }) as { status: number; body: string };
        return { responseText: result.body, statusCode: result.status };
      } catch (err) {
        return { responseText: `Błąd: ${err instanceof Error ? err.message : String(err)}`, statusCode: 0 };
      }
    }

    try {
      const resp = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body && method !== 'GET' ? body : undefined,
      });
      return { responseText: await resp.text(), statusCode: resp.status };
    } catch (err) {
      return { responseText: `Błąd połączenia: ${err instanceof Error ? err.message : String(err)}`, statusCode: 0 };
    }
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
    if (topic === filterParts.join('/')) return true;

    const topicParts = topic.split('/');

    for (let i = 0; i < filterParts.length; i++) {
      if (filterParts[i] === '#') return true;
      if (filterParts[i] === '+') continue;
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

  private registerWsConnection(url: string): void {
    if (!this.wsConnections.has(url)) {
      this.wsConnections.set(url, {
        id: `ws-${Date.now().toString(36)}`,
        url,
        messages: [],
        connectedAt: Date.now(),
        messageCount: 0,
      });
    }
  }

  private findWsConnection(url: string): WsConnection | undefined {
    return this.wsConnections.get(url);
  }

  private addWsMessage(url: string, data: string, direction: 'in' | 'out'): void {
    const conn = this.wsConnections.get(url);
    if (!conn) {
      this.registerWsConnection(url);
    }
    const c = this.wsConnections.get(url)!;
    c.messages.push({ timestamp: Date.now(), data, direction });
    c.messageCount++;
    c.lastMessage = Date.now();
    if (c.messages.length > ProtocolBridgePlugin.MAX_WS_MESSAGES) {
      c.messages = c.messages.slice(-ProtocolBridgePlugin.MAX_WS_MESSAGES);
    }
  }

  private directionLabel(dir: BridgeDirection): string {
    switch (dir) {
      case 'in': return '📥 tylko odbiór';
      case 'out': return '📤 tylko wysyłka';
      case 'bidirectional': return '↔️ dwukierunkowy';
    }
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  private urlExampleForProtocol(protocol: BridgeProtocol): string {
    switch (protocol) {
      case 'mqtt': return 'Przykład: "dodaj bridge mqtt ws://192.168.1.10:9001 home/sensors/#"';
      case 'rest': return 'Przykład: "dodaj bridge rest https://api.example.com/sensors"';
      case 'websocket': return 'Przykład: "dodaj bridge ws wss://live.example.com/feed"';
      case 'sse': return 'Przykład: "dodaj bridge sse https://api.example.com/events"';
      case 'graphql': return 'Przykład: "dodaj bridge graphql https://api.example.com/graphql"';
      case 'rss': return 'Przykład: "dodaj bridge rss https://example.com/feed.xml"';
      case 'atom': return 'Przykład: "dodaj bridge atom https://example.com/atom.xml"';
      default: return 'Przykład: "dodaj bridge [protocol] [url]"';
    }
  }

  private nextStepsForProtocol(protocol: BridgeProtocol, url: string, target: string, id: string): string {
    const common = `- "lista bridge" — pokaż wszystkie mosty\n- "usuń bridge ${id}" — usuń most`;
    switch (protocol) {
      case 'mqtt':
        return `Teraz możesz:\n- "bridge mqtt ${target}" — odczytaj dane\n- "wyślij mqtt ${target} wartość" — wyślij\n${common}`;
      case 'rest':
        return `Teraz możesz:\n- "bridge rest GET ${url}" — pobierz dane\n- "wyślij rest POST ${url} {dane}" — wyślij\n${common}`;
      case 'websocket':
        return `Teraz możesz:\n- "bridge ws ${url}" — status połączenia\n- "wyślij ws ${url} wiadomość" — wyślij\n${common}`;
      case 'sse':
        return `Teraz możesz:\n- "bridge sse ${url}" — pokaż zdarzenia\n${common}`;
      case 'graphql':
        return `Teraz możesz:\n- "bridge graphql ${url} { query }" — zapytanie\n${common}`;
      case 'rss':
        return `Teraz możesz:\n- "bridge rss ${url}" — odczytaj kanał RSS\n${common}`;
      case 'atom':
        return `Teraz możesz:\n- "bridge atom ${url}" — odczytaj kanał Atom\n${common}`;
      default:
        return `Teraz możesz:\n- "bridge ${protocol} ${url}" — użyj protokołu\n${common}`;
    }
  }

  private suggestActionsForEndpoint(protocol: BridgeProtocol, url: string, target: string, id: string): ActionHint[] {
    switch (protocol) {
      case 'mqtt':
        return [
          { label: 'Odczytaj', command: `bridge mqtt ${target}` },
          { label: 'Wyślij', command: `wyślij mqtt ${target} ` },
          { label: 'Lista', command: 'lista bridge' },
        ];
      case 'rest':
        return [
          { label: 'GET', command: `bridge rest GET ${url}` },
          { label: 'POST', command: `wyślij rest POST ${url} {}` },
          { label: 'Lista', command: 'lista bridge' },
        ];
      case 'websocket':
        return [
          { label: 'Status', command: `bridge ws ${url}` },
          { label: 'Wyślij', command: `wyślij ws ${url} hello` },
        ];
      case 'sse':
        return [
          { label: 'Zdarzenia', command: `bridge sse ${url}` },
          { label: 'Status', command: 'bridge status' },
        ];
      case 'graphql':
        return [
          { label: 'Zapytanie', command: `bridge graphql ${url} { }` },
          { label: 'Schemat', command: `bridge graphql ${url} { __schema { types { name } } }` },
        ];
      case 'rss':
        return [
          { label: 'Odczytaj RSS', command: `bridge rss ${url}` },
          { label: 'Status', command: 'bridge status' },
        ];
      case 'atom':
        return [
          { label: 'Odczytaj Atom', command: `bridge atom ${url}` },
          { label: 'Status', command: 'bridge status' },
        ];
      default:
        return [
          { label: 'Status', command: 'bridge status' },
          { label: 'Lista', command: 'lista bridge' },
        ];
    }
  }

  /**
   * Attach action hints to a PluginResult — serialized in content summary
   * so Chat UI can parse and render them as clickable buttons.
   */
  private withHints(result: PluginResult, hints: ActionHint[]): PluginResult {
    if (hints.length === 0) return result;
    const hintsBlock = '\n\n---\n💡 **Sugerowane akcje:**\n' +
      hints.map(h => `- "${h.command}" — ${h.label}`).join('\n');

    return {
      ...result,
      content: result.content.map((block, i) =>
        i === 0
          ? { ...block, data: block.data + hintsBlock }
          : block,
      ),
    };
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
    console.log('[ProtocolBridge] v2.0 initialized — MQTT, REST, WebSocket, SSE, GraphQL ↔ text ↔ voice');

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

  // ─── RSS/Atom Handlers ───────────────────────────────────

  private async handleRss(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const urlMatch = input.match(/(https?:\/\/[^\s]+|[^\s]+\.(xml|rss))/i);
    if (!urlMatch) {
      return this.errorResult(
        '❌ Podaj adres URL kanału RSS.\n\n' +
        'Przykład: "bridge rss https://example.com/feed.xml"',
        start,
      );
    }

    const url = urlMatch[1].startsWith('http') ? urlMatch[1] : `https://${urlMatch[1]}`;
    
    try {
      let result;
      
      if (context.isTauri) {
        // Use Tauri RSS parser for better XML handling
        const { invoke } = await import('@tauri-apps/api/core');
        const rawContent = await invoke('browse', { url });
        
        // Try to parse as RSS feed first
        try {
          const formattedContent = await invoke('parse_rss_feed_command', { 
            url, 
            content: (rawContent as any).content, 
            maxItems: 10 
          });
          
          this.recordMessage('rss', 'received', url, formattedContent as string, 'api');
          this.updateEndpointActivity('rss', url);

          return this.withHints(
            {
              pluginId: this.id,
              status: 'success',
              content: [{
                type: 'text',
                data: formattedContent as string,
                title: `RSS: ${url}`,
                summary: `Kanał RSS odczytany: ${(rawContent as any).title || url}`,
              }],
              metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, source_url: url },
            },
            [
              { label: 'Odśwież', command: `bridge rss ${url}` },
              { label: 'Status', command: 'bridge status' },
            ],
          );
        } catch (rssError) {
          // If RSS parsing fails, fall back to regular browse
          browseLogger.warn('RSS parsing failed, falling back to regular browse', { url, error: rssError });
          result = rawContent;
        }
      } else {
        // Browser fallback - use regular browse
        const { executeBrowseCommand } = await import('../../lib/browseGateway');
        result = await executeBrowseCommand(url, context.isTauri);
      }
      
      this.recordMessage('rss', 'received', url, (result as any).content, 'api');
      this.updateEndpointActivity('rss', url);

      return this.withHints(
        {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `📰 **RSS Feed** — ${url}\n\n` +
              `${(result as any).content}`,
            title: `RSS: ${url}`,
            summary: `Kanał RSS odczytany: ${(result as any).title || url}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, source_url: url },
        },
        [
          { label: 'Odśwież', command: `bridge rss ${url}` },
          { label: 'Status', command: 'bridge status' },
        ],
      );
    } catch (error) {
      return this.errorResult(
        `❌ Nie udało się odczytać kanału RSS: ${error instanceof Error ? error.message : String(error)}`,
        start,
      );
    }
  }

  private async handleAtom(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const urlMatch = input.match(/(https?:\/\/[^\s]+|[^\s]+\.(xml|atom))/i);
    if (!urlMatch) {
      return this.errorResult(
        '❌ Podaj adres URL kanału Atom.\n\n' +
        'Przykład: "bridge atom https://example.com/atom.xml"',
        start,
      );
    }

    const url = urlMatch[1].startsWith('http') ? urlMatch[1] : `https://${urlMatch[1]}`;
    
    try {
      let result;
      
      if (context.isTauri) {
        // Use Tauri RSS parser for better XML handling
        const { invoke } = await import('@tauri-apps/api/core');
        const rawContent = await invoke<{ content: string }>('browse', { url });
        
        // Try to parse as Atom feed first
        try {
          const formattedContent = await invoke<string>('parse_rss_feed_command', { 
            url, 
            content: rawContent.content, 
            maxItems: 10 
          });
          
          this.recordMessage('atom', 'received', url, formattedContent, 'api');
          this.updateEndpointActivity('atom', url);

          return this.withHints(
            {
              pluginId: this.id,
              status: 'success',
              content: [{
                type: 'text',
                data: formattedContent,
                title: `Atom: ${url}`,
                summary: `Kanał Atom odczytany: ${(rawContent as any).title || url}`,
              }],
              metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, source_url: url },
            },
            [
              { label: 'Odśwież', command: `bridge atom ${url}` },
              { label: 'Status', command: 'bridge status' },
            ],
          );
        } catch (atomError) {
          // If Atom parsing fails, fall back to regular browse
          browseLogger.warn('Atom parsing failed, falling back to regular browse', { url, error: atomError });
          result = rawContent;
        }
      } else {
        // Browser fallback - use regular browse
        const { executeBrowseCommand } = await import('../../lib/browseGateway');
        result = await executeBrowseCommand(url, context.isTauri);
      }
      
      this.recordMessage('atom', 'received', url, result.content, 'api');
      this.updateEndpointActivity('atom', url);

      return this.withHints(
        {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `🗞️ **Atom Feed** — ${url}\n\n` +
              `${result.content}`,
            title: `Atom: ${url}`,
            summary: `Kanał Atom odczytany: ${url}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false, source_url: url },
        },
        [
          { label: 'Odśwież', command: `bridge atom ${url}` },
          { label: 'Status', command: 'bridge status' },
        ],
      );
    } catch (error) {
      return this.errorResult(
        `❌ Nie udało się odczytać kanału Atom: ${error instanceof Error ? error.message : String(error)}`,
        start,
      );
    }
  }

  async dispose(): Promise<void> {
    this.endpoints.clear();
    this.history = [];
    this.mqttCache.clear();
    this.wsConnections.clear();
    this.sseStreams.clear();
    console.log('[ProtocolBridge] Plugin disposed');
  }
}

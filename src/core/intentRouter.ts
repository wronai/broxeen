/**
 * Intent Router - detects user intent and routes to appropriate plugin
 */

import type { IntentDetection, IntentRouter as IIntentRouter, Plugin, PluginContext, DataSourcePlugin } from './types';
import { scopeRegistry } from '../plugins/scope/scopeRegistry';

export class IntentRouter implements IIntentRouter {
  private intentPatterns = new Map<string, RegExp[]>();
  private plugins = new Map<string, Plugin>();
  private dataSourcePlugins = new Map<string, DataSourcePlugin>();

  constructor() {
    this.initializeDefaultPatterns();
  }

  private initializeDefaultPatterns(): void {
    // HTTP/Browse intents
    this.intentPatterns.set('browse:url', [
      /https?:\/\/[^\s]+/i,
      /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
    ]);

    // Network discovery intents (checked before camera:describe)
    this.intentPatterns.set('network:scan', [
      /skanuj.*sieć/i,
      /skanuj.*siec/i,
      /odkryj.*urządzenia/i,
      /odkryj.*urzadzenia/i,
      /znajdź.*urządzenia/i,
      /znajdz.*urzadzenia/i,
      /scan.*network/i,
      /pokaż.*kamer/i,
      /pokaz.*kamer/i,
      /znajdź.*kamer/i,
      /znajdz.*kamer/i,
      /odnajdź.*kamer/i,
      /odnajdz.*kamer/i,
      /wyszukaj.*kamer/i,
      /wykryj.*kamer/i,
      /kamer.*w.*sieci/i,
      /kamer.*lan/i,
      /discover.*camera/i,
      /find.*camera/i,
    ]);

    // Camera describe intents (specific camera view, not discovery)
    this.intentPatterns.set('camera:describe', [
      /co.*wida.*na.*kamerze/i,
      /co.*widocz.*na.*kamerze/i,
      /co.*widac.*na.*kamerze/i,
      /co.*się.*dzieje.*na.*kamerze/i,
      /co.*sie.*dzieje.*na.*kamerze/i,
      /pokaż.*kamerę/i,
      /pokaz.*kamera/i,
      /kamera.*wejściow/i,
      /kamera.*ogrod/i,
      /co.*dzieje.*się.*na.*kamerze/i,
    ]);

    // Network ping intents
    this.intentPatterns.set('network:ping', [
      /ping\s/i,
      /^ping$/i,
      /sprawdź.*host/i,
      /sprawdz.*host/i,
      /sprawdź.*dostępność/i,
      /sprawdz.*dostepnosc/i,
      /czy.*odpowiada/i,
      /czy.*działa.*host/i,
      /czy.*dziala.*host/i,
      /czy.*jest.*dostępny/i,
      /czy.*jest.*dostepny/i,
      /check.*host/i,
      /reachable/i,
    ]);

    // Port scan intents
    this.intentPatterns.set('network:port-scan', [
      /skanuj.*port/i,
      /otwarte.*port/i,
      /sprawdź.*port/i,
      /sprawdz.*port/i,
      /scan.*port/i,
      /open.*port/i,
      /jakie.*porty/i,
    ]);

    // ARP intents
    this.intentPatterns.set('network:arp', [
      /tablica.*arp/i,
      /arp.*tablica/i,
      /arp.*table/i,
      /arp.*scan/i,
      /skanuj.*lan/i,
      /scan.*lan/i,
      /adresy.*mac/i,
      /mac.*address/i,
      /kto.*jest.*w.*sieci/i,
      /kto.*w.*sieci/i,
      /lista.*urządzeń/i,
      /lista.*urzadzen/i,
      /wszystkie.*urządzenia/i,
      /wszystkie.*urzadzenia/i,
      /hosty.*w.*sieci/i,
      /pokaż.*urządzenia.*mac/i,
      /pokaz.*urzadzenia.*mac/i,
    ]);

    // Wake-on-LAN intents
    this.intentPatterns.set('network:wol', [
      /wake.*on.*lan/i,
      /wol\s/i,
      /obudź.*urządzenie/i,
      /obudz.*urzadzenie/i,
      /włącz.*komputer/i,
      /wlacz.*komputer/i,
      /wybudź/i,
      /wybudz/i,
    ]);

    // mDNS intents
    this.intentPatterns.set('network:mdns', [
      /mdns/i,
      /bonjour/i,
      /zeroconf/i,
      /avahi/i,
      /odkryj.*usługi/i,
      /odkryj.*uslugi/i,
      /discover.*services/i,
      /znajdź.*usługi/i,
      /znajdz.*uslugi/i,
      /usługi.*lokalne/i,
      /uslugi.*lokalne/i,
      /local.*services/i,
      /urządzenia.*w.*sieci/i,
      /urzadzenia.*w.*sieci/i,
    ]);

    // ONVIF camera discovery intents
    this.intentPatterns.set('camera:onvif', [
      /onvif/i,
      /odkryj.*kamer/i,
      /wykryj.*kamer/i,
      /wyszukaj.*kamer.*ip/i,
      /kamery.*ip/i,
      /ip.*camera/i,
      /discover.*camera/i,
      /find.*camera/i,
    ]);

    // Camera health/status intents
    this.intentPatterns.set('camera:health', [
      /status.*kamer/i,
      /stan.*kamer/i,
      /zdrowie.*kamer/i,
      /health.*camera/i,
      /czy.*kamer.*działa/i,
      /czy.*kamer.*dziala/i,
      /sprawdź.*kamer/i,
      /sprawdz.*kamer/i,
    ]);

    // Camera PTZ intents
    this.intentPatterns.set('camera:ptz', [
      /obróć.*kamer/i,
      /obroc.*kamer/i,
      /przesuń.*kamer/i,
      /przesun.*kamer/i,
      /zoom.*kamer/i,
      /przybliż/i,
      /przybliz/i,
      /kamer.*w.*lewo/i,
      /kamer.*w.*prawo/i,
      /kamer.*do.*góry/i,
      /kamer.*w.*dół/i,
      /ptz/i,
    ]);

    // Camera snapshot intents
    this.intentPatterns.set('camera:snapshot', [
      /zrób.*zdjęcie.*kamer/i,
      /zrob.*zdjecie.*kamer/i,
      /snapshot.*kamer/i,
      /capture.*camera/i,
      /zrzut.*kamer/i,
      /złap.*klatkę/i,
      /zlap.*klatke/i,
    ]);

    // Monitor intents
    this.intentPatterns.set('monitor:start', [
      /monitoruj/i,
      /obserwuj/i,
      /śledź/i,
      /sledz/i,
      /stop.*monitor/i,
      /zatrzymaj.*monitor/i,
      /aktywne.*monitor/i,
      /lista.*monitor/i,
      /logi.*monitor/i,
      /historia.*zmian/i,
      /pokaż.*logi/i,
      /pokaz.*logi/i,
      /ustaw.*próg/i,
      /ustaw.*prog/i,
      /ustaw.*interwał/i,
      /ustaw.*interwal/i,
    ]);

    this.intentPatterns.set('system:processes', [
      /^procesy\b/i,
      /^processes\b/i,
      /^stop\s+proces\b/i,
      /^stop\s+process\b/i,
      /^zatrzymaj\s+proces\b/i,
      /^zatrzymaj\s+process\b/i,
    ]);

    // Marketplace intents
    this.intentPatterns.set('marketplace:browse', [
      /marketplace/i,
      /plugin.*store/i,
      /zainstaluj.*plugin/i,
      /install.*plugin/i,
      /lista.*plugin/i,
      /dostępne.*plugin/i,
      /dostepne.*plugin/i,
      /szukaj.*plugin/i,
      /wyszukaj.*plugin/i,
      /odinstaluj.*plugin/i,
      /uninstall.*plugin/i,
      /usun.*plugin/i,
      /usuń.*plugin/i,
    ]);

    // Protocol Bridge intents
    this.intentPatterns.set('bridge:read', [
      /bridge.*mqtt/i,
      /bridge.*rest/i,
      /bridge.*api/i,
      /bridge.*ws\b/i,
      /bridge.*websocket/i,
      /bridge.*sse/i,
      /bridge.*graphql/i,
      /odczytaj.*mqtt/i,
      /odczytaj.*rest/i,
      /pobierz.*rest/i,
      /pobierz.*api/i,
      /mqtt.*text|mqtt.*tekst/i,
      /rest.*text|rest.*tekst/i,
      /mqtt.*głos|mqtt.*glos|mqtt.*voice/i,
      /rest.*głos|rest.*glos|rest.*voice/i,
      /websocket|web.?socket/i,
      /połącz.*ws|polacz.*ws/i,
      /\bsse\b|server.?sent/i,
      /nasłuchuj.*zdarze|nasluchuj.*zdarze/i,
      /graphql/i,
      /zapytaj.*api/i,
      /strumień.*danych|strumien.*danych/i,
    ]);

    this.intentPatterns.set('bridge:send', [
      /wyślij.*mqtt|wyslij.*mqtt/i,
      /wyślij.*rest|wyslij.*rest/i,
      /wyślij.*ws|wyslij.*ws/i,
      /wyślij.*websocket|wyslij.*websocket/i,
      /wyślij.*graphql|wyslij.*graphql/i,
      /opublikuj.*mqtt/i,
      /publish.*mqtt/i,
      /send.*mqtt/i,
      /send.*rest/i,
      /send.*ws\b/i,
      /send.*graphql/i,
      /post.*https?:\/\//i,
    ]);

    this.intentPatterns.set('bridge:add', [
      /dodaj.*bridge/i,
      /add.*bridge/i,
      /nowy.*bridge|new.*bridge/i,
      /konfiguruj.*bridge|configure.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:remove', [
      /usuń.*bridge|usun.*bridge/i,
      /remove.*bridge/i,
      /delete.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:list', [
      /lista.*bridge|list.*bridge/i,
      /bridge.*lista|bridge.*list/i,
      /pokaż.*bridge|pokaz.*bridge/i,
    ]);

    this.intentPatterns.set('bridge:status', [
      /bridge.*status|status.*bridge/i,
      /stan.*bridge|bridge.*stan/i,
      /most.*protokół|most.*protokol/i,
      /protokół.*most|protokol.*most/i,
    ]);

    // Disk info intents
    this.intentPatterns.set('disk:info', [
      /dysk/i,
      /disk/i,
      /partycj/i,
      /partition/i,
      /ile.*miejsca/i,
      /ile.*wolnego/i,
      /ile.*zajęte/i,
      /ile.*zajete/i,
      /wolne.*miejsce/i,
      /storage/i,
      /\bdf\b/i,
      /pojemność.*dysk/i,
      /pojemnosc.*dysk/i,
      /miejsce.*na.*dysku/i,
      /disk.*usage/i,
      /disk.*space/i,
      /disk.*info/i,
    ]);

    // SSH intents
    this.intentPatterns.set('ssh:execute', [
      /^ssh\s/i,
      /text2ssh/i,
      /wykonaj.*na.*\d{1,3}\.\d{1,3}/i,
      /run\s+on\s+\d{1,3}\.\d{1,3}/i,
      /połącz.*ssh/i,
      /polacz.*ssh/i,
      /ssh.*connect/i,
      /zdaln.*komend/i,
      /remote.*command/i,
      /sprawdź.*na.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
      /sprawdz.*na.*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
    ]);

    this.intentPatterns.set('ssh:hosts', [
      /ssh.*host/i,
      /znane.*host/i,
      /known.*host/i,
      /^ssh$/i,
      /test.*ssh/i,
      /sprawdź.*ssh/i,
      /sprawdz.*ssh/i,
    ]);

    // IoT/MQTT intents
    this.intentPatterns.set('iot:read', [
      /jaka.*temperatura/i,
      /jaka.*wilgotność/i,
      /ile.*stopni/i,
      /czujnik/i,
      /sensor/i,
    ]);

    // Search intents (less specific, check after network/camera intents)
    this.intentPatterns.set('search:web', [
      /wyszukaj.*stronę/i,
      /wyszukaj.*w.*internecie/i,
      /wyszukaj\s+informacje/i,
      /wyszukaj\s+o\s/i,
      /znajdź.*w.*internecie/i,
      /szukaj.*w.*google/i,
      /poszukaj.*w.*internecie/i,
      /search.*for/i,
    ]);

    // Chat/LLM intents (fallback)
    this.intentPatterns.set('chat:ask', [
      /.+/, // catch-all (non-empty)
    ]);
  }

  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  registerDataSourcePlugin(plugin: DataSourcePlugin): void {
    this.dataSourcePlugins.set(plugin.id, plugin);
  }

  async detect(input: string): Promise<IntentDetection> {
    const normalizedInput = input.toLowerCase().trim();
    console.log(`🔍 Detecting intent for input: "${input}"`);
    
    // Check specific intents first (in order of priority)
    for (const [intent, patterns] of this.intentPatterns) {
      if (intent === 'chat:ask') continue; // skip fallback for now
      
      for (const pattern of patterns) {
        if (pattern.test(normalizedInput)) {
          console.log(`✅ Intent detected: ${intent} with pattern: ${pattern}`);
          return {
            intent,
            confidence: this.calculateConfidence(normalizedInput, intent),
            entities: this.extractEntities(normalizedInput, intent),
          };
        }
      }
    }

    console.log(`⚠️ No specific intent matched, falling back to chat:ask`);
    // Fallback to chat
    return {
      intent: 'chat:ask',
      confidence: 0.5,
      entities: {},
    };
  }

  route(intent: string, scope?: string): Plugin | DataSourcePlugin | null {
    // Check legacy plugins first
    for (const plugin of this.plugins.values()) {
      if (!plugin.supportedIntents.includes(intent)) continue;
      if (scope && !scopeRegistry.isPluginAllowed(plugin.id, scope)) continue;
      return plugin;
    }
    // Check DataSourcePlugins
    for (const plugin of this.dataSourcePlugins.values()) {
      if (!plugin.capabilities.intents.includes(intent as any)) continue;
      if (scope && !scopeRegistry.isPluginAllowed(plugin.id, scope)) continue;
      return plugin;
    }
    console.log(`❌ No plugin found for intent: ${intent}`);
    return null;
  }

  private calculateConfidence(input: string, intent: string): number {
    // Simple confidence calculation based on keyword matches
    const keywordMap: Record<string, string[]> = {
      'browse:url': ['http', 'www', '.pl', '.com', '.org'],
      'camera:describe': ['kamera', 'wida', 'dzieje'],
      'camera:health': ['status', 'stan', 'sprawdź', 'kamera'],
      'camera:ptz': ['obróć', 'przesuń', 'zoom', 'ptz', 'lewo', 'prawo'],
      'camera:snapshot': ['zdjęcie', 'snapshot', 'zrzut', 'klatka'],
      'camera:onvif': ['onvif', 'odkryj', 'kamera'],
      'network:ping': ['ping', 'sprawdź', 'host'],
      'network:port-scan': ['port', 'skanuj', 'otwarte'],
      'network:arp': ['arp', 'mac', 'tablica'],
      'network:wol': ['wake', 'wol', 'obudź', 'wybudź'],
      'network:mdns': ['mdns', 'bonjour', 'usługi'],
      'marketplace:browse': ['marketplace', 'plugin', 'zainstaluj'],
      'iot:read': ['temperatura', 'wilgotność', 'czujnik', 'sensor'],
      'bridge:read': ['bridge', 'most', 'mqtt', 'rest', 'api', 'tekst', 'głos', 'websocket', 'sse', 'graphql', 'nasłuchuj', 'strumień'],
      'bridge:send': ['wyślij', 'mqtt', 'rest', 'publish', 'send', 'websocket', 'graphql'],
      'bridge:add': ['dodaj', 'bridge', 'konfiguruj'],
      'bridge:remove': ['usuń', 'bridge', 'remove'],
      'bridge:list': ['lista', 'bridge', 'pokaż'],
      'bridge:status': ['status', 'bridge', 'most', 'protokół'],
      'search:web': ['wyszukaj', 'znajdź', 'szukaj'],
      'disk:info': ['dysk', 'disk', 'partycj', 'miejsce', 'wolne', 'storage', 'df'],
      'ssh:execute': ['ssh', 'text2ssh', 'zdaln', 'wykonaj', 'połącz'],
      'ssh:hosts': ['ssh', 'hosty', 'known_hosts'],
    };

    const keywords = keywordMap[intent] || [];
    const matches = keywords.filter(keyword => input.includes(keyword)).length;
    
    // Base confidence + keyword bonus
    const baseConfidence = intent === 'chat:ask' ? 0.5 : 0.6;
    return Math.min(0.9, baseConfidence + (matches * 0.1));
  }

  private extractEntities(input: string, intent: string): Record<string, unknown> {
    const entities: Record<string, unknown> = {};

    switch (intent) {
      case 'browse:url':
        // Extract URL patterns
        const urlMatch = input.match(/(https?:\/\/[^\s]+|(www\.)?[a-z0-9-]+\.[a-z]{2,})/i);
        if (urlMatch) {
          entities.url = urlMatch[1];
        }
        break;

      case 'camera:describe':
        // Extract camera location/name
        if (input.includes('wejściow') || input.includes('front')) {
          entities.cameraId = 'cam-front';
        } else if (input.includes('ogród') || input.includes('ogrod')) {
          entities.cameraId = 'cam-garden';
        }
        break;

      case 'iot:read':
        // Extract sensor type
        if (input.includes('temperatura')) {
          entities.sensorType = 'temperature';
        } else if (input.includes('wilgotność')) {
          entities.sensorType = 'humidity';
        }
        break;

      case 'network:ping':
      case 'network:port-scan': {
        const ipTarget = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
        if (ipTarget) entities.target = ipTarget[0];
        break;
      }

      case 'network:wol': {
        const macAddr = input.match(/([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/);
        if (macAddr) entities.mac = macAddr[0];
        break;
      }

      case 'disk:info': {
        const diskPath = input.match(/(?:ścieżk[aę]|path|katalog|folder)\s+(\S+)/i);
        if (diskPath) entities.path = diskPath[1];
        const diskHost = input.match(/(?:na|on|host)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
        if (diskHost) entities.remoteHost = diskHost[1];
        break;
      }

      case 'ssh:execute':
      case 'ssh:hosts': {
        const sshIp = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
        if (sshIp) entities.host = sshIp[1];
        const sshUser = input.match(/(?:user|użytkownik|jako)\s+(\S+)/i);
        if (sshUser) entities.user = sshUser[1];
        break;
      }

      case 'camera:health':
      case 'camera:ptz':
      case 'camera:snapshot': {
        if (input.includes('wejściow') || input.includes('front') || input.includes('wejsc'))
          entities.cameraId = 'cam-front';
        else if (input.includes('ogród') || input.includes('ogrod') || input.includes('garden'))
          entities.cameraId = 'cam-garden';
        else if (input.includes('salon') || input.includes('living'))
          entities.cameraId = 'cam-salon';
        break;
      }
    }

    return entities;
  }
}

// Helper: Build a PluginQuery
export interface PluginQuery {
  intent: string;
  rawInput: string;
  resolvedTarget?: string;
  params?: Record<string, unknown>;
  metadata?: {
    timestamp: number;
    source: 'voice' | 'text' | 'api';
    locale: string;
  };
}

export function buildQuery(
  intent: string,
  rawInput: string,
  overrides: Partial<Omit<PluginQuery, 'intent' | 'rawInput'>> = {},
): PluginQuery {
  return {
    intent,
    rawInput,
    params: {},
    metadata: {
      timestamp: Date.now(),
      source: 'text',
      locale: 'pl-PL',
    },
    ...overrides,
  };
}

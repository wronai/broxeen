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
      /pokaż.*kamery/i,
      /pokaz.*kamery/i,
      /znajdź.*kamery/i,
      /znajdz.*kamery/i,
      /wyszukaj.*kamery/i,
      /wykryj.*kamery/i,
      /kamery.*w.*sieci/i,
      /kamery.*lan/i,
      /discover.*cameras/i,
      /find.*cameras/i,
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
      'search:web': ['wyszukaj', 'znajdź', 'szukaj'],
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

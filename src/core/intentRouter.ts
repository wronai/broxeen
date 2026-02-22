/**
 * Intent Router - detects user intent and routes to appropriate plugin
 */

import type { IntentDetection, IntentRouter as IIntentRouter, Plugin, PluginContext } from './types';

export class IntentRouter implements IIntentRouter {
  private intentPatterns = new Map<string, RegExp[]>();
  private plugins = new Map<string, Plugin>();

  constructor() {
    this.initializeDefaultPatterns();
  }

  private initializeDefaultPatterns(): void {
    // HTTP/Browse intents
    this.intentPatterns.set('browse:url', [
      /https?:\/\/[^\s]+/i,
      /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
    ]);

    // Network discovery intents
    this.intentPatterns.set('network:scan', [
      /skanuj.*sieć/i,
      /odkryj.*urządzenia/i,
      /znajdź.*urządzenia/i,
      /scan.*network/i,
      /znajdź.*kamerę.*w.*sieci/i,
      /znajdź.*kamere.*w.*sieci/i,
      /znajdź.*kamerę.*lokalnej/i,
      /znajdź.*kamere.*lokalnej/i,
      /wyszukaj.*kamerę.*w.*sieci/i,
      /wyszukaj.*kamere.*lokalnej/i,
      /skanuj.*siec.*w.*poszukiwaniu.*kamer/i,
      /odkryj.*kamery.*w.*sieci/i,
      /odkryj.*kamery.*lokalnej/i,
      /wyszukaj.*kamery.*w.*sieci/i,
      /znajdz.*kamery.*w.*sieci/i,
      /znajdz.*kamery.*lokalnej/i,
      /skanuj.*siec.*kamer/i,
      /odkryj.*kamery.*sieci/i,
      /skanuj.*siec.*kamerami/i,
      /poszukaj.*kamer.*w.*sieci/i,
      /znajdz.*kamery.*lokalnej/i,
    ]);

    // Camera intents
    this.intentPatterns.set('camera:describe', [
      /co.*wida.*na.*kamerze/i,
      /co.*widocz.*na.*kamerze/i,
      /co.*widac.*na.*kamerze/i,
      /co.*się.*dzieje.*na.*kamerze/i,
      /co.*sie.*dzieje.*na.*kamerze/i,
      /pokaż.*kamerę/i,
      /pokaż.*kamery/i,
      /pokaz.*kamera/i,
      /pokaz.*kamery/i,
      /kamera.*wejściow/i,
      /kamera.*ogrod/i,
      /co.*dzieje.*się.*na.*kamerze/i,
      /co.*dzieje.*się.*na.*kamerze.*ogrodow/i,
      /co.*dzieje.*się.*na.*kamerze.*salonow/i,
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
      /znajdź.*w.*internecie/i,
      /szukaj.*w.*google/i,
      /poszukaj.*w.*internecie/i,
    ]);

    // Chat/LLM intents (fallback)
    this.intentPatterns.set('chat:ask', [
      /.+/, // catch-all (non-empty)
    ]);
  }

  registerPlugin(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  async detect(input: string): Promise<IntentDetection> {
    const normalizedInput = input.toLowerCase().trim();
    
    // Check specific intents first (in order of priority)
    for (const [intent, patterns] of this.intentPatterns) {
      if (intent === 'chat:ask') continue; // skip fallback for now
      
      for (const pattern of patterns) {
        if (pattern.test(normalizedInput)) {
          return {
            intent,
            confidence: this.calculateConfidence(normalizedInput, intent),
            entities: this.extractEntities(normalizedInput, intent),
          };
        }
      }
    }

    // Fallback to chat
    return {
      intent: 'chat:ask',
      confidence: 0.5,
      entities: {},
    };
  }

  route(intent: string): Plugin | null {
    console.log(`🔍 Routing intent: ${intent}`);
    console.log(`📦 Available plugins: ${Array.from(this.plugins.keys()).join(', ')}`);
    console.log(`🔍 Plugin intents:`, Array.from(this.plugins.entries()).map(([id, plugin]) => ({
      id,
      intents: plugin.supportedIntents
    })));
    
    for (const plugin of this.plugins.values()) {
      if (plugin.supportedIntents.includes(intent)) {
        console.log(`✅ Found plugin for intent ${intent}: ${plugin.id}`);
        return plugin;
      }
    }
    
    console.log(`❌ No plugin found for intent: ${intent}`);
    return null;
  }

  private calculateConfidence(input: string, intent: string): number {
    // Simple confidence calculation based on keyword matches
    const keywordMap: Record<string, string[]> = {
      'browse:url': ['http', 'www', '.pl', '.com', '.org'],
      'camera:describe': ['kamera', 'wida', 'dzieje'],
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

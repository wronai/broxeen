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

    // Camera intents
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
    ]);

    // IoT/MQTT intents
    this.intentPatterns.set('iot:read', [
      /jaka.*temperatura/i,
      /jaka.*wilgotność/i,
      /ile.*stopni/i,
      /czujnik/i,
      /sensor/i,
    ]);

    // Search intents
    this.intentPatterns.set('search:web', [
      /wyszukaj/i,
      /znajdź/i,
      /szukaj/i,
      /poszukaj/i,
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
    for (const plugin of this.plugins.values()) {
      if (plugin.supportedIntents.includes(intent)) {
        return plugin;
      }
    }
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

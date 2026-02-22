/**
 * Intent Router Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntentRouter } from './intentRouter';
import type { Plugin, PluginContext, PluginResult } from './types';

// Mock plugin for testing
class MockPlugin implements Plugin {
  readonly id: string;
  readonly name: string;
  readonly version = '1.0.0';
  readonly supportedIntents: string[];

  constructor(id: string, name: string, intents: string[]) {
    this.id = id;
    this.name = name;
    this.supportedIntents = intents;
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    return true;
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    return {
      status: 'success',
      content: [{ type: 'text', data: `Mock ${this.name} response` }],
    };
  }
}

describe('IntentRouter', () => {
  let router: IntentRouter;
  let mockPlugin1: MockPlugin;
  let mockPlugin2: MockPlugin;

  beforeEach(() => {
    router = new IntentRouter();
    mockPlugin1 = new MockPlugin('browse', 'Browse Plugin', ['browse:url', 'search:web']);
    mockPlugin2 = new MockPlugin('camera', 'Camera Plugin', ['camera:describe']);
  });

  it('should detect browse URL intent', async () => {
    const result = await router.detect('https://example.com');
    
    expect(result.intent).toBe('browse:url');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.url).toBe('https://example.com');
  });

  it('should detect browse domain intent', async () => {
    const result = await router.detect('www.onet.pl');
    
    expect(result.intent).toBe('browse:url');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.url).toBe('www.onet.pl');
  });

  it('should detect camera describe intent', async () => {
    const result = await router.detect('Co widać na kamerze wejściowej?');
    
    expect(result.intent).toBe('camera:describe');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.cameraId).toBe('cam-front');
  });

  it('should detect IoT read intent', async () => {
    const result = await router.detect('Jaka jest temperatura?');
    
    expect(result.intent).toBe('iot:read');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.entities.sensorType).toBe('temperature');
  });

  it('should detect search intent', async () => {
    const result = await router.detect('Wyszukaj informacje o React');
    
    expect(result.intent).toBe('search:web');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should fallback to chat intent for unknown input', async () => {
    const result = await router.detect('random text that does not match anything');
    
    expect(result.intent).toBe('chat:ask');
    expect(result.confidence).toBe(0.5);
  });

  it('should route to correct plugin', () => {
    router.registerPlugin(mockPlugin1);
    router.registerPlugin(mockPlugin2);
    
    const browsePlugin = router.route('browse:url');
    const cameraPlugin = router.route('camera:describe');
    const nullPlugin = router.route('nonexistent:intent');
    
    expect(browsePlugin).toBe(mockPlugin1);
    expect(cameraPlugin).toBe(mockPlugin2);
    expect(nullPlugin).toBeNull();
  });

  it('should calculate confidence correctly', async () => {
    const highConfidence = await router.detect('https://www.example.com');
    const lowConfidence = await router.detect('random text');
    
    expect(highConfidence.confidence).toBeGreaterThan(lowConfidence.confidence);
  });

  it('should extract entities correctly', async () => {
    const urlResult = await router.detect('https://example.com');
    const cameraResult = await router.detect('Co widać na kamerze ogrod?');
    const iotResult = await router.detect('Jaka jest wilgotność?');
    
    expect(urlResult.entities.url).toBe('https://example.com');
    expect(cameraResult.entities.cameraId).toBe('cam-garden');
    expect(iotResult.entities.sensorType).toBe('humidity');
  });
});

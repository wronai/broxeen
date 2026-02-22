/**
 * Plugin Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from './pluginRegistry';
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

  async initialize(context: PluginContext): Promise<void> {
    // Mock implementation
  }

  async dispose(): Promise<void> {
    // Mock implementation
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let mockPlugin1: MockPlugin;
  let mockPlugin2: MockPlugin;

  beforeEach(() => {
    registry = new PluginRegistry();
    mockPlugin1 = new MockPlugin('test-1', 'Test Plugin 1', ['test:intent']);
    mockPlugin2 = new MockPlugin('test-2', 'Test Plugin 2', ['other:intent']);
  });

  afterEach(async () => {
    await registry.disposeAll();
  });

  it('should register plugin successfully', () => {
    registry.register(mockPlugin1);
    
    expect(registry.get('test-1')).toBe(mockPlugin1);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toBe(mockPlugin1);
  });

  it('should throw error when registering duplicate plugin', () => {
    registry.register(mockPlugin1);
    
    expect(() => registry.register(mockPlugin1)).toThrow(
      'Plugin test-1 is already registered'
    );
  });

  it('should unregister plugin successfully', () => {
    registry.register(mockPlugin1);
    registry.unregister('test-1');
    
    expect(registry.get('test-1')).toBeNull();
    expect(registry.getAll()).toHaveLength(0);
  });

  it('should throw error when unregistering non-existent plugin', () => {
    expect(() => registry.unregister('non-existent')).toThrow(
      'Plugin non-existent not found'
    );
  });

  it('should find plugins by intent', () => {
    registry.register(mockPlugin1);
    registry.register(mockPlugin2);
    
    const testPlugins = registry.findByIntent('test:intent');
    const otherPlugins = registry.findByIntent('other:intent');
    const emptyPlugins = registry.findByIntent('missing:intent');
    
    expect(testPlugins).toHaveLength(1);
    expect(testPlugins[0]).toBe(mockPlugin1);
    
    expect(otherPlugins).toHaveLength(1);
    expect(otherPlugins[0]).toBe(mockPlugin2);
    
    expect(emptyPlugins).toHaveLength(0);
  });

  it('should initialize all plugins', async () => {
    const mockContext = {} as PluginContext;
    
    registry.register(mockPlugin1);
    registry.register(mockPlugin2);
    
    await registry.initializeAll(mockContext);
    
    // Should not throw and all plugins should be initialized
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should dispose all plugins', async () => {
    registry.register(mockPlugin1);
    registry.register(mockPlugin2);
    
    await registry.disposeAll();
    
    expect(registry.getAll()).toHaveLength(0);
  });
});

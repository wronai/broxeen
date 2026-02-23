import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeSync, DEFAULT_SYNC_CONFIG } from './realtimeSync';
import type { DomainEvent } from '../domain/chatEvents';

describe('RealtimeSync', () => {
  let realtimeSync: RealtimeSync;
  let mockBroadcastChannel: any;

  beforeEach(() => {
    // Mock BroadcastChannel - both for main instance and for checkSupport test
    const createMockBroadcastChannel = () => ({
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
      close: vi.fn(),
    });
    
    mockBroadcastChannel = createMockBroadcastChannel();
    
    global.BroadcastChannel = vi.fn((name: string) => {
      if (name === 'test') {
        // For checkSupport() - make it work by default
        return createMockBroadcastChannel();
      }
      return mockBroadcastChannel;
    }) as any;
    
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    global.localStorage = localStorageMock as any;
    
    // Mock window
    const windowMock = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    global.window = windowMock as any;
    
    realtimeSync = new RealtimeSync(DEFAULT_SYNC_CONFIG);
  });

  afterEach(() => {
    realtimeSync.dispose();
    vi.restoreAllMocks();
  });

  it('should initialize with BroadcastChannel when supported', () => {
    expect(global.BroadcastChannel).toHaveBeenCalledWith('broxeen_sync');
    expect(mockBroadcastChannel.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should fallback to localStorage when BroadcastChannel fails', () => {
    // Dispose the existing instance first
    realtimeSync.dispose();
    
    // Make BroadcastChannel throw during both checkSupport and initialization
    global.BroadcastChannel = vi.fn(() => {
      throw new Error('Not supported');
    }) as any;

    const sync = new RealtimeSync(DEFAULT_SYNC_CONFIG);
    
    expect(global.window.addEventListener).toHaveBeenCalledWith('storage', expect.any(Function));
    sync.dispose();
    
    // Recreate the default instance for other tests
    realtimeSync = new RealtimeSync(DEFAULT_SYNC_CONFIG);
  });

  it('should broadcast events', () => {
    const event: DomainEvent = {
      type: 'message_added',
      payload: { id: 1, role: 'user', text: 'test' },
      timestamp: Date.now(),
    };

    realtimeSync.broadcast(event);

    expect(mockBroadcastChannel.postMessage).toHaveBeenCalledWith({
      type: 'sync_event',
      event,
      timestamp: expect.any(Number),
      sourceId: expect.any(String),
    });
  });

  it('should not broadcast events that are not configured for sync', () => {
    const event: DomainEvent = {
      type: 'browse_requested', // Not in syncEvents
      payload: { query: 'test', resolvedUrl: 'http://example.com', resolveType: 'direct' },
      timestamp: Date.now(),
    };

    realtimeSync.broadcast(event);

    expect(mockBroadcastChannel.postMessage).not.toHaveBeenCalled();
  });

  it('should handle incoming broadcast messages', () => {
    const handler = vi.fn();
    realtimeSync.on('message_added', handler);

    const event: DomainEvent = {
      type: 'message_added',
      payload: { id: 1, role: 'user', text: 'test' },
      timestamp: Date.now(),
    };

    const message = {
      type: 'sync_event',
      event,
      timestamp: Date.now(),
      sourceId: 'different_source',
    };

    // Simulate receiving a broadcast message
    const messageHandler = (mockBroadcastChannel.addEventListener as any).mock.calls[0][1];
    messageHandler({ data: message });

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should ignore messages from the same source', () => {
    const handler = vi.fn();
    realtimeSync.on('message_added', handler);

    const event: DomainEvent = {
      type: 'message_added',
      payload: { id: 1, role: 'user', text: 'test' },
      timestamp: Date.now(),
    };

    const message = {
      type: 'sync_event',
      event,
      timestamp: Date.now(),
      sourceId: realtimeSync.getStats().sourceId, // Same source
    };

    const messageHandler = (mockBroadcastChannel.addEventListener as any).mock.calls[0][1];
    messageHandler({ data: message });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should provide statistics', () => {
    const stats = realtimeSync.getStats();
    
    expect(stats).toEqual({
      enabled: true,
      supported: true,
      sourceId: expect.any(String),
      channelName: 'broxeen_sync',
      activeHandlers: [],
      method: 'BroadcastChannel',
    });
  });

  it('should handle localStorage fallback for broadcasting', () => {
    // Make BroadcastChannel fail during broadcast
    mockBroadcastChannel.postMessage.mockImplementation(() => {
      throw new Error('Channel closed');
    });

    const event: DomainEvent = {
      type: 'message_added',
      payload: { id: 1, role: 'user', text: 'test' },
      timestamp: Date.now(),
    };

    realtimeSync.broadcast(event);

    expect(global.localStorage.setItem).toHaveBeenCalledWith(
      'broxeen_sync',
      expect.stringContaining('"type":"sync_event"')
    );
  });

  it('should handle storage events for fallback', () => {
    // Dispose the existing instance first
    realtimeSync.dispose();
    
    // Create a sync instance that uses localStorage fallback
    global.BroadcastChannel = vi.fn(() => {
      throw new Error('Not supported');
    }) as any;

    const sync = new RealtimeSync(DEFAULT_SYNC_CONFIG);
    const handler = vi.fn();
    sync.on('message_added', handler);

    const event: DomainEvent = {
      type: 'message_added',
      payload: { id: 1, role: 'user', text: 'test' },
      timestamp: Date.now(),
    };

    const message = {
      type: 'sync_event',
      event,
      timestamp: Date.now(),
      sourceId: 'different_source',
    };

    // Simulate storage event
    const storageHandler = (global.window.addEventListener as any).mock.calls[0][1];
    storageHandler({
      key: 'broxeen_sync',
      newValue: JSON.stringify(message),
    } as StorageEvent);

    expect(handler).toHaveBeenCalledWith(event);
    sync.dispose();
    
    // Recreate the default instance for other tests
    realtimeSync = new RealtimeSync(DEFAULT_SYNC_CONFIG);
  });

  it('should cleanup properly', () => {
    realtimeSync.dispose();
    
    expect(mockBroadcastChannel.close).toHaveBeenCalled();
    // window cleanup only happens when fallback is used
  });
});

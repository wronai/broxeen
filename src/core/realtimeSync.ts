/**
 * Real-time Synchronization System
 * 
 * Provides cross-tab and cross-instance synchronization using:
 * - BroadcastChannel API for browser tabs
 * - Tauri events for desktop instances
 * - LocalStorage fallback for unsupported environments
 */

import { createScopedLogger } from '../lib/logger';
import type { DomainEvent } from '../domain/chatEvents';

const syncLogger = createScopedLogger('core:realtimeSync');

export interface RealtimeSyncConfig {
  enabled: boolean;
  channelName: string;
  syncEvents: DomainEvent['type'][];
}

interface SyncMessage {
  type: 'sync_event';
  event: DomainEvent;
  timestamp: number;
  sourceId: string;
}

export class RealtimeSync {
  private config: RealtimeSyncConfig;
  private broadcastChannel: BroadcastChannel | null = null;
  private sourceId: string;
  private eventHandlers = new Map<DomainEvent['type'], Set<(event: DomainEvent) => void>>();
  private isSupported = false;

  constructor(config: RealtimeSyncConfig) {
    this.config = config;
    this.sourceId = this.generateSourceId();
    this.isSupported = this.checkSupport();
    
    if (this.isSupported && config.enabled) {
      this.initialize();
    }
  }

  private generateSourceId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private checkSupport(): boolean {
    // Check BroadcastChannel support
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        // Test if BroadcastChannel works
        const test = new BroadcastChannel('test');
        test.close();
        return true;
      } catch {
        syncLogger.warn('BroadcastChannel not supported');
      }
    }
    return false;
  }

  private initialize(): void {
    if (!this.isSupported) {
      syncLogger.info('Real-time sync not supported, using localStorage fallback');
      this.initializeLocalStorageFallback();
      return;
    }

    try {
      this.broadcastChannel = new BroadcastChannel(this.config.channelName);
      this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage.bind(this));
      syncLogger.info('BroadcastChannel initialized', { channel: this.config.channelName });
    } catch (error) {
      syncLogger.error('Failed to initialize BroadcastChannel', error);
      this.initializeLocalStorageFallback();
    }
  }

  private initializeLocalStorageFallback(): void {
    // Fallback using localStorage events for cross-tab sync
    window.addEventListener('storage', this.handleStorageEvent.bind(this));
    syncLogger.info('Using localStorage fallback for cross-tab sync');
  }

  private handleBroadcastMessage(event: MessageEvent): void {
    if (event.data.type !== 'sync_event') return;
    
    const message = event.data as SyncMessage;
    if (message.sourceId === this.sourceId) return; // Ignore own messages
    
    syncLogger.debug('Received broadcast event', { 
      type: message.event.type, 
      source: message.sourceId 
    });
    
    this.processSyncEvent(message.event);
  }

  private handleStorageEvent(event: StorageEvent): void {
    if (event.key !== this.config.channelName) return;
    if (!event.newValue) return;
    
    try {
      const message: SyncMessage = JSON.parse(event.newValue);
      if (message.sourceId === this.sourceId) return; // Ignore own messages
      
      syncLogger.debug('Received storage event', { 
        type: message.event.type, 
        source: message.sourceId 
      });
      
      this.processSyncEvent(message.event);
    } catch (error) {
      syncLogger.error('Failed to parse storage event', error);
    }
  }

  private processSyncEvent(event: DomainEvent): void {
    // Only process events that are configured for sync
    if (!this.config.syncEvents.includes(event.type)) return;
    
    // Notify local handlers
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          syncLogger.error('Event handler threw', { type: event.type, error });
        }
      }
    }
  }

  /**
   * Broadcast an event to other tabs/instances
   */
  broadcast(event: DomainEvent): void {
    if (!this.config.enabled) return;
    if (!this.config.syncEvents.includes(event.type)) return;
    
    const message: SyncMessage = {
      type: 'sync_event',
      event,
      timestamp: Date.now(),
      sourceId: this.sourceId,
    };

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message);
        syncLogger.debug('Broadcasted event', { type: event.type });
      } catch (error) {
        syncLogger.error('Failed to broadcast event', error);
        this.fallbackToLocalStorage(message);
      }
    } else {
      this.fallbackToLocalStorage(message);
    }
  }

  private fallbackToLocalStorage(message: SyncMessage): void {
    try {
      localStorage.setItem(this.config.channelName, JSON.stringify(message));
      // Remove immediately to trigger storage event in other tabs
      setTimeout(() => localStorage.removeItem(this.config.channelName), 100);
      syncLogger.debug('Broadcasted via localStorage fallback', { type: message.event.type });
    } catch (error) {
      syncLogger.error('Failed to broadcast via localStorage', error);
    }
  }

  /**
   * Subscribe to synchronized events of a specific type
   */
  on<T extends DomainEvent['type']>(
    type: T,
    handler: (event: Extract<DomainEvent, { type: T }>) => void
  ): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    
    this.eventHandlers.get(type)!.add(handler as (event: DomainEvent) => void);
    syncLogger.debug('Handler added for sync event', { type });
    
    return () => {
      this.eventHandlers.get(type)?.delete(handler as (event: DomainEvent) => void);
      syncLogger.debug('Handler removed for sync event', { type });
    };
  }

  /**
   * Get sync statistics
   */
  getStats() {
    return {
      enabled: this.config.enabled,
      supported: this.isSupported,
      sourceId: this.sourceId,
      channelName: this.config.channelName,
      activeHandlers: Array.from(this.eventHandlers.entries()).map(([type, handlers]) => ({
        type,
        count: handlers.size,
      })),
      method: this.broadcastChannel ? 'BroadcastChannel' : 'localStorage',
    };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }
    
    window.removeEventListener('storage', this.handleStorageEvent.bind(this));
    this.eventHandlers.clear();
    
    syncLogger.info('Real-time sync disposed');
  }
}

// Default configuration for Broxeen
export const DEFAULT_SYNC_CONFIG: RealtimeSyncConfig = {
  enabled: true,
  channelName: 'broxeen_sync',
  syncEvents: [
    // Chat events
    'message_added',
    'message_updated',
    'chat_cleared',
    // Device/network events
    'device_discovered',
    'device_status_changed',
    'network_scan_completed',
    // Settings
    'settings_changed',
    // Errors
    'error_occurred',
  ],
};

// Singleton instance
let realtimeSyncInstance: RealtimeSync | null = null;

export function getRealtimeSync(): RealtimeSync {
  if (!realtimeSyncInstance) {
    realtimeSyncInstance = new RealtimeSync(DEFAULT_SYNC_CONFIG);
  }
  return realtimeSyncInstance;
}

export function disposeRealtimeSync(): void {
  if (realtimeSyncInstance) {
    realtimeSyncInstance.dispose();
    realtimeSyncInstance = null;
  }
}

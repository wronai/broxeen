/**
 * Central Cache System for Broxeen
 * 
 * Provides intelligent caching with TTL, size limits, and automatic cleanup.
 * Supports different cache strategies for different use cases.
 */

import { createScopedLogger } from '../lib/logger';

const cacheLogger = createScopedLogger('core:cache');

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
  accessCount: number;
  lastAccessed: number;
}

export interface CacheConfig {
  maxSize: number; // Maximum number of entries
  defaultTtl?: number; // Default TTL in milliseconds
  cleanupInterval?: number; // Cleanup interval in milliseconds
  strategy: 'lru' | 'lfu' | 'fifo'; // Eviction strategy
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  memoryUsage: number; // Estimated memory usage in bytes
  oldestEntry?: number;
  newestEntry?: number;
}

/**
 * Generic cache with configurable eviction strategies and TTL
 */
export class Cache<K, V> {
  private entries = new Map<K, CacheEntry<V>>();
  private accessOrder = new Map<K, number>(); // For LRU
  private frequency = new Map<K, number>(); // For LFU
  private insertionOrder = new Map<K, number>(); // For FIFO
  private accessCounter = 0;
  private insertionCounter = 0;
  private hits = 0;
  private misses = 0;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private config: CacheConfig) {
    // Start cleanup timer
    if (config.cleanupInterval && config.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, config.cleanupInterval);
    }
  }

  /**
   * Get a value from cache
   */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.accessOrder.set(key, ++this.accessCounter);
    this.frequency.set(key, (this.frequency.get(key) || 0) + 1);
    this.hits++;

    cacheLogger.debug('Cache hit', { key: String(key), accessCount: entry.accessCount });
    return entry.value;
  }

  /**
   * Set a value in cache
   */
  set(key: K, value: V, ttl?: number): void {
    // Check if we need to evict
    if (this.entries.size >= this.config.maxSize && !this.entries.has(key)) {
      this.evict();
    }

    const entry: CacheEntry<V> = {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.config.defaultTtl,
      accessCount: 1,
      lastAccessed: Date.now(),
    };

    this.entries.set(key, entry);
    this.accessOrder.set(key, ++this.accessCounter);
    this.frequency.set(key, 1);
    this.insertionOrder.set(key, ++this.insertionCounter);

    cacheLogger.debug('Cache set', { key: String(key), ttl: entry.ttl });
  }

  /**
   * Delete a value from cache
   */
  delete(key: K): boolean {
    const deleted = this.entries.delete(key);
    if (deleted) {
      this.accessOrder.delete(key);
      this.frequency.delete(key);
      this.insertionOrder.delete(key);
      cacheLogger.debug('Cache delete', { key: String(key) });
    }
    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;

    // Check TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.accessOrder.clear();
    this.frequency.clear();
    this.insertionOrder.clear();
    this.accessCounter = 0;
    this.insertionCounter = 0;
    this.hits = 0;
    this.misses = 0;
    cacheLogger.info('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const now = Date.now();
    let oldestTimestamp: number | undefined;
    let newestTimestamp: number | undefined;
    let memoryUsage = 0;

    for (const [key, entry] of this.entries) {
      if (!oldestTimestamp || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (!newestTimestamp || entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }

      // Rough memory estimation
      memoryUsage += this.estimateEntrySize(key, entry);
    }

    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

    return {
      size: this.entries.size,
      maxSize: this.config.maxSize,
      hitRate,
      totalHits: this.hits,
      totalMisses: this.misses,
      memoryUsage,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp,
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): K[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get entries as array (for debugging)
   */
  entriesArray(): Array<[K, CacheEntry<V>]> {
    return Array.from(this.entries.entries());
  }

  /**
   * Evict entries based on strategy
   */
  private evict(): void {
    if (this.entries.size === 0) return;

    let keyToEvict: K | undefined;

    switch (this.config.strategy) {
      case 'lru':
        keyToEvict = this.findLRUKey();
        break;
      case 'lfu':
        keyToEvict = this.findLFUKey();
        break;
      case 'fifo':
        keyToEvict = this.findFIFOKey();
        break;
    }

    if (keyToEvict !== undefined) {
      this.delete(keyToEvict);
      cacheLogger.debug('Cache evicted', { key: String(keyToEvict), strategy: this.config.strategy });
    }
  }

  private findLRUKey(): K | undefined {
    let oldestKey: K | undefined;
    let oldestAccess = Infinity;

    for (const [key, accessTime] of this.accessOrder) {
      if (accessTime < oldestAccess) {
        oldestAccess = accessTime;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  private findLFUKey(): K | undefined {
    let leastUsedKey: K | undefined;
    let lowestFrequency = Infinity;

    for (const [key, frequency] of this.frequency) {
      if (frequency < lowestFrequency) {
        lowestFrequency = frequency;
        leastUsedKey = key;
      }
    }

    return leastUsedKey;
  }

  private findFIFOKey(): K | undefined {
    let oldestKey: K | undefined;
    let oldestInsertion = Infinity;

    for (const [key, insertionTime] of this.insertionOrder) {
      if (insertionTime < oldestInsertion) {
        oldestInsertion = insertionTime;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: K[] = [];

    for (const [key, entry] of this.entries) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
    }

    if (keysToDelete.length > 0) {
      cacheLogger.debug('Cache cleanup', { deleted: keysToDelete.length });
    }
  }

  /**
   * Rough estimation of entry size in bytes
   */
  private estimateEntrySize(key: K, entry: CacheEntry<V>): number {
    try {
      const keySize = JSON.stringify(key).length * 2; // Rough UTF-16 estimation
      const valueSize = JSON.stringify(entry.value).length * 2;
      const metadataSize = 64; // Rough estimation for timestamps and counters
      return keySize + valueSize + metadataSize;
    } catch {
      return 1024; // Fallback estimation
    }
  }

  /**
   * Dispose cache and cleanup timers
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
    cacheLogger.info('Cache disposed');
  }
}

/**
 * Cache factory with predefined configurations
 */
export class CacheFactory {
  private static caches = new Map<string, Cache<any, any>>();

  /**
   * Create or get a cache with predefined configuration
   */
  static create<K, V>(
    name: string,
    config: Partial<CacheConfig> = {}
  ): Cache<K, V> {
    if (this.caches.has(name)) {
      return this.caches.get(name)!;
    }

    const defaultConfig: CacheConfig = {
      maxSize: 100,
      defaultTtl: 5 * 60 * 1000, // 5 minutes
      cleanupInterval: 60 * 1000, // 1 minute
      strategy: 'lru',
      ...config,
    };

    const cache = new Cache<K, V>(defaultConfig);
    this.caches.set(name, cache);
    cacheLogger.info('Cache created', { name, config: defaultConfig });

    return cache;
  }

  /**
   * Get existing cache
   */
  static get<K, V>(name: string): Cache<K, V> | undefined {
    return this.caches.get(name);
  }

  /**
   * Delete cache
   */
  static delete(name: string): boolean {
    const cache = this.caches.get(name);
    if (cache) {
      cache.dispose();
      this.caches.delete(name);
      cacheLogger.info('Cache deleted', { name });
      return true;
    }
    return false;
  }

  /**
   * Get statistics for all caches
   */
  static getAllStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    for (const [name, cache] of this.caches) {
      stats[name] = cache.getStats();
    }
    return stats;
  }

  /**
   * Clear all caches
   */
  static clearAll(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
    cacheLogger.info('All caches cleared');
  }

  /**
   * Dispose all caches
   */
  static disposeAll(): void {
    for (const cache of this.caches.values()) {
      cache.dispose();
    }
    this.caches.clear();
    cacheLogger.info('All caches disposed');
  }
}

/**
 * Predefined cache configurations for different use cases
 */
export const CACHE_CONFIGS = {
  // Network scan results - longer TTL, larger size
  NETWORK_SCAN: {
    maxSize: 50,
    defaultTtl: 10 * 60 * 1000, // 10 minutes
    cleanupInterval: 2 * 60 * 1000, // 2 minutes
    strategy: 'lru' as const,
  },
  
  // Plugin results - medium TTL, medium size
  PLUGIN_RESULTS: {
    maxSize: 100,
    defaultTtl: 5 * 60 * 1000, // 5 minutes
    cleanupInterval: 60 * 1000, // 1 minute
    strategy: 'lru' as const,
  },
  
  // API responses - short TTL, many entries
  API_RESPONSES: {
    maxSize: 200,
    defaultTtl: 2 * 60 * 1000, // 2 minutes
    cleanupInterval: 30 * 1000, // 30 seconds
    strategy: 'lfu' as const,
  },
  
  // File search results - medium TTL, small size
  FILE_SEARCH: {
    maxSize: 20,
    defaultTtl: 3 * 60 * 1000, // 3 minutes
    cleanupInterval: 60 * 1000, // 1 minute
    strategy: 'fifo' as const,
  },
};

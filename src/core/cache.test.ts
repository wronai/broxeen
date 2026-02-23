import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cache, CacheFactory, CACHE_CONFIGS } from './cache';

describe('Cache', () => {
  let cache: Cache<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new Cache<string, string>({
      maxSize: 3,
      defaultTtl: 1000, // 1 second
      cleanupInterval: 0, // Disable auto cleanup for tests
      strategy: 'lru',
    });
  });

  afterEach(() => {
    cache.dispose();
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should respect TTL', () => {
    cache.set('key1', 'value1', 50); // 50ms TTL
    expect(cache.get('key1')).toBe('value1');
    
    // Wait for expiration
    vi.advanceTimersByTime(60);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should handle has() correctly', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('missing')).toBe(false);
  });

  it('should delete entries', () => {
    cache.set('key1', 'value1');
    expect(cache.delete('key1')).toBe(true);
    expect(cache.delete('key1')).toBe(false);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('should clear all entries', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.getStats().size).toBe(0);
  });

  it('should evict LRU entries when full', () => {
    // Fill cache to capacity
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');
    
    // Access key1 and key2 to make them recently used
    cache.get('key1');
    cache.get('key2');
    
    // Add new entry - should evict key3 (least recently used)
    cache.set('key4', 'value4');
    
    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBe('value2');
    expect(cache.get('key3')).toBeUndefined(); // Evicted
    expect(cache.get('key4')).toBe('value4');
  });

  it('should evict LFU entries when using LFU strategy', () => {
    const lfuCache = new Cache<string, string>({
      maxSize: 3,
      strategy: 'lfu',
      cleanupInterval: 0,
    });

    // Fill cache
    lfuCache.set('key1', 'value1');
    lfuCache.set('key2', 'value2');
    lfuCache.set('key3', 'value3');
    
    // Access key1 multiple times to increase frequency
    lfuCache.get('key1');
    lfuCache.get('key1');
    lfuCache.get('key1');
    
    // Access key2 once
    lfuCache.get('key2');
    
    // Add new entry - should evict key3 (least frequently used)
    lfuCache.set('key4', 'value4');
    
    expect(lfuCache.get('key1')).toBe('value1');
    expect(lfuCache.get('key2')).toBe('value2');
    expect(lfuCache.get('key3')).toBeUndefined(); // Evicted
    expect(lfuCache.get('key4')).toBe('value4');
    
    lfuCache.dispose();
  });

  it('should evict FIFO entries when using FIFO strategy', () => {
    const fifoCache = new Cache<string, string>({
      maxSize: 3,
      strategy: 'fifo',
      cleanupInterval: 0,
    });

    // Fill cache
    fifoCache.set('key1', 'value1');
    fifoCache.set('key2', 'value2');
    fifoCache.set('key3', 'value3');
    
    // Add new entry - should evict key1 (first inserted)
    fifoCache.set('key4', 'value4');
    
    expect(fifoCache.get('key1')).toBeUndefined(); // Evicted
    expect(fifoCache.get('key2')).toBe('value2');
    expect(fifoCache.get('key3')).toBe('value3');
    expect(fifoCache.get('key4')).toBe('value4');
    
    fifoCache.dispose();
  });

  it('should provide accurate statistics', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    
    // Generate some hits and misses
    cache.get('key1'); // hit
    cache.get('key2'); // hit
    cache.get('missing'); // miss
    
    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(3);
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBe(2/3);
    expect(stats.memoryUsage).toBeGreaterThan(0);
    expect(stats.oldestEntry).toBeDefined();
    expect(stats.newestEntry).toBeDefined();
  });

  it('should cleanup expired entries', () => {
    cache.set('key1', 'value1', 50); // Will expire
    cache.set('key2', 'value2', 200); // Won't expire
    
    // Wait for first entry to expire
    vi.advanceTimersByTime(60);
    
    // Manually trigger cleanup by accessing expired entry
    cache.get('key1'); // This should trigger cleanup of expired entry
    
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });
});

describe('CacheFactory', () => {
  afterEach(() => {
    CacheFactory.disposeAll();
  });

  it('should create and reuse caches', () => {
    const cache1 = CacheFactory.create<string, string>('test-cache');
    const cache2 = CacheFactory.create<string, string>('test-cache');
    
    expect(cache1).toBe(cache2); // Same instance
  });

  it('should create separate caches for different names', () => {
    const cache1 = CacheFactory.create<string, string>('cache1');
    const cache2 = CacheFactory.create<string, string>('cache2');
    
    expect(cache1).not.toBe(cache2);
  });

  it('should use predefined configurations', () => {
    const networkCache = CacheFactory.create<string, any>('network', CACHE_CONFIGS.NETWORK_SCAN);
    const stats = networkCache.getStats();
    
    expect(stats.maxSize).toBe(CACHE_CONFIGS.NETWORK_SCAN.maxSize);
    
    networkCache.dispose();
  });

  it('should merge custom configurations with defaults', () => {
    const customCache = CacheFactory.create<string, string>('custom', {
      maxSize: 50,
      strategy: 'fifo',
    });
    
    const stats = customCache.getStats();
    expect(stats.maxSize).toBe(50);
    // Should use default TTL and other settings
    
    customCache.dispose();
  });

  it('should get existing caches', () => {
    const cache1 = CacheFactory.create<string, string>('test');
    const cache2 = CacheFactory.get<string, string>('test');
    
    expect(cache1).toBe(cache2);
    expect(CacheFactory.get('nonexistent')).toBeUndefined();
  });

  it('should delete caches', () => {
    const cache = CacheFactory.create<string, string>('test');
    expect(CacheFactory.get('test')).toBeDefined();
    
    expect(CacheFactory.delete('test')).toBe(true);
    expect(CacheFactory.get('test')).toBeUndefined();
    expect(CacheFactory.delete('nonexistent')).toBe(false);
  });

  it('should provide statistics for all caches', () => {
    CacheFactory.create<string, string>('cache1');
    CacheFactory.create<string, string>('cache2');
    
    const allStats = CacheFactory.getAllStats();
    expect(Object.keys(allStats)).toContain('cache1');
    expect(Object.keys(allStats)).toContain('cache2');
  });

  it('should clear all caches', () => {
    const cache1 = CacheFactory.create<string, string>('cache1');
    const cache2 = CacheFactory.create<string, string>('cache2');
    
    cache1.set('key1', 'value1');
    cache2.set('key2', 'value2');
    
    CacheFactory.clearAll();
    
    expect(cache1.get('key1')).toBeUndefined();
    expect(cache2.get('key2')).toBeUndefined();
  });

  it('should dispose all caches', () => {
    CacheFactory.create<string, string>('cache1');
    CacheFactory.create<string, string>('cache2');
    
    CacheFactory.disposeAll();
    
    expect(CacheFactory.get('cache1')).toBeUndefined();
    expect(CacheFactory.get('cache2')).toBeUndefined();
  });
});

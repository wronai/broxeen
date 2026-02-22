/**
 * Watch Configuration - defines parameters for reactive monitoring
 * Configurable thresholds, intervals, and time windows
 */

import type { WatchConfig } from '../reactive/types';
import type { AutoWatchConfig } from '../integration/autoWatchIntegration';
import type { NetworkScannerConfig } from '../discovery/types';
import type { ServiceProberConfig } from '../discovery/types';
import type { DatabaseConfig } from '../persistence/types';

/**
 * Default watch manager configuration
 */
export const defaultWatchConfig: WatchConfig = {
  defaultDurationMs: 3600000, // 1 hour
  defaultPollIntervalMs: 30000, // 30 seconds
  defaultChangeThreshold: 0.15, // 15% change
  maxConcurrentWatches: 50,
  cleanupIntervalMs: 300000 // 5 minutes
};

/**
 * Default auto-watch integration configuration
 */
export const defaultAutoWatchConfig: AutoWatchConfig = {
  enabled: true,
  timeWindowMs: 3600000, // Look back 1 hour for recent queries
  watchDurationMs: 3600000, // Watch for 1 hour after query
  intentsToWatch: [
    'camera:describe',
    'device:status',
    'service:describe',
    'http:describe',
    'rtsp:describe',
    'mqtt:describe',
    'api:describe'
  ],
  excludePatterns: [
    'test',
    'demo',
    'przykład',
    'example'
  ]
};

/**
 * Default network scanner configuration
 */
export const defaultNetworkScannerConfig: NetworkScannerConfig = {
  scanMethods: ['ping', 'mdns'],
  timeout: 5000,
  maxConcurrent: 10,
  excludeRanges: ['127.0.0.0/8', '169.254.0.0/16']
};

/**
 * Default service prober configuration
 */
export const defaultServiceProberConfig: ServiceProberConfig = {
  ports: {
    http: [80, 8080, 8000, 3000, 5000],
    rtsp: [554, 8554],
    mqtt: [1883, 9001],
    ssh: [22, 2222],
    api: [8001, 3001, 5001, 8081]
  },
  timeout: 3000,
  maxConcurrent: 5,
  retryAttempts: 2
};

/**
 * Default database configuration
 */
export const defaultDatabaseConfig: DatabaseConfig = {
  devicesDbPath: 'data/devices.db',
  chatDbPath: 'data/chat.db',
  walMode: true,
  connectionPoolSize: 5
};

/**
 * Service-specific polling intervals (in milliseconds)
 */
export const servicePollIntervals = {
  camera: 30000, // 30 seconds for cameras
  http: 60000, // 1 minute for HTTP services
  rtsp: 15000, // 15 seconds for RTSP streams
  mqtt: 120000, // 2 minutes for MQTT topics
  api: 30000, // 30 seconds for API endpoints
  device: 60000 // 1 minute for device status
};

/**
 * Service-specific change thresholds (0.0 - 1.0)
 */
export const serviceChangeThresholds = {
  camera: 0.1, // 10% for camera images (sensitive)
  http: 0.2, // 20% for HTTP content
  rtsp: 0.15, // 15% for RTSP streams
  mqtt: 0.3, // 30% for MQTT data
  api: 0.25, // 25% for API responses
  device: 0.2 // 20% for device status
};

/**
 * Environment-specific configurations
 */
export const environmentConfigs = {
  development: {
    watchConfig: {
      ...defaultWatchConfig,
      defaultPollIntervalMs: 10000, // 10 seconds for faster testing
      cleanupIntervalMs: 60000 // 1 minute for faster cleanup
    },
    autoWatchConfig: {
      ...defaultAutoWatchConfig,
      timeWindowMs: 300000, // 5 minutes for testing
      watchDurationMs: 300000 // 5 minutes for testing
    }
  },
  
  production: {
    watchConfig: defaultWatchConfig,
    autoWatchConfig: defaultAutoWatchConfig
  },
  
  testing: {
    watchConfig: {
      ...defaultWatchConfig,
      defaultPollIntervalMs: 1000, // 1 second for rapid testing
      defaultDurationMs: 10000, // 10 seconds for quick tests
      cleanupIntervalMs: 5000 // 5 seconds for quick cleanup
    },
    autoWatchConfig: {
      ...defaultAutoWatchConfig,
      timeWindowMs: 60000, // 1 minute for testing
      watchDurationMs: 60000 // 1 minute for testing
    }
  }
};

/**
 * Get configuration for current environment
 */
export function getWatchConfig(): WatchConfig {
  const env = import.meta.env.MODE || 'development';
  return environmentConfigs[env as keyof typeof environmentConfigs]?.watchConfig || defaultWatchConfig;
}

/**
 * Get auto-watch configuration for current environment
 */
export function getAutoWatchConfig(): AutoWatchConfig {
  const env = import.meta.env.MODE || 'development';
  return environmentConfigs[env as keyof typeof environmentConfigs]?.autoWatchConfig || defaultAutoWatchConfig;
}

/**
 * Get polling interval for specific service type
 */
export function getPollingInterval(serviceType: keyof typeof servicePollIntervals): number {
  return servicePollIntervals[serviceType] || defaultWatchConfig.defaultPollIntervalMs;
}

/**
 * Get change threshold for specific service type
 */
export function getChangeThreshold(serviceType: keyof typeof serviceChangeThresholds): number {
  return serviceChangeThresholds[serviceType] || defaultWatchConfig.defaultChangeThreshold;
}

/**
 * Configuration validation
 */
export function validateWatchConfig(config: Partial<WatchConfig>): string[] {
  const errors: string[] = [];
  
  if (config.defaultDurationMs !== undefined && config.defaultDurationMs < 60000) {
    errors.push('defaultDurationMs must be at least 60 seconds');
  }
  
  if (config.defaultPollIntervalMs !== undefined && config.defaultPollIntervalMs < 1000) {
    errors.push('defaultPollIntervalMs must be at least 1 second');
  }
  
  if (config.defaultChangeThreshold !== undefined && (config.defaultChangeThreshold < 0 || config.defaultChangeThreshold > 1)) {
    errors.push('defaultChangeThreshold must be between 0 and 1');
  }
  
  if (config.maxConcurrentWatches !== undefined && config.maxConcurrentWatches < 1) {
    errors.push('maxConcurrentWatches must be at least 1');
  }
  
  if (config.cleanupIntervalMs !== undefined && config.cleanupIntervalMs < 30000) {
    errors.push('cleanupIntervalMs must be at least 30 seconds');
  }
  
  return errors;
}

/**
 * Configuration merge utility
 */
export function mergeWatchConfig(base: WatchConfig, override: Partial<WatchConfig>): WatchConfig {
  return {
    ...base,
    ...override
  };
}

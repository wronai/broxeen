/**
 * Health Check System - Diagnostyka przed uruchomieniem
 * Sprawdza kluczowe zależności i konfigurację
 */

import { logger } from "../lib/logger";

const healthLogger = logger.scope("health:check");

export interface HealthCheckResult {
  status: 'healthy' | 'warning' | 'error';
  category: 'runtime' | 'network' | 'browser' | 'tauri' | 'dependencies';
  name: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  timestamp: number;
}

class HealthChecker {
  private checks: Array<() => Promise<HealthCheckResult>> = [];

  constructor() {
    this.registerDefaultChecks();
  }

  private registerDefaultChecks() {
    // Runtime checks - only in Node.js environment
    this.addCheck('runtime', 'node-version', async () => {
      if (typeof window !== 'undefined') {
        return {
          status: 'warning',
          category: 'runtime',
          name: 'node-version',
          message: 'Running in browser environment - Node.js unavailable',
          details: { environment: 'browser' }
        };
      }

      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0]);
      
      return {
        status: major >= 18 ? 'healthy' : 'warning',
        category: 'runtime',
        name: 'node-version',
        message: `Node.js ${version}`,
        details: { version, major, supported: major >= 18 }
      };
    });

    this.addCheck('runtime', 'platform', async () => {
      if (typeof window !== 'undefined') {
        return {
          status: 'healthy',
          category: 'runtime',
          name: 'platform',
          message: `Platform: ${navigator.platform}`,
          details: { platform: navigator.platform, environment: 'browser' }
        };
      }

      const platform = process.platform;
      const arch = process.arch;
      
      return {
        status: ['linux', 'darwin', 'win32'].includes(platform) ? 'healthy' : 'warning',
        category: 'runtime',
        name: 'platform',
        message: `Platform: ${platform}-${arch}`,
        details: { platform, arch }
      };
    });

    // Browser API checks
    this.addCheck('browser', 'speech-api', async () => {
      if (typeof window === 'undefined') {
        return {
          status: 'warning',
          category: 'browser',
          name: 'speech-api',
          message: 'Running in server environment - Speech API unavailable',
          details: { environment: 'server' }
        };
      }

      const speechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      const speechSynthesis = !!window.speechSynthesis;

      if (speechRecognition && speechSynthesis) {
        return {
          status: 'healthy',
          category: 'browser',
          name: 'speech-api',
          message: 'Speech APIs available',
          details: { speechRecognition, speechSynthesis }
        };
      } else {
        return {
          status: 'warning',
          category: 'browser',
          name: 'speech-api',
          message: 'Limited Speech API support',
          details: { 
            speechRecognition, 
            speechSynthesis,
            platform: typeof window !== 'undefined' ? navigator.platform : 'unknown',
            note: typeof window !== 'undefined' && navigator.platform.toLowerCase().includes('linux') ? 'Tauri Linux does not support Web Speech API' : undefined
          }
        };
      }
    });

    // Network checks
    this.addCheck('network', 'localhost', async () => {
      try {
        const response = await fetch('http://localhost:5173', { 
          method: 'HEAD',
          signal: AbortSignal.timeout(3000)
        });
        
        return {
          status: response.ok ? 'healthy' : 'warning',
          category: 'network',
          name: 'localhost',
          message: `Development server responding (${response.status})`,
          details: { status: response.status, ok: response.ok }
        };
      } catch (error) {
        return {
          status: 'error',
          category: 'network',
          name: 'localhost',
          message: 'Development server not responding',
          details: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    });

    // Tauri checks
    this.addCheck('tauri', 'runtime', async () => {
      if (typeof window === 'undefined') {
        return {
          status: 'warning',
          category: 'tauri',
          name: 'runtime',
          message: 'Running in browser mode - Tauri unavailable',
          details: { environment: 'browser' }
        };
      }

      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Test basic Tauri functionality
        await invoke('get_app_version');
        
        return {
          status: 'healthy',
          category: 'tauri',
          name: 'runtime',
          message: 'Tauri runtime available',
          details: { environment: 'tauri' }
        };
      } catch (error) {
        return {
          status: 'error',
          category: 'tauri',
          name: 'runtime',
          message: 'Tauri runtime unavailable',
          details: { error: error instanceof Error ? error.message : String(error) }
        };
      }
    });

    // Dependencies
    this.addCheck('dependencies', 'critical-modules', async () => {
      const criticalModules = [
        '@tauri-apps/api/core',
        'react',
        'react-dom'
      ];

      const results: Record<string, boolean> = {};
      let allAvailable = true;

      for (const module of criticalModules) {
        try {
          await import(/* @vite-ignore */ module);
          results[module] = true;
        } catch (error) {
          results[module] = false;
          allAvailable = false;
        }
      }

      return {
        status: allAvailable ? 'healthy' : 'error',
        category: 'dependencies',
        name: 'critical-modules',
        message: allAvailable ? 'All critical modules available' : 'Missing critical modules',
        details: { modules: results, allAvailable }
      };
    });
  }

  addCheck(category: HealthCheckResult['category'], name: string, check: () => Promise<HealthCheckResult>) {
    this.checks.push(async () => {
      try {
        const result = await check();
        healthLogger.info(`Health check completed: ${name}`, { 
          status: result.status, 
          category: result.category 
        });
        return result;
      } catch (error) {
        healthLogger.error(`Health check failed: ${name}`, { error });
        return {
          status: 'error',
          category,
          name,
          message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
          details: { error: error instanceof Error ? error.stack : String(error) }
        };
      }
    });
  }

  async runChecks(): Promise<HealthReport> {
    healthLogger.info('Starting health check suite');
    
    const results = await Promise.allSettled(
      this.checks.map(check => check())
    );

    const checks: HealthCheckResult[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled') {
        checks.push(result.value);
      } else {
        checks.push({
          status: 'error',
          category: 'runtime',
          name: 'health-check-error',
          message: 'Health check system error',
          details: { error: result.reason }
        });
      }
    }

    const errorCount = checks.filter(c => c.status === 'error').length;
    const warningCount = checks.filter(c => c.status === 'warning').length;

    let overall: HealthReport['overall'];
    if (errorCount > 0) {
      overall = 'unhealthy';
    } else if (warningCount > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    healthLogger.info('Health check completed', { 
      overall, 
      total: checks.length, 
      errors: errorCount, 
      warnings: warningCount 
    });

    return {
      overall,
      checks,
      timestamp: Date.now()
    };
  }

  async runQuickCheck(): Promise<HealthReport['overall']> {
    // Quick check for critical issues only
    const report = await this.runChecks();
    
    // Check for critical errors
    const criticalErrors = report.checks.filter(c => 
      c.status === 'error' && 
      ['runtime', 'dependencies'].includes(c.category)
    );

    return criticalErrors.length > 0 ? 'unhealthy' : report.overall;
  }
}

// Global health checker instance
export const healthChecker = new HealthChecker();

// Convenience functions
export const runHealthCheck = () => healthChecker.runChecks();
export const runQuickHealthCheck = () => healthChecker.runQuickCheck();

// Auto-run health check on module import (development only)
if (import.meta.env.DEV) {
  runQuickHealthCheck().then(status => {
    if (status === 'unhealthy') {
      healthLogger.warn('Application health check failed - some features may not work');
    } else if (status === 'degraded') {
      healthLogger.info('Application health check passed with warnings');
    } else {
      healthLogger.info('Application health check passed');
    }
  }).catch(error => {
    healthLogger.error('Health check system failed', { error });
  });
}

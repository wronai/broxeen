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
          message: 'Running in browser/Tauri environment - Node.js unavailable',
          details: { environment: typeof window !== 'undefined' && (window as any).__TAURI__ ? 'tauri' : 'browser' }
        };
      }

      // In Node.js environment, process should be available
      try {
        const version = process.version;
        const major = parseInt(version.slice(1).split('.')[0]);
        
        return {
          status: major >= 18 ? 'healthy' : 'warning',
          category: 'runtime',
          name: 'node-version',
          message: `Node.js ${version}`,
          details: { version, major, supported: major >= 18 }
        };
      } catch (error) {
        return {
          status: 'error',
          category: 'runtime',
          name: 'node-version',
          message: 'Process object not available',
          details: { environment: 'unknown', error: error instanceof Error ? error.message : String(error) }
        };
      }
    });

    this.addCheck('runtime', 'platform', async () => {
      if (typeof window !== 'undefined') {
        return {
          status: 'healthy',
          category: 'runtime',
          name: 'platform',
          message: `Platform: ${navigator.platform}`,
          details: { platform: navigator.platform, environment: typeof window !== 'undefined' && (window as any).__TAURI__ ? 'tauri' : 'browser' }
        };
      }

      // In Node.js environment, process should be available
      try {
        const platform = process.platform;
        const arch = process.arch;
        
        return {
          status: ['linux', 'darwin', 'win32'].includes(platform) ? 'healthy' : 'warning',
          category: 'runtime',
          name: 'platform',
          message: `Platform: ${platform}-${arch}`,
          details: { platform, arch }
        };
      } catch (error) {
        return {
          status: 'error',
          category: 'runtime',
          name: 'platform',
          message: 'Process object not available',
          details: { environment: 'unknown', error: error instanceof Error ? error.message : String(error) }
        };
      }
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

      // Check if process is available before accessing it (for Tauri compatibility)
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
      
      const speechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      const speechSynthesis = !!window.speechSynthesis;

      if (speechRecognition && speechSynthesis) {
        return {
          status: 'healthy',
          category: 'browser',
          name: 'speech-api',
          message: 'Speech APIs available',
          details: { speechRecognition, speechSynthesis, environment: isTauri ? 'tauri' : 'browser' }
        };
      } else {
        return {
          status: 'warning',
          category: 'browser',
          name: 'speech-api',
          message: isTauri ? 'Speech APIs not available in Tauri Linux' : 'Limited Speech API support',
          details: { 
            speechRecognition, 
            speechSynthesis,
            platform: navigator.platform,
            environment: isTauri ? 'tauri' : 'browser',
            note: isTauri && navigator.platform.toLowerCase().includes('linux') ? 'Tauri Linux does not support Web Speech API natively' : undefined
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

      const isTauri = !!(window as any).__TAURI__;
      if (!isTauri) {
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
        // Test basic Tauri functionality - use get_settings instead of get_app_version
        await invoke('get_settings');
        
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
          details: { 
            error: error instanceof Error ? error.message : String(error),
            environment: 'tauri'
          }
        };
      }
    });

    // Dependencies
    this.addCheck('dependencies', 'critical-modules', async () => {
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;
      
      // In Tauri, check modules differently - exclude better-sqlite3 from browser checks
      if (isTauri) {
        try {
          // Check if React is available globally
          const reactAvailable = typeof (window as any).React !== 'undefined' || 
                                await import('react').then(() => true).catch(() => false);
          
          const tauriAvailable = await import('@tauri-apps/api/core').then(() => true).catch(() => false);
          
          const results = {
            '@tauri-apps/api/core': tauriAvailable,
            'react': reactAvailable,
            'react-dom': reactAvailable // React-dom usually comes with react
          };
          
          const allAvailable = Object.values(results).every(Boolean);
          
          return {
            status: allAvailable ? 'healthy' : 'warning',
            category: 'dependencies',
            name: 'critical-modules',
            message: allAvailable ? 'All critical modules available' : 'Some modules may not be available in Tauri context',
            details: { modules: results, allAvailable, environment: 'tauri' }
          };
        } catch (error) {
          return {
            status: 'warning',
            category: 'dependencies',
            name: 'critical-modules',
            message: 'Could not verify modules in Tauri context',
            details: { error: error instanceof Error ? error.message : String(error), environment: 'tauri' }
          };
        }
      }
      
      // Browser/Node.js environment - only check browser-compatible modules
      const criticalModules = [
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
        status: allAvailable ? 'healthy' : 'warning',
        category: 'dependencies',
        name: 'critical-modules',
        message: allAvailable ? 'All critical modules available' : 'Some modules unavailable in browser context',
        details: { modules: results, allAvailable, environment: 'browser' }
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

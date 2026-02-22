/**
 * Health Check System Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { healthChecker, runHealthCheck, runQuickHealthCheck } from './healthCheck';

describe('Health Check System', () => {
  beforeEach(() => {
    // Mock console methods to avoid test output pollution
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Runtime Checks', () => {
    it('should check Node.js version', async () => {
      const report = await healthChecker.runChecks();
      const nodeCheck = report.checks.find(c => c.name === 'node-version');
      
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck?.category).toBe('runtime');
      expect(nodeCheck?.status).toBe('healthy'); // Assuming Node.js >= 18
      expect(nodeCheck?.message).toContain('Node.js');
    });

    it('should check platform', async () => {
      const report = await healthChecker.runChecks();
      const platformCheck = report.checks.find(c => c.name === 'platform');
      
      expect(platformCheck).toBeDefined();
      expect(platformCheck?.category).toBe('runtime');
      expect(['healthy', 'warning']).toContain(platformCheck?.status);
      expect(platformCheck?.message).toContain('Platform:');
    });
  });

  describe('Browser API Checks', () => {
    it('should handle server environment gracefully', async () => {
      // Mock window as undefined (server environment)
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;

      const report = await healthChecker.runChecks();
      const speechCheck = report.checks.find(c => c.name === 'speech-api');
      
      expect(speechCheck).toBeDefined();
      expect(speechCheck?.category).toBe('browser');
      expect(speechCheck?.status).toBe('warning');
      expect(speechCheck?.message).toContain('server environment');

      // Restore window
      global.window = originalWindow;
    });

    it('should check speech APIs in browser environment', async () => {
      // Mock browser environment
      global.window = {
        SpeechRecognition: vi.fn(),
        webkitSpeechRecognition: vi.fn(),
        speechSynthesis: {}
      } as any;

      const report = await healthChecker.runChecks();
      const speechCheck = report.checks.find(c => c.name === 'speech-api');
      
      expect(speechCheck).toBeDefined();
      expect(speechCheck?.status).toBe('healthy');
      expect(speechCheck?.message).toBe('Speech APIs available');
    });

    it('should detect missing speech APIs', async () => {
      // Mock browser without speech APIs
      global.window = {} as any;

      const report = await healthChecker.runChecks();
      const speechCheck = report.checks.find(c => c.name === 'speech-api');
      
      expect(speechCheck).toBeDefined();
      expect(speechCheck?.status).toBe('warning');
      expect(speechCheck?.message).toBe('Limited Speech API support');
    });
  });

  describe('Network Checks', () => {
    it('should check localhost connectivity', async () => {
      // Mock fetch to simulate successful connection
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200
      }) as any;

      const report = await healthChecker.runChecks();
      const networkCheck = report.checks.find(c => c.name === 'localhost');
      
      expect(networkCheck).toBeDefined();
      expect(networkCheck?.category).toBe('network');
      expect(networkCheck?.status).toBe('healthy');
      expect(networkCheck?.message).toContain('Development server responding');
    });

    it('should handle connection failures', async () => {
      // Mock fetch to simulate connection failure
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as any;

      const report = await healthChecker.runChecks();
      const networkCheck = report.checks.find(c => c.name === 'localhost');
      
      expect(networkCheck).toBeDefined();
      expect(networkCheck?.status).toBe('error');
      expect(networkCheck?.message).toBe('Development server not responding');
    });
  });

  describe('Tauri Checks', () => {
    it('should handle browser environment', async () => {
      // Mock window as undefined (browser environment)
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;

      const report = await healthChecker.runChecks();
      const tauriCheck = report.checks.find(c => c.name === 'runtime' && c.category === 'tauri');
      
      expect(tauriCheck).toBeDefined();
      expect(tauriCheck?.status).toBe('warning');
      expect(tauriCheck?.message).toContain('browser mode');

      // Restore window
      global.window = originalWindow;
    });

    it('should check Tauri runtime availability', async () => {
      // Mock Tauri environment
      global.window = {} as any;
      vi.doMock('@tauri-apps/api/core', () => ({
        invoke: vi.fn().mockResolvedValue('1.0.0')
      }));

      const report = await healthChecker.runChecks();
      const tauriCheck = report.checks.find(c => c.name === 'runtime' && c.category === 'tauri');
      
      expect(tauriCheck).toBeDefined();
      expect(tauriCheck?.status).toBe('healthy');
      expect(tauriCheck?.message).toBe('Tauri runtime available');
    });
  });

  describe('Dependencies Checks', () => {
    it('should check critical modules availability', async () => {
      const report = await healthChecker.runChecks();
      const depsCheck = report.checks.find(c => c.name === 'critical-modules');
      
      expect(depsCheck).toBeDefined();
      expect(depsCheck?.category).toBe('dependencies');
      expect(['healthy', 'error']).toContain(depsCheck?.status);
    });
  });

  describe('Overall Health Assessment', () => {
    it('should report healthy status when all checks pass', async () => {
      // Mock all checks to pass
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
      global.window = {
        SpeechRecognition: vi.fn(),
        webkitSpeechRecognition: vi.fn(),
        speechSynthesis: {}
      } as any;

      const report = await healthChecker.runChecks();
      
      expect(report.overall).toBe('healthy');
      expect(report.checks.length).toBeGreaterThan(0);
      expect(report.timestamp).toBeGreaterThan(0);
    });

    it('should report degraded status with warnings', async () => {
      // Mock some checks to return warnings
      global.window = {} as any; // No speech APIs

      const report = await healthChecker.runChecks();
      
      // Should be degraded or unhealthy (network errors + warnings)
      expect(['degraded', 'unhealthy']).toContain(report.overall);
    });

    it('should report unhealthy status with errors', async () => {
      // Mock critical errors
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection failed')) as any;
      // @ts-ignore
      delete global.window; // Server environment

      const report = await healthChecker.runChecks();
      
      expect(['unhealthy', 'degraded']).toContain(report.overall);
    });
  });

  describe('Convenience Functions', () => {
    it('should provide runHealthCheck function', async () => {
      const report = await runHealthCheck();
      
      expect(report).toBeDefined();
      expect(report.checks).toBeDefined();
      expect(report.overall).toBeDefined();
      expect(report.timestamp).toBeGreaterThan(0);
    });

    it('should provide runQuickHealthCheck function', async () => {
      const status = await runQuickHealthCheck();
      
      expect(['healthy', 'degraded', 'unhealthy']).toContain(status);
    });
  });

  describe('Error Handling', () => {
    it('should handle health check failures gracefully', async () => {
      // Mock a check to throw an error
      healthChecker.addCheck('runtime', 'test-error', async () => {
        throw new Error('Test error');
      });

      const report = await healthChecker.runChecks();
      const errorCheck = report.checks.find(c => c.name === 'test-error');
      
      expect(errorCheck).toBeDefined();
      expect(errorCheck?.status).toBe('error');
      expect(errorCheck?.message).toContain('Health check failed');
    });
  });

  describe('Performance', () => {
    it('should complete health checks within reasonable time', async () => {
      const startTime = Date.now();
      await healthChecker.runChecks();
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
    });
  });
});

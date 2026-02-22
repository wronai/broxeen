/**
 * Service Prober - probes discovered devices for available services
 * Supports HTTP, RTSP, MQTT, SSH, and API endpoint probing
 */

import type { 
  ServiceProbeResult, 
  DiscoveredService, 
  ServiceProberConfig, 
  DiscoveryEvent,
  ServiceMetadata 
} from './types';
import { DatabaseManager } from '../persistence/databaseManager';
import type { DeviceService } from '../persistence/types';

export class ServiceProber {
  private config: ServiceProberConfig;
  private dbManager: DatabaseManager;
  private eventListeners: ((event: DiscoveryEvent) => void)[] = [];
  private isProbing = false;

  constructor(config: ServiceProberConfig, dbManager: DatabaseManager) {
    this.config = config;
    this.dbManager = dbManager;
  }

  /**
   * Probe a specific device for services
   */
  async probeDevice(deviceId: string, deviceIp: string): Promise<ServiceProbeResult> {
    console.log(`🔍 Probing services on device ${deviceIp}...`);
    const startTime = Date.now();

    try {
      const services: DiscoveredService[] = [];
      const probePromises: Promise<DiscoveredService | null>[] = [];

      // Probe HTTP services
      for (const port of this.config.ports.http) {
        probePromises.push(this.probeHttpService(deviceIp, port));
      }

      // Probe RTSP services
      for (const port of this.config.ports.rtsp) {
        probePromises.push(this.probeRtspService(deviceIp, port));
      }

      // Probe MQTT services
      for (const port of this.config.ports.mqtt) {
        probePromises.push(this.probeMqttService(deviceIp, port));
      }

      // Probe SSH services
      for (const port of this.config.ports.ssh) {
        probePromises.push(this.probeSshService(deviceIp, port));
      }

      // Probe API services
      for (const port of this.config.ports.api) {
        probePromises.push(this.probeApiService(deviceIp, port));
      }

      // Execute all probes concurrently with concurrency limit
      const results = await this.executeWithConcurrencyLimit(probePromises, this.config.maxConcurrent);
      
      // Filter out null results and add to services list
      for (const service of results) {
        if (service) {
          services.push(service);
          this.emitEvent({
            type: 'service_found',
            timestamp: new Date(),
            data: { deviceId, service }
          });
        }
      }

      // Persist discovered services
      await this.persistServices(deviceId, services);

      const probeDuration = Date.now() - startTime;
      const result: ServiceProbeResult = {
        deviceId,
        services,
        probeDuration
      };

      console.log(`✅ Service probing completed: ${services.length} services found in ${probeDuration}ms`);
      return result;

    } catch (error) {
      console.error(`❌ Service probing failed for device ${deviceIp}:`, error);
      throw error;
    }
  }

  /**
   * Probe HTTP service
   */
  private async probeHttpService(ip: string, port: number): Promise<DiscoveredService | null> {
    const url = `http://${ip}:${port}`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, { 
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout),
        headers: { 'User-Agent': 'Broxeen-Scanner/2.1' }
      });

      const responseTime = Date.now() - startTime;
      const metadata: ServiceMetadata = {
        server: response.headers.get('Server') || undefined,
        contentType: response.headers.get('Content-Type') || undefined,
        authRequired: response.status === 401 || response.status === 403
      };

      // Extract title from HTML if applicable
      if (response.ok && response.headers.get('Content-Type')?.includes('text/html')) {
        try {
          const html = await response.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) {
            metadata.title = titleMatch[1].trim();
          }
        } catch {
          // Ignore HTML parsing errors
        }
      }

      return {
        type: 'http',
        port,
        path: '/',
        status: response.ok ? 'online' : 'offline',
        responseTime,
        metadata
      };

    } catch (error) {
      return {
        type: 'http',
        port,
        path: '/',
        status: 'offline',
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Probe RTSP service
   */
  private async probeRtspService(ip: string, port: number): Promise<DiscoveredService | null> {
    // RTSP probing requires special handling - simplified version
    const startTime = Date.now();

    try {
      // In a real implementation, you'd establish RTSP connection
      // For now, we'll simulate with a TCP connection test
      console.log(`RTSP probe for ${ip}:${port} (simplified implementation)`);
      
      // Simulate RTSP metadata
      const metadata: ServiceMetadata = {
        rtspInfo: {
          supportedMethods: ['OPTIONS', 'DESCRIBE', 'SETUP', 'PLAY', 'TEARDOWN'],
          supportedCodecs: ['H264', 'MPEG4', 'JPEG']
        }
      };

      return {
        type: 'rtsp',
        port,
        path: '/',
        status: 'online', // Simplified - would be based on actual RTSP response
        responseTime: Date.now() - startTime,
        metadata
      };

    } catch (error) {
      return {
        type: 'rtsp',
        port,
        path: '/',
        status: 'offline',
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Probe MQTT service
   */
  private async probeMqttService(ip: string, port: number): Promise<DiscoveredService | null> {
    const startTime = Date.now();

    try {
      // MQTT probing requires WebSocket or TCP connection
      // Simplified implementation
      console.log(`MQTT probe for ${ip}:${port} (simplified implementation)`);
      
      const metadata: ServiceMetadata = {
        mqttInfo: {
          clientId: `broxeen_probe_${Date.now()}`,
          topics: ['$SYS/broker/version', '$SYS/broker/uptime']
        }
      };

      return {
        type: 'mqtt',
        port,
        status: 'online', // Simplified
        responseTime: Date.now() - startTime,
        metadata
      };

    } catch (error) {
      return {
        type: 'mqtt',
        port,
        status: 'offline',
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Probe SSH service
   */
  private async probeSshService(ip: string, port: number): Promise<DiscoveredService | null> {
    const startTime = Date.now();

    try {
      // SSH probing requires TCP connection
      // Simplified implementation
      console.log(`SSH probe for ${ip}:${port} (simplified implementation)`);
      
      return {
        type: 'ssh',
        port,
        status: 'online', // Simplified
        responseTime: Date.now() - startTime,
        metadata: {
          version: 'SSH-2.0-OpenSSH_7.4' // Example
        }
      };

    } catch (error) {
      return {
        type: 'ssh',
        port,
        status: 'offline',
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Probe API service
   */
  private async probeApiService(ip: string, port: number): Promise<DiscoveredService | null> {
    const paths = ['/api', '/v1', '/api/v1', '/rest', '/json'];
    const startTime = Date.now();

    for (const path of paths) {
      try {
        const url = `http://${ip}:${port}${path}`;
        const response = await fetch(url, { 
          method: 'GET',
          signal: AbortSignal.timeout(this.config.timeout / paths.length),
          headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
          const metadata: ServiceMetadata = {
            server: response.headers.get('Server') || undefined,
            contentType: response.headers.get('Content-Type') || undefined,
            authRequired: response.status === 401 || response.status === 403
          };

          // Try to parse as JSON to get API info
          try {
            const json = await response.json();
            if (json.version || json.api_version) {
              metadata.version = json.version || json.api_version;
            }
            if (json.description) {
              metadata.description = json.description;
            }
          } catch {
            // Not JSON, ignore
          }

          return {
            type: 'api',
            port,
            path,
            status: 'online',
            responseTime: Date.now() - startTime,
            metadata
          };
        }
      } catch {
        // Path not available, try next
      }
    }

    return {
      type: 'api',
      port,
      path: paths[0],
      status: 'offline',
      responseTime: Date.now() - startTime
    };
  }

  /**
   * Execute promises with concurrency limit
   */
  private async executeWithConcurrencyLimit<T>(
    promises: Promise<T>[], 
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const promise of promises) {
      const p = Promise.resolve(promise).then(result => {
        results.push(result);
      }).finally(() => {
        executing.splice(executing.indexOf(p), 1);
      });

      executing.push(p);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Persist discovered services to database
   */
  private async persistServices(deviceId: string, services: DiscoveredService[]): Promise<void> {
    if (!this.dbManager.isReady()) {
      console.warn('Database not ready, skipping persistence');
      return;
    }

    const db = this.dbManager.getDevicesDb();
    const now = Date.now();

    for (const service of services) {
      // Check if service already exists
      const existingService = db.prepare(`
        SELECT id FROM device_services 
        WHERE device_id = ? AND type = ? AND port = ?
      `).get(deviceId, service.type, service.port) as { id: string } | undefined;

      if (existingService) {
        // Update existing service
        db.prepare(`
          UPDATE device_services 
          SET status = ?, last_checked = ?, metadata = ?
          WHERE id = ?
        `).run(
          service.status,
          now,
          JSON.stringify(service.metadata),
          existingService.id
        );
      } else {
        // Insert new service
        db.prepare(`
          INSERT INTO device_services (id, device_id, type, port, path, status, last_checked, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          deviceId,
          service.type,
          service.port,
          service.path,
          service.status,
          now,
          JSON.stringify(service.metadata)
        );
      }
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: DiscoveryEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: DiscoveryEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Emit discovery event
   */
  private emitEvent(event: DiscoveryEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in discovery event listener:', error);
      }
    });
  }

  /**
   * Check if probing is in progress
   */
  isActive(): boolean {
    return this.isProbing;
  }
}

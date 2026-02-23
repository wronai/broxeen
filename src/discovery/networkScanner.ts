/**
 * Network Scanner - discovers devices on the local network
 * Supports ARP, ping sweep, mDNS/Bonjour, and SSDP/UPnP
 */

import type { 
  NetworkScanResult, 
  DiscoveredDevice, 
  NetworkScannerConfig, 
  DiscoveryEvent 
} from './types';
import { DatabaseManager } from '../persistence/databaseManager';
import type { Device } from '../persistence/types';

export class NetworkScanner {
  private config: NetworkScannerConfig;
  private dbManager: DatabaseManager;
  private eventListeners: ((event: DiscoveryEvent) => void)[] = [];
  private isScanning = false;

  constructor(config: NetworkScannerConfig, dbManager: DatabaseManager) {
    this.config = config;
    this.dbManager = dbManager;
  }

  /**
   * Start network discovery scan
   */
  async scanNetwork(): Promise<NetworkScanResult> {
    if (this.isScanning) {
      throw new Error('Scan already in progress');
    }

    this.isScanning = true;
    const startTime = Date.now();
    console.log('🔍 Starting network scan...');

    try {
      const results: DiscoveredDevice[] = [];

      // Try different scan methods based on config
      for (const method of this.config.scanMethods) {
        try {
          const methodResults = await this.performScan(method);
          results.push(...methodResults);
        } catch (error) {
          console.warn(`⚠️ Scan method ${method} failed:`, error);
        }
      }

      // Deduplicate results by IP
      const uniqueDevices = this.deduplicateDevices(results);

      // Persist discovered devices
      await this.persistDevices(uniqueDevices);

      const scanDuration = Date.now() - startTime;
      const result: NetworkScanResult = {
        devices: uniqueDevices,
        scanDuration,
        scanMethod: this.config.scanMethods[0]
      };

      this.emitEvent({
        type: 'scan_completed',
        timestamp: new Date(),
        data: result
      });

      console.log(`✅ Scan completed: ${uniqueDevices.length} devices found in ${scanDuration}ms`);
      return result;

    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Perform scan using specific method
   */
  private async performScan(method: 'arp' | 'ping' | 'mdns' | 'ssdp'): Promise<DiscoveredDevice[]> {
    switch (method) {
      case 'ping':
        return this.pingSweep();
      case 'mdns':
        return this.mdnsDiscovery();
      case 'ssdp':
        return this.ssdpDiscovery();
      case 'arp':
        return this.arpScan();
      default:
        throw new Error(`Unsupported scan method: ${method}`);
    }
  }

  /**
   * Ping sweep the local network
   */
  private async pingSweep(): Promise<DiscoveredDevice[]> {
    console.log('📍 Performing ping sweep...');
    const devices: DiscoveredDevice[] = [];
    
    // Get local network range (simplified - in production you'd want proper network detection)
    const networkRanges = await this.getLocalNetworkRanges();
    
    const promises = networkRanges.flatMap(range => 
      this.generateIpRange(range).map(ip => 
        this.pingHost(ip).then(result => {
          if (result) {
            devices.push(result);
            this.emitEvent({
              type: 'device_found',
              timestamp: new Date(),
              data: result
            });
          }
          return result;
        })
      )
    );

    await Promise.allSettled(promises);
    return devices;
  }

  /**
   * mDNS/Bonjour discovery
   */
  private async mdnsDiscovery(): Promise<DiscoveredDevice[]> {
    console.log('🔍 Performing mDNS discovery...');
    const devices: DiscoveredDevice[] = [];

    try {
      // In a browser environment, we'll use a simplified approach
      // In Tauri, we could use system mDNS APIs
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        // Tauri implementation would go here
        console.log('mDNS: Tauri environment detected');
      } else {
        // Browser fallback - check common local hostnames
        const commonHosts = [
          'localhost', 'router', 'gateway', 'nas', 'server', 
          'printer', 'camera', 'tv', 'chromecast', 'roku'
        ];
        
        for (const hostname of commonHosts) {
          try {
            const response = await fetch(`http://${hostname}:80`, { 
              signal: AbortSignal.timeout(this.config.timeout) 
            });
            if (response.ok) {
              devices.push({
                ip: hostname,
                hostname,
                responseTime: 0,
                openPorts: [80],
                lastSeen: new Date()
              });
            }
          } catch {
            // Host not reachable, ignore
          }
        }
      }
    } catch (error) {
      console.warn('mDNS discovery failed:', error);
    }

    return devices;
  }

  /**
   * SSDP/UPnP discovery
   */
  private async ssdpDiscovery(): Promise<DiscoveredDevice[]> {
    console.log('🔍 Performing SSDP discovery...');
    const devices: DiscoveredDevice[] = [];

    try {
      // SSDP multicast discovery
      const ssdpRequest = `M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nST: upnp:rootdevice\r\nMX: 3\r\n\r\n`;
      
      // In a real implementation, you'd send this via UDP
      // For now, we'll simulate with common UPnP device ports
      const commonPorts = [1900, 49152, 49153, 49154];
      
      // This is a simplified version - real SSDP would involve UDP multicast
      console.log('SSDP: Simplified discovery (would use UDP multicast in production)');
      
    } catch (error) {
      console.warn('SSDP discovery failed:', error);
    }

    return devices;
  }

  /**
   * ARP scan (system-level, requires elevated privileges)
   */
  private async arpScan(): Promise<DiscoveredDevice[]> {
    console.log('🔍 Performing ARP scan...');
    const devices: DiscoveredDevice[] = [];

    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI__) {
        // Tauri implementation could use system ARP commands
        console.log('ARP: Tauri environment detected - would use system ARP');
      } else {
        // Browser environment - ARP not available
        console.log('ARP: Not available in browser environment');
      }
    } catch (error) {
      console.warn('ARP scan failed:', error);
    }

    return devices;
  }

  /**
   * Ping a specific host
   */
  private async pingHost(ip: string): Promise<DiscoveredDevice | null> {
    try {
      const startTime = Date.now();
      
      // Use HTTP HEAD request as ping alternative in browser
      const response = await fetch(`http://${ip}:80`, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(this.config.timeout)
      });
      
      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        return {
          ip,
          hostname: undefined,
          responseTime,
          openPorts: [80],
          lastSeen: new Date()
        };
      }
    } catch {
      // Host not reachable
    }
    
    return null;
  }

  /**
   * Get local network ranges
   */
  private async getLocalNetworkRanges(): Promise<string[]> {
    // Simplified - in production you'd detect actual network interfaces
    return ['192.168.1.0/24', '192.168.0.0/24', '10.0.0.0/24'];
  }

  /**
   * Generate IP range from CIDR
   */
  private generateIpRange(cidr: string): string[] {
    const [network, prefixLength] = cidr.split('/');
    const baseIp = network.split('.').map(Number);
    const ips: string[] = [];
    
    // Simplified - only handles /24 networks
    if (prefixLength === '24') {
      for (let i = 1; i < 255; i++) {
        ips.push(`${baseIp[0]}.${baseIp[1]}.${baseIp[2]}.${i}`);
      }
    }
    
    return ips;
  }

  /**
   * Remove duplicate devices by IP
   */
  private deduplicateDevices(devices: DiscoveredDevice[]): DiscoveredDevice[] {
    const seen = new Set<string>();
    return devices.filter(device => {
      if (seen.has(device.ip)) {
        return false;
      }
      seen.add(device.ip);
      return true;
    });
  }

  /**
   * Persist discovered devices to database
   */
  private async persistDevices(devices: DiscoveredDevice[]): Promise<void> {
    if (!this.dbManager.isReady()) {
      console.warn('Database not ready, skipping persistence');
      return;
    }

    const db = this.dbManager.getDevicesDb();
    const now = Date.now();

    for (const device of devices) {
      const existingDevice = await db.queryOne<{ id: string }>(
        'SELECT id FROM devices WHERE ip = ?',
        [device.ip],
      );

      if (existingDevice) {
        // Update existing device
        await db.execute(
          `
          UPDATE devices 
          SET hostname = ?, mac = ?, vendor = ?, last_seen = ?, updated_at = ?
          WHERE id = ?
        `,
          [
            device.hostname,
            device.mac,
            device.vendor,
            now,
            now,
            existingDevice.id,
          ],
        );
      } else {
        // Insert new device
        await db.execute(
          `
          INSERT INTO devices (id, ip, hostname, mac, vendor, last_seen, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            crypto.randomUUID(),
            device.ip,
            device.hostname,
            device.mac,
            device.vendor,
            now,
            now,
            now,
          ],
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
   * Check if scan is in progress
   */
  isActive(): boolean {
    return this.isScanning;
  }
}

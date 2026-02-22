/**
 * Discovery layer types for Broxeen v2.1
 * Defines network scanning and service probing interfaces
 */

export interface NetworkScanResult {
  devices: DiscoveredDevice[];
  scanDuration: number;
  scanMethod: 'arp' | 'ping' | 'mdns' | 'ssdp';
}

export interface DiscoveredDevice {
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  openPorts: number[];
  responseTime: number;
  lastSeen: Date;
}

export interface ServiceProbeResult {
  deviceId: string;
  services: DiscoveredService[];
  probeDuration: number;
}

export interface DiscoveredService {
  type: 'http' | 'rtsp' | 'mqtt' | 'ssh' | 'api';
  port: number;
  path?: string;
  status: 'online' | 'offline' | 'unknown';
  responseTime?: number;
  metadata?: ServiceMetadata;
}

export interface ServiceMetadata {
  title?: string;
  server?: string;
  contentType?: string;
  authRequired?: boolean;
  version?: string;
  description?: string;
  rtspInfo?: {
    supportedMethods: string[];
    supportedCodecs: string[];
  };
  mqttInfo?: {
    clientId?: string;
    topics?: string[];
  };
}

export interface NetworkScannerConfig {
  scanMethods: ('arp' | 'ping' | 'mdns' | 'ssdp')[];
  timeout: number;
  maxConcurrent: number;
  excludeRanges: string[];
}

export interface ServiceProberConfig {
  ports: {
    http: number[];
    rtsp: number[];
    mqtt: number[];
    ssh: number[];
    api: number[];
  };
  timeout: number;
  maxConcurrent: number;
  retryAttempts: number;
}

export interface DiscoveryEvent {
  type: 'device_found' | 'device_lost' | 'service_found' | 'service_lost' | 'scan_completed';
  timestamp: Date;
  data: any;
}

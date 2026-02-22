/**
 * Network Scan Plugin - provides network discovery capabilities
 * Integrates with NetworkScanner for device discovery
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { NetworkScanner } from '../../discovery/networkScanner';
import { DatabaseManager } from '../../persistence/databaseManager';
import type { NetworkScannerConfig } from '../../discovery/types';

export class NetworkScanPlugin implements Plugin {
  readonly id = 'network-scan';
  readonly name = 'Network Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:scan', 'network:discover', 'network:devices', 'camera:describe', 'camera:discover'];

  private networkScanner: NetworkScanner | null = null;

  async initialize(context: PluginContext): Promise<void> {
    // Initialize database manager (this would be injected in real implementation)
    const dbManager = new DatabaseManager({
      devicesDbPath: 'devices.db',
      chatDbPath: 'chat.db',
      walMode: true,
      connectionPoolSize: 5
    });

    await dbManager.initialize();

    // Configure network scanner
    const config: NetworkScannerConfig = {
      scanMethods: ['ping', 'mdns'],
      timeout: 5000,
      maxConcurrent: 10,
      excludeRanges: ['127.0.0.0/8']
    };

    this.networkScanner = new NetworkScanner(config, dbManager);
    
    console.log('Network Scan Plugin initialized');
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lowerInput = input.toLowerCase();
    const scanKeywords = [
      'skanuj sieć', 'skanuj', 'odkryj urządzenia', 'znajdź urządzenia',
      'scan network', 'discover devices', 'network scan', 'find devices'
    ];
    
    const cameraKeywords = [
      'pokaż kamery', 'pokaż kamerę', 'pokaz kamery', 'pokaz kamera',
      'znajdź kamery', 'znajdź kamerę', 'wyszukaj kamery', 'wyszukaj kamerę',
      'kamery w sieci', 'kamera w sieci', 'discover cameras', 'find cameras'
    ];
    
    return scanKeywords.some(keyword => lowerInput.includes(keyword)) ||
           cameraKeywords.some(keyword => lowerInput.includes(keyword));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    if (!this.networkScanner) {
      throw new Error('Network Scanner not initialized');
    }

    const isCameraQuery = input.toLowerCase().includes('kamer') || input.toLowerCase().includes('camera');

    try {
      console.log(`Starting network scan for ${isCameraQuery ? 'cameras' : 'devices'}...`);
      const result = await this.networkScanner.scanNetwork();

      const content = this.formatScanResult(result, isCameraQuery);
      
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: content,
          title: isCameraQuery ? 'Wyniki wyszukiwania kamer' : 'Wyniki skanowania sieci'
        }],
        metadata: {
          duration_ms: result.scanDuration,
          cached: false,
          truncated: false,
          deviceCount: result.devices.length,
          scanDuration: result.scanDuration,
          scanMethod: result.scanMethod,
          executionTime: result.scanDuration,
          queryType: isCameraQuery ? 'camera_discovery' : 'network_scan'
        },
      };

    } catch (error) {
      console.error('Network scan failed:', error);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `Wystąpił błąd podczas ${isCameraQuery ? 'wyszukiwania kamer' : 'skanowania sieci'}: ${error instanceof Error ? error.message : 'Nieznany błąd'}`
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
          queryType: isCameraQuery ? 'camera_discovery' : 'network_scan'
        },
      };
    }
  }

  private formatScanResult(result: any, isCameraQuery = false): string {
    const { devices, scanDuration, scanMethod } = result;
    
    let content = isCameraQuery 
      ? `📷 **Wyszukiwanie kamer zakończone**\n\n`
      : `🔍 **Skanowanie sieci zakończone**\n\n`;
    
    content += `Metoda: ${scanMethod}\n`;
    content += `Czas trwania: ${scanDuration}ms\n`;
    content += `Znaleziono urządzeń: ${devices.length}\n\n`;

    if (devices.length === 0) {
      content += `Nie znaleziono żadnych urządzeń w sieci.\n`;
    } else {
      // Filter for camera-like devices if this is a camera query
      const relevantDevices = isCameraQuery 
        ? devices.filter((device: any) => 
            device.hostname?.toLowerCase().includes('cam') ||
            device.hostname?.toLowerCase().includes('ipcam') ||
            device.vendor?.toLowerCase().includes('hikvision') ||
            device.vendor?.toLowerCase().includes('dahua') ||
            device.openPorts.some((port: number) => [554, 80, 8080, 8000].includes(port)) ||
            device.openPorts.some((port: number) => port >= 8000 && port <= 9000)
          )
        : devices;

      if (isCameraQuery && relevantDevices.length === 0) {
        content += `Nie znaleziono kamer w sieci.\n\n`;
        content += `**Wszystkie znalezione urządzenia:**\n\n`;
      } else {
        content += isCameraQuery 
          ? `**Znalezione kamery:**\n\n`
          : `**Znalezione urządzenia:**\n\n`;
      }
      
      const devicesToShow = isCameraQuery && relevantDevices.length > 0 ? relevantDevices : devices;
      
      devicesToShow.forEach((device: any, index: number) => {
        content += `${index + 1}. **${device.ip}**\n`;
        if (device.hostname) {
          content += `   Hostname: ${device.hostname}\n`;
        }
        if (device.mac) {
          content += `   MAC: ${device.mac}\n`;
        }
        if (device.vendor) {
          content += `   Producent: ${device.vendor}\n`;
        }
        if (device.openPorts.length > 0) {
          content += `   Otwarte porty: ${device.openPorts.join(', ')}\n`;
        }
        content += `   Czas odpowiedzi: ${device.responseTime}ms\n`;
        content += `   Ostatnio widziany: ${device.lastSeen.toLocaleString()}\n\n`;
      });
    }

    content += `💡 *Możesz teraz zapytać o szczegóły konkretnego urządzenia lub spróbować połączyć się z kamerą.*`;
    
    return content;
  }

  async dispose(): Promise<void> {
    if (this.networkScanner) {
      // Cleanup if needed
      this.networkScanner = null;
    }
    console.log('Network Scan Plugin disposed');
  }
}

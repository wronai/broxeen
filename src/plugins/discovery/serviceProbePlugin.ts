/**
 * Service Probe Plugin - provides service discovery capabilities
 * Integrates with ServiceProber for detailed service analysis
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { ServiceProber } from '../../discovery/serviceProber';
import { DatabaseManager } from '../../persistence/databaseManager';
import type { ServiceProberConfig } from '../../discovery/types';

export class ServiceProbePlugin implements Plugin {
  readonly id = 'service-probe';
  readonly name = 'Service Prober';
  readonly version = '1.0.0';
  readonly supportedIntents = ['service:probe', 'service:describe', 'http:describe', 'rtsp:describe', 'mqtt:describe', 'api:describe'];

  private serviceProber: ServiceProber | null = null;

  async initialize(context: PluginContext): Promise<void> {
    // Initialize database manager (this would be injected in real implementation)
    const dbManager = new DatabaseManager({
      devicesDbPath: 'devices.db',
      chatDbPath: 'chat.db',
      walMode: true,
      connectionPoolSize: 5
    });

    await dbManager.initialize();

    // Configure service prober
    const config: ServiceProberConfig = {
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

    this.serviceProber = new ServiceProber(config, dbManager);
    
    console.log('Service Probe Plugin initialized');
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lowerInput = input.toLowerCase();
    const probeKeywords = [
      'sprawdź usługę', 'probe service', 'sprawdź port', 'check port',
      'http://', 'https://', 'rtsp://', 'mqtt://',
      'kamera', 'camera', 'api', 'serwis', 'service'
    ];
    
    return this.supportedIntents.some(intent => lowerInput.includes(intent.replace(':', ' '))) ||
           probeKeywords.some(keyword => lowerInput.includes(keyword));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    if (!this.serviceProber) {
      throw new Error('Service Prober not initialized');
    }

    try {
      // Extract target from input
      const target = this.extractTarget(input);
      
      if (!target) {
        return {
          status: 'error',
          content: [{
            type: 'text',
            data: 'Nie można zidentyfikować celu. Podaj adres IP lub nazwę urządzenia.'
          }]
        };
      }

      console.log(`Probing services for target: ${target}`);
      
      // Get device ID from database (simplified)
      const deviceId = await this.getDeviceId(target);
      
      if (!deviceId) {
        return {
          status: 'error',
          content: [{
            type: 'text',
            data: `Nie znaleziono urządzenia ${target} w bazie danych. Uruchom najpierw skanowanie sieci.`
          }]
        };
      }

      const result = await this.serviceProber.probeDevice(deviceId, target);
      const content = this.formatProbeResult(result, target);
      
      return {
        status: 'success',
        content: [{
          type: 'text',
          data: content,
          title: `Usługi na ${target}`
        }],
        metadata: {
          target,
          serviceCount: result.services.length,
          probeDuration: result.probeDuration
        },
        executionTime: result.probeDuration
      };

    } catch (error) {
      console.error('Service probe failed:', error);
      return {
        status: 'error',
        content: [{
          type: 'text',
          data: `Wystąpił błąd podczas sprawdzania usług: ${error instanceof Error ? error.message : 'Nieznany błąd'}`
        }]
      };
    }
  }

  private extractTarget(input: string): string | null {
    // Try to extract IP address or hostname
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    const ipMatch = input.match(ipRegex);
    
    if (ipMatch) {
      return ipMatch[0];
    }

    // Try to extract hostname patterns
    const hostnameRegex = /\b([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/;
    const hostnameMatch = input.match(hostnameRegex);
    
    if (hostnameMatch) {
      return hostnameMatch[0];
    }

    // Look for device identifiers like "camera-salon", "router", etc.
    const deviceKeywords = ['kamera', 'camera', 'router', 'serwer', 'server', 'nas'];
    const lowerInput = input.toLowerCase();
    
    for (const keyword of deviceKeywords) {
      if (lowerInput.includes(keyword)) {
        // Try to find a device identifier pattern
        const devicePattern = new RegExp(`(${keyword}[\\w-]*)`, 'i');
        const match = input.match(devicePattern);
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  }

  private async getDeviceId(target: string): Promise<string | null> {
    // This would query the database to get device ID
    // For now, return a mock ID
    return `device-${target}`;
  }

  private formatProbeResult(result: any, target: string): string {
    const { services, probeDuration } = result;
    
    let content = `🔍 **Sprawdzanie usług na ${target}**\n\n`;
    content += `Czas trwania: ${probeDuration}ms\n`;
    content += `Znaleziono usług: ${services.length}\n\n`;

    if (services.length === 0) {
      content += `Nie znaleziono żadnych aktywnych usług na tym urządzeniu.\n`;
    } else {
      content += `**Znalezione usługi:**\n\n`;
      
      services.forEach((service: any, index: number) => {
        content += `${index + 1}. **${service.type.toUpperCase()}** (port ${service.port})\n`;
        content += `   Status: ${service.status === 'online' ? '🟢 Online' : '🔴 Offline'}\n`;
        
        if (service.responseTime) {
          content += `   Czas odpowiedzi: ${service.responseTime}ms\n`;
        }
        
        if (service.path) {
          content += `   Ścieżka: ${service.path}\n`;
        }
        
        if (service.metadata) {
          const metadata = service.metadata;
          if (metadata.title) {
            content += `   Tytuł: ${metadata.title}\n`;
          }
          if (metadata.server) {
            content += `   Serwer: ${metadata.server}\n`;
          }
          if (metadata.contentType) {
            content += `   Typ treści: ${metadata.contentType}\n`;
          }
          if (metadata.authRequired) {
            content += `   ⚠️ Wymaga autentykacji\n`;
          }
          
          // Service-specific metadata
          if (metadata.rtspInfo) {
            content += `   RTSP: ${metadata.rtspInfo.supportedMethods.join(', ')}\n`;
          }
          if (metadata.mqttInfo) {
            content += `   MQTT: ${metadata.mqttInfo.topics?.join(', ') || 'brak tematów'}\n`;
          }
        }
        
        content += '\n';
      });
    }

    content += `💡 *Możesz teraz zapytać o szczegóły konkretnej usługi lub ustawić monitoring zmian.*`;
    
    return content;
  }

  async dispose(): Promise<void> {
    if (this.serviceProber) {
      // Cleanup if needed
      this.serviceProber = null;
    }
    console.log('Service Probe Plugin disposed');
  }
}

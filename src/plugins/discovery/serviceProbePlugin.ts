/**
 * Service Probe Plugin - provides service discovery capabilities
 * Integrates with ServiceProber for detailed service analysis
 * Browser/Tauri compatible version
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import type { ServiceProberConfig } from '../../discovery/types';

export class ServiceProbePlugin implements Plugin {
  readonly id = 'service-probe';
  readonly name = 'Service Prober';
  readonly version = '1.0.0';
  readonly supportedIntents = ['service:probe', 'service:describe', 'http:describe', 'rtsp:describe', 'mqtt:describe', 'api:describe'];

  async initialize(context: PluginContext): Promise<void> {
    // In browser/Tauri environment, we can't use better-sqlite3 directly
    // This plugin will use a simplified implementation without database
    console.log('Service Probe Plugin initialized (browser-compatible mode)');
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
    try {
      // Extract target from input
      const target = this.extractTarget(input);
      
      if (!target) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: 'Nie można zidentyfikować celu. Podaj adres IP lub nazwę urządzenia.'
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          },
        };
      }

      console.log(`Probing services for target: ${target}`);
      
      // Simplified service probe for browser/Tauri environment
      const result = await this.performSimpleProbe(target);
      const content = this.formatProbeResult(result, target);
      
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: content,
          title: `Usługi na ${target}`
        }],
        metadata: {
          duration_ms: result.probeDuration,
          cached: false,
          truncated: false,
          target,
          serviceCount: result.services.length,
          probeDuration: result.probeDuration,
          executionTime: result.probeDuration
        },
      };

    } catch (error) {
      console.error('Service probe failed:', error);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `Wystąpił błąd podczas sprawdzania usług: ${error instanceof Error ? error.message : 'Nieznany błąd'}`
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        },
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

  private async performSimpleProbe(target: string): Promise<{ services: any[], probeDuration: number }> {
    const startTime = Date.now();
    const services: any[] = [];
    
    // Common ports to check
    const commonPorts = [
      { port: 80, type: 'http', protocol: 'HTTP' },
      { port: 443, type: 'https', protocol: 'HTTPS' },
      { port: 8080, type: 'http', protocol: 'HTTP' },
      { port: 554, type: 'rtsp', protocol: 'RTSP' },
      { port: 1883, type: 'mqtt', protocol: 'MQTT' },
      { port: 22, type: 'ssh', protocol: 'SSH' }
    ];

    // Check each port with a simple fetch/cors-limited approach
    for (const portInfo of commonPorts) {
      try {
        const url = portInfo.type === 'https' ? `https://${target}:${portInfo.port}` :
                   portInfo.type === 'http' ? `http://${target}:${portInfo.port}` :
                   `${portInfo.type}://${target}:${portInfo.port}`;
        
        // For HTTP/HTTPS, we can try a simple fetch
        if (portInfo.type === 'http' || portInfo.type === 'https') {
          try {
            const response = await fetch(url, { 
              method: 'HEAD',
              mode: 'no-cors',
              signal: AbortSignal.timeout(2000)
            });
            
            services.push({
              type: portInfo.type,
              port: portInfo.port,
              protocol: portInfo.protocol,
              status: 'online',
              responseTime: Date.now() - startTime,
              path: '/',
              metadata: {
                title: `${portInfo.protocol} Service`,
                server: 'Unknown',
                contentType: 'text/html'
              }
            });
          } catch (fetchError) {
            // CORS or network error - service might exist but not accessible
            services.push({
              type: portInfo.type,
              port: portInfo.port,
              protocol: portInfo.protocol,
              status: 'unknown',
              responseTime: Date.now() - startTime,
              path: '/',
              metadata: {
                title: `${portInfo.protocol} Service (inaccessible)`,
                note: 'CORS/network restrictions prevent access'
              }
            });
          }
        } else {
          // For non-HTTP protocols, we can't probe from browser
          services.push({
            type: portInfo.type,
            port: portInfo.port,
            protocol: portInfo.protocol,
            status: 'unknown',
            responseTime: 0,
            path: '',
            metadata: {
              title: `${portInfo.protocol} Service`,
              note: 'Cannot probe from browser environment'
            }
          });
        }
      } catch (error) {
        // Port is definitely closed or filtered
        continue;
      }
    }

    return {
      services,
      probeDuration: Date.now() - startTime
    };
  }

  private async getDeviceId(target: string): Promise<string | null> {
    // Simplified - return mock ID since we don't have database access
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
    console.log('Service Probe Plugin disposed');
  }
}

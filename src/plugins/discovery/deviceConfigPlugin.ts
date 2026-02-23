/**
 * Device Configuration Plugin - handles adding and configuring devices
 * Supports commands like "dodaj kamerę", "zapisz urządzenie", "konfiguruj urządzenie"
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { ConfiguredDeviceRepository } from '../../persistence/configuredDeviceRepository';
import type { ConfiguredDevice } from '../../persistence/configuredDeviceRepository';
import { logger } from '../../lib/logger';

const configLogger = logger.scope('device-config');

export class DeviceConfigPlugin implements Plugin {
  readonly id = 'device-config';
  readonly name = 'Device Configuration';
  readonly version = '1.0.0';
  readonly supportedIntents = ['device:add', 'device:save', 'device:configure', 'device:list-configured'];

  private configRepo?: ConfiguredDeviceRepository;

  async initialize(context: PluginContext): Promise<void> {
    try {
      if (!context.databaseManager) {
        configLogger.warn('DatabaseManager not available in context');
        return;
      }
      
      this.configRepo = new ConfiguredDeviceRepository(context.databaseManager.getDevicesDb());
      configLogger.info('DeviceConfigPlugin initialized');
    } catch (err) {
      configLogger.warn('Failed to initialize DeviceConfigPlugin', err);
    }
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lowerInput = input.toLowerCase();
    const addKeywords = [
      'dodaj kamerę', 'dodaj kamere', 'dodaj urządzenie', 'dodaj urzadzenie',
      'add camera', 'add device', 'nowa kamera', 'nowe urządzenie'
    ];
    
    const saveKeywords = [
      'zapisz kamerę', 'zapisz kamere', 'zapisz urządzenie', 'zapisz urzadzenie',
      'save camera', 'save device', 'zachowaj kamerę', 'zachowaj urządzenie'
    ];

    const configureKeywords = [
      'konfiguruj kamerę', 'konfiguruj kamere', 'konfiguruj urządzenie',
      'configure camera', 'configure device', 'ustaw kamerę', 'ustaw urządzenie'
    ];

    const listKeywords = [
      'lista skonfigurowanych', 'skonfigurowane urządzenia', 'skonfigurowane kamery',
      'configured devices', 'configured cameras', 'moje urządzenia', 'moje kamery'
    ];
    
    return addKeywords.some(keyword => lowerInput.includes(keyword)) ||
           saveKeywords.some(keyword => lowerInput.includes(keyword)) ||
           configureKeywords.some(keyword => lowerInput.includes(keyword)) ||
           listKeywords.some(keyword => lowerInput.includes(keyword));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    
    if (!this.configRepo) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Baza danych konfiguracji nie jest dostępna.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const lowerInput = input.toLowerCase();
    
    // Check what kind of configuration request this is
    if (lowerInput.includes('lista') || lowerInput.includes('skonfigurowane') || lowerInput.includes('moje')) {
      return await this.listConfiguredDevices(start);
    } else if (lowerInput.includes('dodaj') || lowerInput.includes('add') || lowerInput.includes('nowa') || lowerInput.includes('nowe')) {
      return await this.addDevice(input, start);
    } else if (lowerInput.includes('zapisz') || lowerInput.includes('save') || lowerInput.includes('zachowaj')) {
      return await this.saveDevice(input, start);
    } else if (lowerInput.includes('konfiguruj') || lowerInput.includes('configure') || lowerInput.includes('ustaw')) {
      return await this.configureDevice(input, start);
    }

    // Default: show help
    return this.showHelp(start);
  }

  private async listConfiguredDevices(start: number): Promise<PluginResult> {
    try {
      const devices = await this.configRepo!.listAll();
      
      if (devices.length === 0) {
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: '📭 **Brak skonfigurowanych urządzeń**\n\n' +
                  'Użyj komendy `dodaj kamerę` aby dodać nowe urządzenie.\n\n' +
                  '**Przykłady:**\n' +
                  '- `dodaj kamerę 192.168.1.100 Wejście`\n' +
                  '- `dodaj kamerę 192.168.1.101 Ogród rtsp://192.168.1.101:554/stream`'
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `## 📋 Skonfigurowane Urządzenia (${devices.length})\n\n`;
      
      const cameras = devices.filter((d: ConfiguredDevice) => d.device_type === 'camera');
      const servers = devices.filter((d: ConfiguredDevice) => d.device_type === 'server');
      const sensors = devices.filter((d: ConfiguredDevice) => d.device_type === 'sensor');
      const others = devices.filter((d: ConfiguredDevice) => d.device_type === 'other');

      if (cameras.length > 0) {
        content += `### 📹 Kamery (${cameras.length})\n\n`;
        cameras.forEach((cam: ConfiguredDevice) => {
          const monitorIcon = cam.monitor_enabled ? '🟢' : '⚪';
          content += `${monitorIcon} **${cam.label}** — \`${cam.ip}\`\n`;
          if (cam.rtsp_url) content += `   📡 RTSP: ${cam.rtsp_url}\n`;
          if (cam.monitor_enabled) content += `   ⏱️ Monitor: ${cam.monitor_interval_ms}ms\n`;
          content += '\n';
        });
      }

      if (servers.length > 0) {
        content += `### 🖥️ Serwery (${servers.length})\n\n`;
        servers.forEach((srv: ConfiguredDevice) => {
          content += `- **${srv.label}** — \`${srv.ip}\`\n`;
        });
        content += '\n';
      }

      if (sensors.length > 0) {
        content += `### 🌡️ Czujniki (${sensors.length})\n\n`;
        sensors.forEach((sen: ConfiguredDevice) => {
          content += `- **${sen.label}** — \`${sen.ip}\`\n`;
        });
        content += '\n';
      }

      if (others.length > 0) {
        content += `### 🔧 Inne (${others.length})\n\n`;
        others.forEach((oth: ConfiguredDevice) => {
          content += `- **${oth.label}** — \`${oth.ip}\`\n`;
        });
        content += '\n';
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          device_count: devices.length,
        } as any,
      };
    } catch (err) {
      configLogger.error('Failed to list configured devices', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się pobrać listy skonfigurowanych urządzeń.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private async addDevice(input: string, start: number): Promise<PluginResult> {
    try {
      // Parse input: "dodaj kamerę <IP> <label> [rtsp_url]"
      const params = this.parseAddCommand(input);
      
      if (!params.ip) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: '❌ **Brak adresu IP**\n\n' +
                  '**Poprawny format:**\n' +
                  '`dodaj kamerę <IP> <nazwa> [rtsp_url]`\n\n' +
                  '**Przykłady:**\n' +
                  '- `dodaj kamerę 192.168.1.100 Wejście`\n' +
                  '- `dodaj kamerę 192.168.1.101 Ogród rtsp://192.168.1.101:554/stream`\n' +
                  '- `dodaj kamerę 192.168.1.102 Salon rtsp://admin:pass@192.168.1.102:554/h264`'
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      if (!params.label) {
        params.label = `Camera ${params.ip}`;
      }

      // Create device configuration
      const device: Omit<ConfiguredDevice, 'id' | 'created_at' | 'updated_at'> = {
        device_id: null,
        label: params.label,
        ip: params.ip,
        device_type: params.deviceType || 'camera',
        rtsp_url: params.rtspUrl || null,
        http_url: params.httpUrl || null,
        username: params.username || null,
        password: params.password || null,
        stream_path: params.streamPath || null,
        monitor_enabled: true,
        monitor_interval_ms: 3000,
        last_snapshot_at: null,
        notes: null,
      };

      const savedDeviceId = await this.configRepo!.save(device);
      const savedDevice = await this.configRepo!.getById(savedDeviceId);
      
      if (!savedDevice) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{ type: 'text', data: '❌ Nie udało się dodać urządzenia.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `✅ **Urządzenie dodane pomyślnie**\n\n`;
      content += `📹 **${savedDevice.label}**\n`;
      content += `🌐 IP: \`${savedDevice.ip}\`\n`;
      if (savedDevice.rtsp_url) content += `📡 RTSP: ${savedDevice.rtsp_url}\n`;
      content += `🟢 Monitoring: włączony (${savedDevice.monitor_interval_ms}ms)\n\n`;
      content += `**ID:** \`${savedDeviceId}\`\n\n`;
      content += `Urządzenie zostało zapisane i będzie monitorowane automatycznie.`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          device_id: savedDeviceId,
        } as any,
      };
    } catch (err) {
      configLogger.error('Failed to add device', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: `❌ Nie udało się dodać urządzenia: ${err instanceof Error ? err.message : 'Unknown error'}` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private async saveDevice(input: string, start: number): Promise<PluginResult> {
    // Similar to addDevice but with update logic if device exists
    return await this.addDevice(input, start);
  }

  private async configureDevice(input: string, start: number): Promise<PluginResult> {
    try {
      // Parse input: "konfiguruj kamerę <IP|label> [parametry]"
      const params = this.parseConfigureCommand(input);
      
      if (!params.identifier) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: '❌ **Brak identyfikatora urządzenia**\n\n' +
                  '**Poprawny format:**\n' +
                  '`konfiguruj kamerę <IP|nazwa>`\n\n' +
                  '**Przykład:**\n' +
                  '- `konfiguruj kamerę 192.168.1.100`\n' +
                  '- `konfiguruj kamerę Wejście`'
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      // Find device by IP or label
      const devices = await this.configRepo!.listAll();
      const device = devices.find((d: ConfiguredDevice) => 
        d.ip === params.identifier || 
        (params.identifier && d.label.toLowerCase() === params.identifier.toLowerCase())
      );

      if (!device) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: `❌ **Nie znaleziono urządzenia:** \`${params.identifier}\`\n\n` +
                  'Użyj komendy `lista skonfigurowanych` aby zobaczyć dostępne urządzenia.'
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `⚙️ **Konfiguracja urządzenia**\n\n`;
      content += `📹 **${device.label}**\n`;
      content += `🌐 IP: \`${device.ip}\`\n`;
      content += `🔧 Typ: ${this.getDeviceTypeLabel(device.device_type)}\n`;
      if (device.rtsp_url) content += `📡 RTSP: ${device.rtsp_url}\n`;
      if (device.http_url) content += `🌐 HTTP: ${device.http_url}\n`;
      content += `${device.monitor_enabled ? '🟢' : '⚪'} Monitoring: ${device.monitor_enabled ? 'włączony' : 'wyłączony'}\n`;
      if (device.monitor_enabled) content += `⏱️ Interwał: ${device.monitor_interval_ms}ms\n`;
      content += `\n**ID:** \`${device.id}\`\n`;
      content += `**Utworzono:** ${new Date(device.created_at).toLocaleString('pl-PL')}\n`;
      content += `**Zaktualizowano:** ${new Date(device.updated_at).toLocaleString('pl-PL')}\n`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          device_id: device.id,
        } as any,
      };
    } catch (err) {
      configLogger.error('Failed to configure device', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się skonfigurować urządzenia.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private showHelp(start: number): PluginResult {
    const content = `## 🔧 Konfiguracja Urządzeń - Pomoc\n\n` +
      `**Dostępne komendy:**\n\n` +
      `### Dodawanie urządzeń\n` +
      `- \`dodaj kamerę <IP> <nazwa> [rtsp_url]\`\n` +
      `- \`dodaj urządzenie <IP> <nazwa>\`\n\n` +
      `**Przykłady:**\n` +
      `- \`dodaj kamerę 192.168.1.100 Wejście\`\n` +
      `- \`dodaj kamerę 192.168.1.101 Ogród rtsp://192.168.1.101:554/stream\`\n\n` +
      `### Zapisywanie urządzeń\n` +
      `- \`zapisz kamerę <IP> <nazwa>\`\n` +
      `- \`zapisz urządzenie <IP> <nazwa>\`\n\n` +
      `### Konfiguracja\n` +
      `- \`konfiguruj kamerę <IP|nazwa>\`\n` +
      `- \`lista skonfigurowanych\`\n` +
      `- \`moje urządzenia\`\n`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: content }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private parseAddCommand(input: string): {
    ip: string | null;
    label: string | null;
    rtspUrl: string | null;
    httpUrl: string | null;
    username: string | null;
    password: string | null;
    streamPath: string | null;
    deviceType: 'camera' | 'server' | 'sensor' | 'other';
  } {
    // Extract IP address
    const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    const ip = ipMatch ? ipMatch[1] : null;

    // Extract RTSP URL
    const rtspMatch = input.match(/rtsp:\/\/[^\s]+/i);
    const rtspUrl = rtspMatch ? rtspMatch[0] : null;

    // Extract HTTP URL
    const httpMatch = input.match(/https?:\/\/[^\s]+/i);
    const httpUrl = httpMatch && !rtspUrl ? httpMatch[0] : null;

    // Extract credentials from RTSP URL
    let username: string | null = null;
    let password: string | null = null;
    if (rtspUrl) {
      const credMatch = rtspUrl.match(/rtsp:\/\/([^:]+):([^@]+)@/);
      if (credMatch) {
        username = credMatch[1];
        password = credMatch[2];
      }
    }

    // Extract label (text between IP and RTSP URL, or after IP)
    let label: string | null = null;
    if (ip) {
      const afterIp = input.substring(input.indexOf(ip) + ip.length).trim();
      if (rtspUrl) {
        const beforeRtsp = afterIp.substring(0, afterIp.indexOf('rtsp://')).trim();
        label = beforeRtsp || null;
      } else if (httpUrl) {
        const beforeHttp = afterIp.substring(0, afterIp.indexOf('http')).trim();
        label = beforeHttp || null;
      } else {
        // Take first word after IP as label
        const words = afterIp.split(/\s+/);
        label = words[0] || null;
      }
    }

    // Determine device type
    const lowerInput = input.toLowerCase();
    let deviceType: 'camera' | 'server' | 'sensor' | 'other' = 'camera';
    if (lowerInput.includes('serwer') || lowerInput.includes('server')) {
      deviceType = 'server';
    } else if (lowerInput.includes('czujnik') || lowerInput.includes('sensor')) {
      deviceType = 'sensor';
    } else if (lowerInput.includes('urządzenie') && !lowerInput.includes('kamer')) {
      deviceType = 'other';
    }

    return {
      ip,
      label,
      rtspUrl,
      httpUrl,
      username,
      password,
      streamPath: rtspUrl ? new URL(rtspUrl).pathname : null,
      deviceType,
    };
  }

  private parseConfigureCommand(input: string): {
    identifier: string | null;
  } {
    // Extract IP or label after "konfiguruj kamerę/urządzenie"
    const match = input.match(/konfiguruj\s+(?:kamer[ęe]|urz[ąa]dzenie)\s+(.+)/i);
    if (match) {
      return { identifier: match[1].trim() };
    }

    // Try to extract IP
    const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    if (ipMatch) {
      return { identifier: ipMatch[1] };
    }

    return { identifier: null };
  }

  private getDeviceTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      camera: '📹 Kamera',
      server: '🖥️ Serwer',
      sensor: '🌡️ Czujnik',
      other: '🔧 Inne',
    };
    return labels[type] || type;
  }
}

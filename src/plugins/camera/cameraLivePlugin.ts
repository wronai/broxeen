import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { detectCameraVendor, getVendorInfo, buildRtspUrl, buildSnapshotUrl, CAMERA_VENDORS } from './cameraVendorDatabase';

export class CameraLivePlugin implements Plugin {
  readonly id = 'camera-live';
  readonly name = 'Camera Live Preview';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:live', 'camera:preview', 'camera:snapshot'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    
    // Handle "pokaż live IP" commands
    if (/pokaż.*live|pokaz.*live|live.*preview|podgląd.*live|podglad.*live/i.test(input)) {
      return true;
    }
    
    // Handle direct RTSP URLs
    if (/^rtsp:\/\//i.test(input)) {
      return true;
    }
    
    return false;
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    
    // Extract IP address or RTSP URL
    let ip: string | null = null;
    let rtspUrl: string | null = null;
    let username = 'admin';
    let password = '';
    
    // Check if input is direct RTSP URL
    const rtspMatch = input.match(/rtsp:\/\/(?:([^:]+):([^@]+)@)?([^:\/]+)(?::(\d+))?(.+)?/i);
    if (rtspMatch) {
      username = rtspMatch[1] || 'admin';
      password = rtspMatch[2] || '';
      ip = rtspMatch[3];
      const port = rtspMatch[4] || '554';
      const path = rtspMatch[5] || '/stream';
      rtspUrl = input.trim();
    } else {
      // Extract IP from "pokaż live IP" command
      const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (ipMatch) {
        ip = ipMatch[1];
        
        // Try to get credentials from config store
        const storedUsername = context.configStore?.get(`camera.credentials.${ip}.username`);
        const storedPassword = context.configStore?.get(`camera.credentials.${ip}.password`);
        
        if (storedUsername) {
          username = storedUsername as string;
          password = (storedPassword as string) || '';
        }
        
        // Build RTSP URL
        const auth = username && password ? `${username}:${password}@` : '';
        rtspUrl = `rtsp://${auth}${ip}:554/stream`;
      }
    }
    
    if (!ip || !rtspUrl) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: '❌ Nie znaleziono adresu IP kamery.\n\n' +
            'Użyj:\n' +
            '- `pokaż live 192.168.1.100`\n' +
            '- `rtsp://admin:hasło@192.168.1.100:554/stream`'
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
    
    // Generate snapshot URLs for different camera types
    const snapshotUrls = this.generateSnapshotUrls(ip, username, password);
    
    let data = `📹 **Podgląd live z kamery**\n\n`;
    data += `🌐 **IP:** ${ip}\n`;
    if (username) {
      data += `👤 **User:** ${username}\n`;
    }
    data += `\n🎥 **RTSP Stream:**\n\`${rtspUrl}\`\n`;
    data += `*(Otwórz w VLC → Media → Otwórz strumień sieciowy)*\n\n`;
    
    data += `📸 **HTTP Snapshot URLs:**\n`;
    snapshotUrls.forEach((url, index) => {
      data += `${index + 1}. \`${url.label}\`\n   \`${url.url}\`\n`;
    });
    
    data += `\n💡 **Jak używać:**\n`;
    data += `- Skopiuj RTSP URL do VLC lub innego odtwarzacza\n`;
    data += `- Otwórz HTTP snapshot URL w przeglądarce (odświeżaj F5)\n`;
    data += `- Użyj \`monitoruj ${ip} user:${username} admin:${password || 'HASŁO'}\` dla automatycznego monitoringu\n`;
    
    data += `\n---\n💡 **Sugerowane akcje:**\n`;
    data += `- "monitoruj ${ip} user:${username} admin:${password || 'HASŁO'}" — Rozpocznij monitoring\n`;
    data += `- "przeglądaj http://${ip}" — Otwórz interfejs web kamery\n`;
    
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data,
        title: `Live Preview: ${ip}`,
      }],
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  private generateSnapshotUrls(ip: string, username: string, password: string): Array<{ label: string; url: string }> {
    const auth = username && password ? `${username}:${password}@` : '';
    
    return [
      {
        label: 'Hikvision ISAPI (główny kanał)',
        url: `http://${auth}${ip}/ISAPI/Streaming/channels/101/picture`,
      },
      {
        label: 'Hikvision ISAPI (sub-stream)',
        url: `http://${auth}${ip}/ISAPI/Streaming/channels/102/picture`,
      },
      {
        label: 'Dahua CGI',
        url: `http://${auth}${ip}/cgi-bin/snapshot.cgi`,
      },
      {
        label: 'Generic /snapshot.jpg',
        url: `http://${auth}${ip}/snapshot.jpg`,
      },
      {
        label: 'Generic /cgi-bin/snapshot',
        url: `http://${auth}${ip}/cgi-bin/snapshot`,
      },
    ];
  }

  async initialize(context: PluginContext): Promise<void> {
    console.log('CameraLivePlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('CameraLivePlugin disposed');
  }
}

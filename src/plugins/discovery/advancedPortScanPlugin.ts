/**
 * Advanced Port Scan Plugin with Camera Vendor Detection
 * Performs deep port scanning with service identification and vendor fingerprinting
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { 
  CAMERA_VENDORS, 
  getAllCameraPorts, 
  identifyVendor, 
  generateRtspUrls,
  generateRecommendations,
  type CameraDetectionResult,
  type PortScanResult 
} from './cameraDetection';

export class AdvancedPortScanPlugin implements Plugin {
  readonly id = 'advanced-port-scan';
  readonly name = 'Advanced Port Scanner';
  readonly description = 'Deep port scanning with camera vendor detection and authentication methods';
  readonly supportedIntents = ['network:port-scan', 'network:deep-scan', 'camera:detect'];

  canHandle(input: string): boolean {
    const lower = input.toLowerCase();
    return /skanuj.*porty|scan.*ports|wykryj.*kamery.*szczegół|deep.*scan|zaawansowane.*skanowanie/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    
    // Extract IP or subnet from input
    const ipMatch = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const subnetMatch = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    
    if (!ipMatch && !subnetMatch) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: '❌ Podaj adres IP lub podsieć do skanowania.\n\nPrzykłady:\n- `skanuj porty 192.168.188.146`\n- `skanuj porty 192.168.188`',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const targetIp = ipMatch ? ipMatch[1] : null;
    const targetSubnet = subnetMatch ? subnetMatch[1] : null;

    if (targetIp) {
      // Single IP scan
      const result = await this.scanSingleHost(targetIp);
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: this.formatSingleHostResult(result),
          title: `Skanowanie portów: ${targetIp}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } else if (targetSubnet) {
      // Subnet scan (limited to common camera IPs)
      const results = await this.scanSubnet(targetSubnet);
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: this.formatSubnetResults(results, targetSubnet),
          title: `Skanowanie podsieci: ${targetSubnet}.0/24`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    return {
      pluginId: this.id,
      status: 'error',
      content: [{ type: 'text', data: 'Nie udało się przetworzyć zapytania' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async scanSingleHost(ip: string): Promise<CameraDetectionResult> {
    console.log(`[AdvancedPortScan] Scanning ${ip}...`);
    
    const allPorts = getAllCameraPorts();
    const openPorts: PortScanResult[] = [];
    
    // Scan all camera-related ports
    for (const port of allPorts) {
      const result = await this.probePort(ip, port);
      if (result.open) {
        openPorts.push(result);
      }
    }

    console.log(`[AdvancedPortScan] Found ${openPorts.length} open ports on ${ip}`);

    // Try to fetch HTTP content for vendor identification
    let vendor: string | undefined;
    let vendorConfidence = 0;
    let httpContent = '';
    let headers: Record<string, string> = {};

    for (const portResult of openPorts) {
      if (portResult.service === 'http' || portResult.service === 'https') {
        try {
          const response = await this.fetchHttpContent(ip, portResult.port);
          if (response) {
            httpContent = response.content;
            headers = response.headers;
            
            const vendorResult = identifyVendor(httpContent, headers);
            if (vendorResult && vendorResult.confidence > vendorConfidence) {
              vendor = vendorResult.vendor;
              vendorConfidence = vendorResult.confidence;
            }
          }
        } catch (err) {
          console.warn(`[AdvancedPortScan] Failed to fetch HTTP from ${ip}:${portResult.port}`, err);
        }
      }
    }

    // Build detection result
    const detectedServices = [...new Set(openPorts.map(p => p.service))];
    const vendorInfo = vendor ? CAMERA_VENDORS[vendor] : CAMERA_VENDORS.generic;
    
    const result: CameraDetectionResult = {
      ip,
      vendor,
      vendorConfidence,
      openPorts,
      detectedServices,
      authMethods: vendorInfo.authMethods,
      defaultCredentials: vendorInfo.defaultCredentials,
      rtspUrls: generateRtspUrls(ip, vendor),
      httpUrls: openPorts
        .filter(p => p.service === 'http' || p.service === 'https')
        .map(p => `${p.service}://${ip}:${p.port}`),
      onvifUrl: openPorts.find(p => p.service === 'onvif') 
        ? `http://${ip}:${openPorts.find(p => p.service === 'onvif')!.port}/onvif/device_service`
        : undefined,
      features: vendorInfo.features,
      recommendations: [],
    };

    result.recommendations = generateRecommendations(result);

    return result;
  }

  private async scanSubnet(subnet: string): Promise<CameraDetectionResult[]> {
    console.log(`[AdvancedPortScan] Scanning subnet ${subnet}.0/24...`);
    
    // Scan common camera IPs
    const commonIps = [1, 100, 101, 102, 103, 110, 146, 150, 200, 201, 250];
    const results: CameraDetectionResult[] = [];

    for (const offset of commonIps) {
      const ip = `${subnet}.${offset}`;
      const result = await this.scanSingleHost(ip);
      
      if (result.openPorts.length > 0) {
        results.push(result);
      }
    }

    return results;
  }

  private async probePort(ip: string, port: number): Promise<PortScanResult> {
    const t0 = Date.now();
    
    // Determine service type
    let service = 'unknown';
    if ([80, 81, 82, 8000, 8080, 8888, 9000].includes(port)) service = 'http';
    if ([443, 8443].includes(port)) service = 'https';
    if ([554, 8554, 7447].includes(port)) service = 'rtsp';
    if ([2020, 3702].includes(port)) service = 'onvif';
    if ([37777, 37778].includes(port)) service = 'sdk';

    // Try HTTP probe
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      
      const protocol = service === 'https' ? 'https' : 'http';
      const response = await fetch(`${protocol}://${ip}:${port}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      });
      
      clearTimeout(timer);
      const responseTime = Date.now() - t0;
      
      return {
        port,
        protocol: 'tcp',
        service,
        open: true,
        responseTime,
      };
    } catch (err) {
      const elapsed = Date.now() - t0;
      
      // Timing-based detection: real connection attempts take longer
      if (elapsed > 50) {
        return {
          port,
          protocol: 'tcp',
          service,
          open: true,
          responseTime: elapsed,
        };
      }
      
      return {
        port,
        protocol: 'tcp',
        service,
        open: false,
      };
    }
  }

  private async fetchHttpContent(ip: string, port: number): Promise<{ content: string; headers: Record<string, string> } | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`http://${ip}:${port}/`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timer);
      
      const content = await response.text();
      const headers: Record<string, string> = {};
      
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      
      return { content, headers };
    } catch (err) {
      return null;
    }
  }

  private formatSingleHostResult(result: CameraDetectionResult): string {
    const lines: string[] = [];
    
    lines.push(`🔍 **Zaawansowane skanowanie portów**\n`);
    lines.push(`**IP:** ${result.ip}`);
    
    if (result.vendor) {
      const vendor = CAMERA_VENDORS[result.vendor];
      lines.push(`**Producent:** ${vendor.name} (pewność: ${result.vendorConfidence}%)`);
    }
    
    lines.push(`**Otwarte porty:** ${result.openPorts.length}\n`);
    
    // Group ports by service
    const portsByService: Record<string, number[]> = {};
    result.openPorts.forEach(p => {
      if (!portsByService[p.service]) portsByService[p.service] = [];
      portsByService[p.service].push(p.port);
    });
    
    lines.push(`### 📡 Wykryte usługi:\n`);
    for (const [service, ports] of Object.entries(portsByService)) {
      const icon = service === 'http' ? '🌐' : service === 'rtsp' ? '📹' : service === 'onvif' ? '🎥' : '🔌';
      lines.push(`${icon} **${service.toUpperCase()}:** ${ports.join(', ')}`);
    }
    
    if (result.httpUrls.length > 0) {
      lines.push(`\n### 🌐 Web Interface:\n`);
      result.httpUrls.forEach(url => {
        lines.push(`- ${url}`);
      });
    }
    
    if (result.rtspUrls.length > 0) {
      lines.push(`\n### 📹 RTSP Streams (do przetestowania):\n`);
      result.rtspUrls.slice(0, 5).forEach(url => {
        lines.push(`- \`${url}\``);
      });
    }
    
    if (result.onvifUrl) {
      lines.push(`\n### 🎥 ONVIF:\n`);
      lines.push(`- ${result.onvifUrl}`);
    }
    
    if (result.defaultCredentials.length > 0) {
      lines.push(`\n### 🔑 Domyślne hasła do przetestowania:\n`);
      result.defaultCredentials.forEach(cred => {
        const user = cred.username || '(brak)';
        const pass = cred.password || '(puste)';
        lines.push(`- **${user}** : **${pass}** — ${cred.description}`);
      });
    }
    
    if (result.authMethods.length > 0) {
      lines.push(`\n### 🔐 Metody autoryzacji:\n`);
      lines.push(result.authMethods.map(m => `- ${m}`).join('\n'));
    }
    
    if (result.features.length > 0) {
      lines.push(`\n### ✨ Funkcje:\n`);
      lines.push(result.features.map(f => `- ${f}`).join('\n'));
    }
    
    lines.push(`\n---`);
    lines.push(`💡 **Sugerowane akcje:**`);
    lines.push(`- "monitoruj ${result.ip}" — Rozpocznij monitorowanie`);
    if (result.httpUrls.length > 0) {
      lines.push(`- "przeglądaj ${result.httpUrls[0]}" — Otwórz interfejs web`);
    }
    
    return lines.join('\n');
  }

  private formatSubnetResults(results: CameraDetectionResult[], subnet: string): string {
    const lines: string[] = [];
    
    lines.push(`🔍 **Zaawansowane skanowanie podsieci ${subnet}.0/24**\n`);
    lines.push(`Znaleziono: **${results.length}** urządzeń z otwartymi portami\n`);
    
    if (results.length === 0) {
      lines.push(`❌ Nie znaleziono żadnych urządzeń na typowych adresach IP kamer.`);
      lines.push(`\n💡 Spróbuj:`);
      lines.push(`- "skanuj porty ${subnet}.146" — Skanuj konkretny IP`);
      lines.push(`- Uruchom **Tauri app** dla pełnego skanowania ARP`);
      return lines.join('\n');
    }
    
    results.forEach((result, index) => {
      lines.push(`\n### ${index + 1}. ${result.ip}`);
      
      if (result.vendor) {
        const vendor = CAMERA_VENDORS[result.vendor];
        lines.push(`**Producent:** ${vendor.name} (${result.vendorConfidence}%)`);
      }
      
      lines.push(`**Porty:** ${result.openPorts.map(p => `${p.port}/${p.service}`).join(', ')}`);
      
      if (result.httpUrls.length > 0) {
        lines.push(`🌐 Web: ${result.httpUrls[0]}`);
      }
      
      if (result.rtspUrls.length > 0) {
        lines.push(`📹 RTSP: \`${result.rtspUrls[0]}\``);
      }
      
      if (result.defaultCredentials.length > 0) {
        const cred = result.defaultCredentials[0];
        lines.push(`🔑 Domyślne: **${cred.username}**:**${cred.password}**`);
      }
      
      lines.push(`💬 Szczegóły: *"skanuj porty ${result.ip}"*`);
    });
    
    lines.push(`\n---`);
    lines.push(`💡 **Sugerowane akcje:**`);
    results.forEach(r => {
      lines.push(`- "monitoruj ${r.ip}" — Monitoruj ${r.vendor ? CAMERA_VENDORS[r.vendor].name : 'urządzenie'}`);
    });
    
    return lines.join('\n');
  }
}

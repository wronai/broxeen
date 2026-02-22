/**
 * Network Scan Plugin - provides network discovery capabilities
 * Uses Tauri backend commands for real network scanning.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class NetworkScanPlugin implements Plugin {
  readonly id = 'network-scan';
  readonly name = 'Network Scanner';
  readonly version = '1.0.0';
  readonly supportedIntents = ['network:scan', 'network:discover', 'network:devices', 'camera:describe', 'camera:discover'];

  async initialize(context: PluginContext): Promise<void> {
    console.log('🔧 NetworkScanPlugin.initialize called', { isTauri: context.isTauri });
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
    const start = Date.now();
    const isCameraQuery = input.toLowerCase().includes('kamer') || input.toLowerCase().includes('camera');

    if (context.isTauri && context.tauriInvoke) {
      try {
        console.log(`[NetworkScanPlugin] Starting real network scan via Tauri...`);
        const result = await context.tauriInvoke('scan_network', {
          subnet: null,
          timeout: 5000,
        }) as NetworkScanResult;

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: this.formatScanResult(result, isCameraQuery),
            title: isCameraQuery ? 'Wyniki wyszukiwania kamer' : 'Wyniki skanowania sieci',
          }],
          metadata: {
            duration_ms: Date.now() - start,
            cached: false,
            truncated: false,
            deviceCount: result.devices.length,
            scanDuration: result.scan_duration,
            scanMethod: result.scan_method,
          },
        };
      } catch (error) {
        console.error('[NetworkScanPlugin] scan_network failed:', error);
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: `Błąd skanowania sieci: ${error instanceof Error ? error.message : String(error)}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }
    }

    // Browser fallback: HTTP probe of common LAN addresses
    return this.browserFallback(isCameraQuery, start);
  }

  private async browserFallback(isCameraQuery: boolean, start: number): Promise<PluginResult> {
    // Step 1: Detect local subnet via multiple strategies
    const { localIp, subnet, detectionMethod } = await this.detectSubnet();

    console.log(`[NetworkScanPlugin] Browser scan: subnet=${subnet} (via ${detectionMethod}), localIp=${localIp || 'unknown'}`);

    // Step 2: Build probe list — gateway, common camera IPs, full range sample
    const gatewayIp = `${subnet}.1`;
    const commonCameraIps = [100, 101, 102, 103, 108, 110, 150, 200, 201, 250];
    const rangeIps = Array.from({ length: 50 }, (_, i) => i + 2); // .2-.51
    const allOffsets = new Set([1, ...commonCameraIps, ...rangeIps]);
    const probeIps = [...allOffsets].map(n => `${subnet}.${n}`);

    // Step 3: HTTP probe (image + no-cors fetch) on ports common to cameras and routers
    const httpPorts = isCameraQuery ? [80, 8080, 8000, 8888] : [80, 443, 8080];
    const httpFound: Array<{ ip: string; port: number }> = [];

    const probeHttp = (ip: string, port: number): Promise<void> =>
      new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) { settled = true; httpFound.push({ ip, port }); }
          resolve();
        };
        const fail = () => { if (!settled) { settled = true; } resolve(); };
        const t0 = Date.now();

        // Image probe: bypasses CORS, onerror with >50ms = real TCP connection
        const img = new Image();
        const imgTimer = setTimeout(() => { img.src = ''; fail(); }, 1500);
        img.onload = () => { clearTimeout(imgTimer); done(); };
        img.onerror = () => {
          clearTimeout(imgTimer);
          // Timing gate: jsdom fires onerror in ~0ms; real TCP takes >50ms
          if (Date.now() - t0 > 50) { done(); } else { fail(); }
        };
        img.src = `http://${ip}:${port}/favicon.ico?_t=${Date.now()}`;

        // no-cors fetch: opaque response = host reachable
        fetch(`http://${ip}:${port}/`, {
          method: 'HEAD', mode: 'no-cors',
          signal: AbortSignal.timeout(1500),
        }).then(() => { clearTimeout(imgTimer); done(); }).catch(() => {});
      });

    const batchSize = 30;
    for (let i = 0; i < probeIps.length; i += batchSize) {
      const batch = probeIps.slice(i, i + batchSize);
      await Promise.allSettled(batch.flatMap(ip => httpPorts.map(port => probeHttp(ip, port))));
    }

    // Deduplicate HTTP results by IP
    const httpByIp = new Map<string, number>();
    for (const { ip, port } of httpFound) {
      if (!httpByIp.has(ip)) httpByIp.set(ip, port);
    }
    const httpHosts = [...httpByIp.entries()].map(([ip, port]) => ({ ip, port }));

    // Step 4: Secondary RTSP probe on found HTTP hosts (port 8554 also, 554 is TCP-only but img timing works)
    const rtspHosts = new Set<string>();
    if (httpHosts.length > 0) {
      await Promise.allSettled(
        httpHosts.map(({ ip }) =>
          new Promise<void>((resolve) => {
            const t0 = Date.now();
            const img = new Image();
            const timer = setTimeout(() => { img.src = ''; resolve(); }, 1200);
            img.onload = () => { clearTimeout(timer); rtspHosts.add(ip); resolve(); };
            img.onerror = () => {
              clearTimeout(timer);
              if (Date.now() - t0 > 50) { rtspHosts.add(ip); }
              resolve();
            };
            img.src = `http://${ip}:554/?_t=${Date.now()}`;
          })
        )
      );
    }

    // Step 5: Classify and format results
    const lines = [
      isCameraQuery
        ? `📷 **Wyszukiwanie kamer** *(tryb przeglądarkowy)*\n`
        : `🔍 **Skanowanie sieci** *(tryb przeglądarkowy)*\n`,
      `🌐 **Podsieć:** ${subnet}.0/24 *(wykryta: ${detectionMethod})*`,
      `Przeskanowano: ${probeIps.length} adresów IP`,
      `Znaleziono: ${httpHosts.length} aktywnych hostów\n`,
    ];

    if (httpHosts.length === 0) {
      lines.push('Nie wykryto urządzeń w sieci.');
      lines.push('');
      lines.push('**Możliwe przyczyny:**');
      lines.push('- Przeglądarka blokuje skanowanie LAN (CORS/mixed-content)');
      lines.push('- Urządzenia są w innej podsieci');
      lines.push(`- Twój adres IP: ${localIp || 'nie wykryto'}`);
      lines.push('');
      lines.push('💡 **Rozwiązania:**');
      lines.push('- Uruchom aplikację **Tauri** dla pełnego skanowania TCP/ARP');
      lines.push('- Podaj bezpośrednio IP kamery: *"monitoruj 192.168.1.100"*');
      lines.push('- Sprawdź router pod adresem: `http://' + gatewayIp + '`');
    } else {
      const cameras: string[] = [];
      const others: string[] = [];

      for (const { ip, port } of httpHosts) {
        const hasRtsp = rtspHosts.has(ip);
        const isCameraPort = [8000, 8080, 8888].includes(port);
        const isCamera = hasRtsp || isCameraPort;

        if (isCamera) {
          cameras.push(ip);
          lines.push(`📷 **${ip}** *(kamera)* — port HTTP: ${port}${hasRtsp ? ', RTSP: 554' : ''}`);
          lines.push(`   🎥 RTSP: \`rtsp://${ip}:554/stream\``);
          lines.push(`   🌐 HTTP: \`http://${ip}:${port}\``);
          lines.push(`   💬 Monitoruj: *"monitoruj ${ip}"*`);
        } else {
          others.push(ip);
          lines.push(`🖥️ **${ip}** — port: ${port}`);
          lines.push(`   🌐 \`http://${ip}:${port}\``);
        }
      }

      if (isCameraQuery && cameras.length === 0 && others.length > 0) {
        lines.push('');
        lines.push('ℹ️ *Nie wykryto kamer RTSP. Znalezione hosty to prawdopodobnie routery/urządzenia sieciowe.*');
        lines.push('💡 Jeśli kamera ma inny IP, podaj go bezpośrednio: *"monitoruj 192.168.1.200"*');
      }

      lines.push('');
      lines.push('💡 *Dla pełnego skanowania TCP/ARP uruchom aplikację **Tauri**.*');
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: isCameraQuery ? 'Kamery (przeglądarka)' : 'Sieć (przeglądarka)' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false } as any,
    };
  }

  /**
   * Multi-strategy local subnet detection:
   * 1. WebRTC ICE candidates (works in Chrome/Firefox, not Tauri WebKitGTK)
   * 2. Gateway probe — try common gateway IPs to infer subnet
   * 3. Default fallback
   */
  private async detectSubnet(): Promise<{ localIp: string | null; subnet: string; detectionMethod: string }> {
    // Strategy 1: WebRTC
    const webrtcIp = await this.detectLocalIpViaWebRTC();
    if (webrtcIp) {
      return {
        localIp: webrtcIp,
        subnet: webrtcIp.split('.').slice(0, 3).join('.'),
        detectionMethod: 'WebRTC',
      };
    }

    // Strategy 2: Probe common gateway IPs — first to respond wins
    const candidateSubnets = ['192.168.1', '192.168.0', '10.0.0', '10.0.1', '172.16.0'];
    const gatewayResult = await this.probeGateways(candidateSubnets);
    if (gatewayResult) {
      console.log(`[NetworkScanPlugin] Subnet detected via gateway probe: ${gatewayResult}`);
      return { localIp: null, subnet: gatewayResult, detectionMethod: 'gateway-probe' };
    }

    // Strategy 3: Default
    return { localIp: null, subnet: '192.168.1', detectionMethod: 'domyślna' };
  }

  private detectLocalIpViaWebRTC(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);

      try {
        const RTCPeerConnection = (window as any).RTCPeerConnection
          || (window as any).webkitRTCPeerConnection
          || (window as any).mozRTCPeerConnection;

        if (!RTCPeerConnection) {
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        // Use null iceServers to get only host candidates (no STUN needed for LAN IP)
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');

        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (!event.candidate) {
            // Gathering complete, no LAN IP found
            clearTimeout(timeout);
            pc.close();
            resolve(null);
            return;
          }
          const candidate = event.candidate.candidate;
          const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          if (ipMatch) {
            const ip = ipMatch[1];
            if (this.isPrivateIp(ip)) {
              clearTimeout(timeout);
              pc.close();
              console.log(`[NetworkScanPlugin] WebRTC local IP: ${ip}`);
              resolve(ip);
            }
          }
        };

        pc.createOffer()
          .then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer))
          .catch(() => { clearTimeout(timeout); resolve(null); });
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }

  private async probeGateways(subnets: string[]): Promise<string | null> {
    // Race all gateway probes — first reachable gateway reveals the subnet
    return new Promise((resolve) => {
      let resolved = false;
      let pending = subnets.length;

      const done = (subnet: string | null) => {
        if (!resolved) {
          resolved = true;
          resolve(subnet);
        }
      };

      for (const subnet of subnets) {
        const gatewayIp = `${subnet}.1`;
        const t0 = Date.now();
        const img = new Image();
        const timer = setTimeout(() => { img.src = ''; if (--pending === 0) done(null); }, 1000);

        img.onload = () => {
          clearTimeout(timer);
          done(subnet);
        };
        img.onerror = () => {
          clearTimeout(timer);
          if (Date.now() - t0 > 50) {
            done(subnet); // Gateway responded (even with error = it's reachable)
          } else {
            if (--pending === 0) done(null);
          }
        };
        img.src = `http://${gatewayIp}/favicon.ico?_t=${Date.now()}`;
      }
    });
  }

  private isPrivateIp(ip: string): boolean {
    return ip.startsWith('192.168.') ||
      ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }

  private formatScanResult(result: NetworkScanResult, isCameraQuery = false): string {
    const { devices, scan_duration, scan_method } = result;

    let content = isCameraQuery
      ? `📷 **Wyszukiwanie kamer zakończone**\n\n`
      : `🔍 **Skanowanie sieci zakończone**\n\n`;

    content += `Metoda: ${scan_method}\n`;
    content += `Czas trwania: ${scan_duration}ms\n`;
    content += `Znaleziono urządzeń: ${devices.length}\n\n`;

    if (devices.length === 0) {
      content += `Nie znaleziono żadnych urządzeń w sieci.\n`;
    } else {
      const relevantDevices = isCameraQuery
        ? devices.filter(d =>
            d.device_type === 'camera' ||
            d.hostname?.toLowerCase().includes('cam') ||
            d.vendor?.toLowerCase().includes('hikvision') ||
            d.vendor?.toLowerCase().includes('dahua') ||
            d.open_ports.some(p => [554, 8554].includes(p))
          )
        : devices;

      if (isCameraQuery && relevantDevices.length === 0) {
        content += `Nie znaleziono kamer w sieci.\n\n**Wszystkie znalezione urządzenia:**\n\n`;
      } else {
        content += isCameraQuery ? `**Znalezione kamery:**\n\n` : `**Znalezione urządzenia:**\n\n`;
      }

      const devicesToShow = isCameraQuery && relevantDevices.length > 0 ? relevantDevices : devices;

      devicesToShow.forEach((device, index) => {
        content += `${index + 1}. **${device.ip}**`;
        if (device.device_type) content += ` *(${device.device_type})*`;
        content += '\n';
        if (device.hostname) content += `   Hostname: ${device.hostname}\n`;
        if (device.mac) content += `   MAC: \`${device.mac}\`\n`;
        if (device.vendor) content += `   Producent: ${device.vendor}\n`;
        if (device.open_ports.length > 0) content += `   Porty: ${device.open_ports.join(', ')}\n`;
        content += `   RTT: ${device.response_time}ms\n`;
        if (device.open_ports.includes(554)) {
          content += `   📷 RTSP: \`rtsp://${device.ip}:554/stream\`\n`;
        }
        content += '\n';
      });
    }

    content += `💡 *Zapytaj "pokaż kamerę [IP]" aby zobaczyć obraz lub "skanuj porty [IP]" dla szczegółów.*`;
    return content;
  }

  async dispose(): Promise<void> {
    console.log('Network Scan Plugin disposed');
  }
}

interface NetworkDevice {
  ip: string;
  mac?: string;
  hostname?: string;
  vendor?: string;
  open_ports: number[];
  response_time: number;
  last_seen: string;
  device_type?: string;
}

interface NetworkScanResult {
  devices: NetworkDevice[];
  scan_duration: number;
  scan_method: string;
  subnet: string;
}

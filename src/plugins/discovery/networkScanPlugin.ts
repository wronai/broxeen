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

    console.log(`[NetworkScanPlugin] Execute - isTauri: ${context.isTauri}, hasTauriInvoke: !!${context.tauriInvoke}`);

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

    console.log(`[NetworkScanPlugin] Using browser fallback - isTauri: ${context.isTauri}, hasInvoke: !!${context.tauriInvoke}`);
    // Browser fallback: HTTP probe of common LAN addresses
    return this.browserFallback(isCameraQuery, start);
  }

  private async browserFallback(isCameraQuery: boolean, start: number): Promise<PluginResult> {
    // Step 1: Detect local subnet via multiple strategies
    const { localIp, subnet, detectionMethod } = await this.detectSubnet();

    console.log(`[NetworkScanPlugin] Browser scan: subnet=${subnet} (via ${detectionMethod}), localIp=${localIp || 'unknown'}`);

    // Step 2: Build probe list — gateway, common camera IPs, and strategic range sample
    const gatewayIp = `${subnet}.1`;
    
    // Focus on common camera/device IP ranges instead of full subnet scan
    const commonCameraIps = [100, 101, 102, 103, 108, 110, 150, 200, 201, 250];
    const commonDeviceIps = [2, 10, 20, 30, 50, 60, 70, 80, 90, 120, 130, 140, 160, 170, 180, 190, 210, 220, 240];
    
    // Combine all target IPs, removing duplicates
    const allOffsets = new Set([1, ...commonCameraIps, ...commonDeviceIps]);
    const probeIps = [...allOffsets].map(n => `${subnet}.${n}`);

    // Step 3: Multi-strategy probe on common ports
    const httpPorts = isCameraQuery ? [80, 8080, 8000, 8888, 8554, 81] : [80, 443, 8080];
    const httpFound: Array<{ ip: string; port: number; method: string }> = [];

    // Timing threshold: real TCP handshake takes >15ms even on fast LAN
    // jsdom/blocked requests fire onerror in <5ms
    const TIMING_THRESHOLD_MS = 15;

    const probeHttp = (ip: string, port: number): Promise<void> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (method: string) => {
          if (!settled) { settled = true; httpFound.push({ ip, port, method }); }
          resolve();
        };
        const fail = () => { if (!settled) { settled = true; } resolve(); };
        const t0 = Date.now();

        const probeTimeout = setTimeout(() => {
          fail();
        }, 2500);

        // Strategy A: Image probe — bypasses CORS, timing-gated
        const img = new Image();
        img.onload = () => { clearTimeout(probeTimeout); done('img-load'); };
        img.onerror = () => {
          if (Date.now() - t0 > TIMING_THRESHOLD_MS) {
            clearTimeout(probeTimeout);
            done('img-timing');
          }
        };
        img.src = `http://${ip}:${port}/?_probe=${Date.now()}`;

        // Strategy B: no-cors fetch — opaque response = host reachable
        fetch(`http://${ip}:${port}/`, {
          method: 'HEAD', mode: 'no-cors',
          signal: AbortSignal.timeout(2000),
        }).then(() => {
          clearTimeout(probeTimeout);
          done('fetch-ok');
        }).catch(() => {
          // Expected for most IPs
        });

        // Strategy C: WebSocket probe — connection attempt reveals host
        try {
          const ws = new WebSocket(`ws://${ip}:${port}/`);
          const wsTimer = setTimeout(() => { try { ws.close(); } catch {} }, 2000);
          ws.onopen = () => {
            clearTimeout(wsTimer); clearTimeout(probeTimeout);
            try { ws.close(); } catch {}
            done('ws-open');
          };
          ws.onerror = () => {
            clearTimeout(wsTimer);
            // WebSocket onerror with timing gate — real host triggers TCP handshake
            if (Date.now() - t0 > TIMING_THRESHOLD_MS) {
              clearTimeout(probeTimeout);
              done('ws-timing');
            }
          };
        } catch {
          // WebSocket constructor may throw in some environments
        }
      });

    const batchSize = 10;
    console.log(`[NetworkScanPlugin] Probing ${probeIps.length} IPs × ${httpPorts.length} ports (batch=${batchSize})`);
    
    for (let i = 0; i < probeIps.length; i += batchSize) {
      const batch = probeIps.slice(i, i + batchSize);
      await Promise.allSettled(batch.flatMap(ip => httpPorts.map(port => probeHttp(ip, port))));
      
      if (probeIps.length > 20 && (i + batchSize) % (batchSize * 2) === 0) {
        console.log(`[NetworkScanPlugin] Scan progress: ${Math.min(i + batchSize, probeIps.length)}/${probeIps.length} IPs, found: ${httpFound.length}`);
      }
    }

    // Deduplicate HTTP results by IP (keep first port found)
    const httpByIp = new Map<string, { port: number; method: string }>();
    for (const { ip, port, method } of httpFound) {
      if (!httpByIp.has(ip)) httpByIp.set(ip, { port, method });
    }
    const httpHosts = [...httpByIp.entries()].map(([ip, { port, method }]) => ({ ip, port, method }));
    console.log(`[NetworkScanPlugin] Scan complete: ${httpHosts.length} hosts found`, httpHosts.map(h => `${h.ip}:${h.port}(${h.method})`));

    // Step 4: Secondary RTSP probe on found HTTP hosts (port 8554 also, 554 is TCP-only but img timing works)
    const rtspHosts = new Set<string>();
    if (httpHosts.length > 0) {
      await Promise.allSettled(
        httpHosts.map(({ ip }) =>
          new Promise<void>((resolve) => {
            const t0 = Date.now();
            const img = new Image();
            const timer = setTimeout(() => { 
              img.src = ''; 
              resolve(); 
            }, 1200);
            img.onload = () => { 
              clearTimeout(timer); 
              rtspHosts.add(ip); 
              resolve(); 
            };
            img.onerror = () => {
              clearTimeout(timer);
              // Timing gate: real TCP connection takes >50ms
              if (Date.now() - t0 > 50) { 
                rtspHosts.add(ip); 
              }
              resolve();
            };
            // Use generic probe endpoint for RTSP port as well
            img.src = `http://${ip}:554/?_probe=${Date.now()}`;
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
      lines.push('💡 **Co możesz zrobić:**');
      lines.push('');
      lines.push('**1. Podaj IP kamery bezpośrednio:**');
      lines.push(`- "monitoruj ${subnet}.100" — sprawdź konkretny adres`);
      lines.push(`- "ping ${subnet}.1" — sprawdź gateway`);
      lines.push('');
      lines.push('**2. Sprawdź router:**');
      lines.push(`- Otwórz panel routera: \`http://${gatewayIp}\``);
      lines.push('- Lista DHCP pokaże wszystkie urządzenia w sieci');
      lines.push('');
      lines.push('**3. Uruchom Tauri:**');
      lines.push('- Pełne skanowanie TCP/ARP/ONVIF bez ograniczeń przeglądarki');
      lines.push('');
      lines.push('---');
      lines.push('💡 **Sugerowane akcje:**');
      lines.push(`- "monitoruj ${subnet}.100" — Sprawdź typowy IP kamery`);
      lines.push(`- "ping ${subnet}.1" — Sprawdź gateway`);
      lines.push(`- "skanuj porty ${subnet}.1" — Porty routera`);
      lines.push(`- "bridge rest GET http://${gatewayIp}" — Pobierz stronę routera`);
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
    console.log(`[NetworkScanPlugin] Starting subnet detection...`);
    
    // Strategy 1: WebRTC
    const webrtcIp = await this.detectLocalIpViaWebRTC();
    if (webrtcIp) {
      const subnet = webrtcIp.split('.').slice(0, 3).join('.');
      console.log(`[NetworkScanPlugin] WebRTC detected: IP=${webrtcIp}, subnet=${subnet}`);
      return {
        localIp: webrtcIp,
        subnet,
        detectionMethod: 'WebRTC',
      };
    }
    console.log(`[NetworkScanPlugin] WebRTC failed, trying gateway probe...`);

    // Strategy 2: Probe common gateway IPs — first to respond wins
    const candidateSubnets = [
      '192.168.1', '192.168.0', '192.168.188', '192.168.2', '192.168.10',
      '10.0.0', '10.0.1', '10.1.1',
      '172.16.0', '172.16.1'
    ];
    console.log(`[NetworkScanPlugin] Probing gateways for subnets: ${candidateSubnets.join(', ')}`);
    
    const gatewayResult = await this.probeGateways(candidateSubnets);
    if (gatewayResult) {
      console.log(`[NetworkScanPlugin] Subnet detected via gateway probe: ${gatewayResult}`);
      return { localIp: null, subnet: gatewayResult, detectionMethod: 'gateway-probe' };
    }
    console.log(`[NetworkScanPlugin] Gateway probe failed, using default subnet...`);

    // Strategy 3: Default - use more common subnet
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
        const timer = setTimeout(() => { 
          img.src = ''; 
          if (--pending === 0) done(null); 
        }, 1000);

        img.onload = () => {
          clearTimeout(timer);
          done(subnet);
        };
        img.onerror = () => {
          clearTimeout(timer);
          // Timing gate: real TCP connection takes >50ms
          if (Date.now() - t0 > 50) {
            done(subnet); // Gateway responded (even with error = it's reachable)
          } else {
            if (--pending === 0) done(null);
          }
        };
        // Use generic probe endpoint for gateway as well
        img.src = `http://${gatewayIp}/?_probe=${Date.now()}`;
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

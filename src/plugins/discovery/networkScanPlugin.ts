/**
 * Network Scan Plugin - provides network discovery capabilities
 * Uses Tauri backend commands for real network scanning.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { processRegistry } from '../../core/processRegistry';
import { configStore } from '../../config/configStore';
import { DeviceRepository } from '../../persistence/deviceRepository';

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
    const scanId = `scan:${Date.now()}`;
    const scanLabel = isCameraQuery ? 'Skanowanie kamer' : 'Skanowanie sieci';

    // Extract subnet from input if provided (e.g. "skanuj 192.168.188" or "pokaż kamery 192.168.0")
    const subnetMatch = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const userSpecifiedSubnet = subnetMatch ? subnetMatch[1] : null;
    
    if (userSpecifiedSubnet) {
      console.log(`[NetworkScanPlugin] User specified subnet: ${userSpecifiedSubnet}`);
    }

    processRegistry.upsertRunning({
      id: scanId,
      type: 'scan',
      label: scanLabel,
      pluginId: this.id,
      details: context.isTauri ? 'Tauri backend' : 'tryb przeglądarkowy',
    });

    console.log(`[NetworkScanPlugin] Execute - isTauri: ${context.isTauri}, hasTauriInvoke: !!${context.tauriInvoke}`);

    try {
      if (context.isTauri && context.tauriInvoke) {
        try {
          console.log(`[NetworkScanPlugin] Starting real network scan via Tauri...`);
          const result = await context.tauriInvoke('scan_network', {
            subnet: userSpecifiedSubnet,
            timeout: 5000,
          }) as NetworkScanResult;

          // Persist discovered devices to SQLite
          this.persistDevices(result.devices, context).catch((err) =>
            console.warn('[NetworkScanPlugin] Device persistence failed:', err),
          );

          processRegistry.complete(scanId);
          processRegistry.remove(scanId);
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
          processRegistry.fail(scanId, String(error));
          processRegistry.remove(scanId);
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
      const fallbackResult = await this.browserFallback(isCameraQuery, start, userSpecifiedSubnet, context);
      processRegistry.complete(scanId);
      processRegistry.remove(scanId);
      return fallbackResult;
    } catch (err) {
      processRegistry.fail(scanId, String(err));
      processRegistry.remove(scanId);
      throw err;
    }
  }

  private async browserFallback(
    isCameraQuery: boolean,
    start: number,
    userSpecifiedSubnet: string | null = null,
    context?: PluginContext,
  ): Promise<PluginResult> {
    // Step 1: Detect local subnet (or use user-specified one)
    let localIp: string | null = null;
    let subnet: string;
    let detectionMethod: string;
    
    if (userSpecifiedSubnet) {
      // User specified subnet directly (e.g. "skanuj 192.168.188")
      subnet = userSpecifiedSubnet;
      detectionMethod = 'user-specified';
      console.log(`[NetworkScanPlugin] Using user-specified subnet: ${subnet}`);
    } else {
      // Auto-detect subnet
      const detection = await this.detectSubnet(context);
      localIp = detection.localIp;
      subnet = detection.subnet;
      detectionMethod = detection.detectionMethod;
      
      // Handle multiple interfaces - ask user to choose
      if (detectionMethod === 'user-selection-required') {
        const interfaces = (detection as any).interfaces as Array<[string, string]>;
        const lines = [
          '🌐 **Wykryto wiele interfejsów sieciowych**\n',
          'Wybierz interfejs do skanowania:\n',
        ];
        
        interfaces.forEach(([ifaceName, ip], index) => {
          const subnet = ip.split('.').slice(0, 3).join('.');
          lines.push(`**${index + 1}. ${ifaceName}** — ${ip} (podsieć: ${subnet}.0/24)`);
          lines.push(`   💬 Skanuj: *"skanuj ${subnet}"* lub *"pokaż kamery ${subnet}"*\n`);
        });
        
        lines.push('---');
        lines.push('💡 **Sugerowane akcje:**');
        interfaces.forEach(([ifaceName, ip], index) => {
          const subnet = ip.split('.').slice(0, 3).join('.');
          const action = isCameraQuery ? `pokaż kamery ${subnet}` : `skanuj ${subnet}`;
          lines.push(`- "${action}" — Skanuj ${ifaceName} (${ip})`);
        });
        
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ 
            type: 'text', 
            data: lines.join('\n'), 
            title: 'Wybór interfejsu sieciowego' 
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false } as any,
        };
      }
    }

    console.log(`[NetworkScanPlugin] Browser scan: subnet=${subnet} (via ${detectionMethod}), localIp=${localIp || 'unknown'}`);

    // Step 2: Build probe list — gateway, common camera IPs, and strategic range sample
    const gatewayIp = `${subnet}.1`;
    
    // Focus on common camera/device IP ranges instead of full subnet scan
    const netCfg = configStore.getAll().network;
    const commonCameraIps = netCfg.commonCameraIpOffsets;
    const commonDeviceIps = netCfg.commonDeviceIpOffsets;
    
    // Combine all target IPs, removing duplicates
    const allOffsets = new Set([1, ...commonCameraIps, ...commonDeviceIps]);
    const probeIps = [...allOffsets].map(n => `${subnet}.${n}`);

    // Step 3: Multi-strategy probe on common ports
    const httpPorts = isCameraQuery ? netCfg.cameraPorts : netCfg.generalPorts;
    const httpFound: Array<{ ip: string; port: number; method: string }> = [];

    // fetch no-cors: resolves (opaque) = host alive on that port, rejects = unreachable/closed.
    // Timing gates are removed — they cause false positives in WebKitGTK/Chromium
    // because CORS-blocked requests to non-existent IPs often take >15ms.
    const probeHttp = (ip: string, port: number): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), netCfg.probeTimeoutMs);
      return fetch(`http://${ip}:${port}/`, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
      })
        .then(() => {
          httpFound.push({ ip, port, method: 'fetch-ok' });
        })
        .catch(() => {
          // Host not reachable on this port — expected for most IPs
        })
        .finally(() => {
          clearTimeout(timer);
        });
    };

    const batchSize = netCfg.batchSize;
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

    // Step 4: IPs with port 554 or 8554 already captured in httpFound — mark as RTSP cameras
    const rtspHosts = new Set<string>();
    for (const { ip, port } of httpFound) {
      if (port === 554 || port === 8554) rtspHosts.add(ip);
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
        const isCamera = hasRtsp; // only confirmed RTSP port 554/8554 = camera

        if (isCamera) {
          cameras.push(ip);
          const rtspPort = httpFound.find(h => h.ip === ip && (h.port === 8554))?.port === 8554 ? 8554 : 554;
          lines.push(`📷 **${ip}** *(kamera RTSP)*`);
          lines.push(`   🎥 RTSP: \`rtsp://${ip}:${rtspPort}/stream\``);
          if (port !== 554 && port !== 8554) lines.push(`   🌐 HTTP: \`http://${ip}:${port}\``);
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
   * 0. Tauri backend - most reliable (reads from OS network interfaces)
   * 1. WebRTC ICE candidates (works in Chrome/Firefox, not Tauri WebKitGTK)
   * 2. Gateway probe — try common gateway IPs to infer subnet
   * 3. Default fallback
   */
  private async detectSubnet(context?: PluginContext): Promise<{ localIp: string | null; subnet: string; detectionMethod: string }> {
    console.log(`[NetworkScanPlugin] Starting subnet detection...`);
    
    // Strategy 0: Tauri backend via PluginContext invoke bridge
    if (context?.isTauri && context.tauriInvoke) {
      try {
        console.log(`[NetworkScanPlugin] Trying Tauri backend network detection...`);
        
        // Get all network interfaces
        const interfaces = await context.tauriInvoke('list_network_interfaces', {}) as Array<[string, string]>;
        console.log(`[NetworkScanPlugin] Found ${interfaces.length} network interfaces:`, interfaces);
        
        if (interfaces.length === 0) {
          console.warn(`[NetworkScanPlugin] ⚠️ No network interfaces found`);
        } else if (interfaces.length === 1) {
          // Single interface - use it directly
          const [ifaceName, ip] = interfaces[0];
          const subnet = ip.split('.').slice(0, 3).join('.');
          console.log(`[NetworkScanPlugin] ✅ Tauri detected: IP=${ip}, subnet=${subnet}, interface=${ifaceName}`);
          return {
            localIp: ip,
            subnet,
            detectionMethod: `Tauri (${ifaceName})`,
          };
        } else {
          // Multiple interfaces - ask user which one to use
          console.log(`[NetworkScanPlugin] Multiple interfaces detected, prompting user...`);
          
          // Store interfaces for user selection
          (this as any)._pendingInterfaces = interfaces;
          
          // Return special result that triggers user prompt
          return {
            localIp: null,
            subnet: '',
            detectionMethod: 'user-selection-required',
            interfaces, // Pass interfaces for UI to display
          } as any;
        }
      } catch (err) {
        console.warn(`[NetworkScanPlugin] ⚠️ Tauri network detection failed:`, err);
      }
    } else if (context?.isTauri) {
      console.warn('[NetworkScanPlugin] ⚠️ Tauri mode without tauriInvoke bridge, skipping backend subnet detection');
    }
    
    // Strategy 1: WebRTC - most reliable for browser, gets actual local IP from OS
    const webrtcIp = await this.detectLocalIpViaWebRTC();
    if (webrtcIp) {
      const subnet = webrtcIp.split('.').slice(0, 3).join('.');
      console.log(`[NetworkScanPlugin] ✅ WebRTC detected: IP=${webrtcIp}, subnet=${subnet}`);
      return {
        localIp: webrtcIp,
        subnet,
        detectionMethod: 'WebRTC',
      };
    }
    console.log(`[NetworkScanPlugin] ⚠️ WebRTC failed (not supported or blocked), trying gateway probe...`);

    // Strategy 2: Probe common gateway IPs to infer subnet
    // Note: This is a fallback and may detect wrong subnet if multiple networks respond
    const candidateSubnets = this.getCommonSubnets();
    console.log(`[NetworkScanPlugin] Probing ${candidateSubnets.length} common gateways...`);
    
    const gatewayResult = await this.probeGateways(candidateSubnets);
    if (gatewayResult) {
      console.log(`[NetworkScanPlugin] ✅ Gateway probe detected: ${gatewayResult}.0/24`);
      console.warn(`[NetworkScanPlugin] ⚠️ Using gateway probe fallback - may be inaccurate. Consider using Tauri for accurate detection.`);
      return { localIp: null, subnet: gatewayResult, detectionMethod: 'gateway-probe' };
    }
    console.log(`[NetworkScanPlugin] ❌ Gateway probe failed, using default subnet...`);

    // Strategy 3: Default fallback - least reliable
    const fallbackSubnet = configStore.get<string>('network.defaultSubnet');
    console.warn(`[NetworkScanPlugin] ⚠️ Using default subnet ${fallbackSubnet} - this is likely incorrect!`);
    console.warn(`[NetworkScanPlugin] 💡 Tip: Use Tauri app for accurate network detection, or specify IP manually.`);
    return { localIp: null, subnet: fallbackSubnet, detectionMethod: 'domyślna' };
  }

  private getCommonSubnets(): string[] {
    return configStore.get<string[]>('network.commonSubnets');
  }

  private detectLocalIpViaWebRTC(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`[NetworkScanPlugin] WebRTC timeout - no local IP detected in 2s`);
        resolve(null);
      }, 2000);

      try {
        const RTCPeerConnection = (window as any).RTCPeerConnection
          || (window as any).webkitRTCPeerConnection
          || (window as any).mozRTCPeerConnection;

        if (!RTCPeerConnection) {
          console.log(`[NetworkScanPlugin] WebRTC not available (RTCPeerConnection undefined)`);
          clearTimeout(timeout);
          resolve(null);
          return;
        }

        console.log(`[NetworkScanPlugin] WebRTC available, starting ICE candidate gathering...`);
        
        // Use null iceServers to get only host candidates (no STUN needed for LAN IP)
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');

        let candidateCount = 0;
        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (!event.candidate) {
            // Gathering complete, no LAN IP found
            console.log(`[NetworkScanPlugin] WebRTC ICE gathering complete. Candidates found: ${candidateCount}, but no private IP detected.`);
            clearTimeout(timeout);
            pc.close();
            resolve(null);
            return;
          }
          
          candidateCount++;
          const candidate = event.candidate.candidate;
          console.log(`[NetworkScanPlugin] WebRTC candidate #${candidateCount}: ${candidate}`);
          
          const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          if (ipMatch) {
            const ip = ipMatch[1];
            console.log(`[NetworkScanPlugin] WebRTC extracted IP: ${ip}, isPrivate: ${this.isPrivateIp(ip)}`);
            
            if (this.isPrivateIp(ip)) {
              clearTimeout(timeout);
              pc.close();
              console.log(`[NetworkScanPlugin] ✅ WebRTC detected local IP: ${ip}`);
              resolve(ip);
            }
          }
        };

        pc.createOffer()
          .then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer))
          .catch((err: unknown) => { 
            console.error(`[NetworkScanPlugin] WebRTC createOffer failed:`, err);
            clearTimeout(timeout); 
            resolve(null); 
          });
      } catch (err) {
        console.error(`[NetworkScanPlugin] WebRTC exception:`, err);
        clearTimeout(timeout);
        resolve(null);
      }
    });
  }

  private async probeGateways(subnets: string[]): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const settled: Array<boolean | null> = new Array(subnets.length).fill(null);

      const tryResolve = () => {
        if (resolved) return;

        for (let i = 0; i < settled.length; i++) {
          const v = settled[i];
          if (v === null) return;
          if (v === true) {
            resolved = true;
            console.log(`[NetworkScanPlugin] Gateway ${subnets[i]}.1 responded`);
            resolve(subnets[i]);
            return;
          }
        }

        resolved = true;
        resolve(null);
      };

      subnets.forEach((subnet, idx) => {
        this.probeGateway(subnet)
          .then((ok) => {
            settled[idx] = ok;
            tryResolve();
          })
          .catch(() => {
            settled[idx] = false;
            tryResolve();
          });
      });
    });
  }

  private probeGateway(subnet: string): Promise<boolean> {
    const gatewayIp = `${subnet}.1`;
    // Use fetch no-cors: resolves (opaque) = gateway reachable, rejects = unreachable.
    // Timing gates removed — they produce false positives in WebKitGTK/Chromium
    // where CORS-blocked requests to non-existent IPs can take >15ms.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), configStore.get<number>('network.gatewayProbeTimeoutMs'));
    return fetch(`http://${gatewayIp}/`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })
      .then(() => {
        console.log(`[NetworkScanPlugin] Gateway ${gatewayIp} reachable`);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        clearTimeout(timer);
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
      
      // Add inline action hints for cameras
      if (isCameraQuery && devicesToShow.length > 0) {
        content += `\n💡 **Sugerowane akcje:**\n`;
        devicesToShow.forEach(device => {
          const hasRtsp = device.open_ports.includes(554) || device.open_ports.includes(8554);
          const hasHttp = device.open_ports.includes(80) || device.open_ports.includes(8000);
          
          if (hasRtsp) {
            const rtspPort = device.open_ports.includes(554) ? 554 : 8554;
            content += `- "pokaż live ${device.ip}" — Podgląd na żywo z kamery\n`;
            content += `- "monitoruj ${device.ip}" — Rozpocznij monitoring kamery\n`;
          }
          if (hasHttp) {
            const httpPort = device.open_ports.includes(80) ? 80 : 8000;
            content += `- "przeglądaj http://${device.ip}:${httpPort}" — Otwórz interfejs web\n`;
          }
          content += `- "skanuj porty ${device.ip}" — Zaawansowana analiza portów i producenta\n`;
        });
      }
    }

    return content;
  }

  /** Persist discovered devices to SQLite via DeviceRepository. */
  private async persistDevices(devices: NetworkDevice[], context: PluginContext): Promise<void> {
    if (!context.databaseManager || !context.databaseManager.isReady()) return;

    try {
      const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
      const mapped = devices.map((d) => ({
        id: d.mac || d.ip,
        ip: d.ip,
        hostname: d.hostname,
        mac: d.mac,
        vendor: d.vendor,
      }));
      await repo.saveDevices(mapped);

      // Update device status to 'online' for discovered devices
      for (const device of mapped) {
        await repo.updateDeviceStatus(device.id, 'online');
      }

      // Persist services (open ports)
      for (const d of devices) {
        const deviceId = d.mac || d.ip;
        for (const port of d.open_ports) {
          const type = port === 554 || port === 8554 ? 'rtsp'
            : port === 1883 ? 'mqtt'
            : port === 22 ? 'ssh'
            : 'http';
          await repo.saveService({
            id: `${deviceId}:${port}`,
            deviceId,
            type: type as any,
            port,
            status: 'online',
          });
        }
      }

      console.log(`[NetworkScanPlugin] Persisted ${mapped.length} devices to SQLite`);
    } catch (err) {
      console.warn('[NetworkScanPlugin] persistDevices error:', err);
    }
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

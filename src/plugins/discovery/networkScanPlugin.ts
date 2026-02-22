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
    // Step 1: Detect local subnet via WebRTC ICE candidates
    const localIp = await this.detectLocalIp();
    const subnet = localIp
      ? localIp.split('.').slice(0, 3).join('.')
      : '192.168.1';
    const detectionMethod = localIp ? 'WebRTC' : 'domyślna';

    console.log(`[NetworkScanPlugin] Browser scan: subnet=${subnet} (detected via ${detectionMethod}), localIp=${localIp || 'unknown'}`);

    // Step 2: Build probe list — gateway, common camera IPs, full range sample
    const gatewayIp = `${subnet}.1`;
    const commonCameraIps = [100, 101, 102, 103, 108, 110, 150, 200, 201, 250];
    const rangeIps = Array.from({ length: 50 }, (_, i) => i + 2); // .2-.51
    const allOffsets = new Set([1, ...commonCameraIps, ...rangeIps]);
    const probeIps = [...allOffsets].map(n => `${subnet}.${n}`);

    // Step 3: Probe using multiple techniques (image probe + fetch)
    const httpPorts = isCameraQuery ? [80, 8080, 8000, 8888] : [80, 443, 8080];
    const found: Array<{ ip: string; port: number; method: string }> = [];

    const probeOne = (ip: string, port: number): Promise<void> =>
      new Promise((resolve) => {
        let settled = false;
        const done = (method: string) => {
          if (!settled) {
            settled = true;
            found.push({ ip, port, method });
          }
          resolve();
        };
        const fail = () => { if (!settled) { settled = true; } resolve(); };
        const t0 = Date.now();

        // Technique A: Image probe (bypasses CORS — detects HTTP servers)
        const img = new Image();
        const imgTimer = setTimeout(() => { img.src = ''; fail(); }, 1500);
        img.onload = () => { clearTimeout(imgTimer); done('img-load'); };
        img.onerror = () => {
          clearTimeout(imgTimer);
          // Timing gate: real TCP onerror takes >50ms (network round-trip).
          // In jsdom/test environments onerror fires in ~0ms — skip those.
          const elapsed = Date.now() - t0;
          if (elapsed > 50) {
            done('img-error-fast');
          } else {
            fail();
          }
        };
        img.src = `http://${ip}:${port}/favicon.ico?_t=${Date.now()}`;

        // Technique B: fetch with no-cors (opaque response = host up)
        fetch(`http://${ip}:${port}/`, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: AbortSignal.timeout(1500),
        }).then(() => {
          clearTimeout(imgTimer);
          done('fetch-opaque');
        }).catch(() => {
          // fetch failure — ignore, rely on image probe
        });
      });

    // Run probes in parallel batches to avoid overwhelming the browser
    const batchSize = 30;
    for (let i = 0; i < probeIps.length; i += batchSize) {
      const batch = probeIps.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.flatMap(ip => httpPorts.map(port => probeOne(ip, port)))
      );
    }

    // Deduplicate by IP, keep first (lowest port)
    const uniqueMap = new Map<string, { ip: string; port: number; method: string }>();
    for (const entry of found) {
      if (!uniqueMap.has(entry.ip)) uniqueMap.set(entry.ip, entry);
    }
    const unique = [...uniqueMap.values()];

    // Step 4: Format results
    const lines = [
      isCameraQuery
        ? `📷 **Wyszukiwanie kamer** *(tryb przeglądarkowy)*\n`
        : `🔍 **Skanowanie sieci** *(tryb przeglądarkowy)*\n`,
      `🌐 **Podsieć:** ${subnet}.0/24 *(wykryta: ${detectionMethod})*`,
      `Przeskanowano: ${probeIps.length} adresów IP`,
      `Znaleziono: ${unique.length} aktywnych hostów\n`,
    ];

    if (unique.length === 0) {
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
      unique.forEach(({ ip, port }) => {
        const isLikelyCamera = [8000, 8888].includes(port) || ip.match(/\.(10[0-9]|1[1-9][0-9]|2[0-4][0-9]|250)$/);
        const icon = isLikelyCamera ? '📷' : '🖥️';
        lines.push(`${icon} **${ip}** (port ${port})`);
        if (isLikelyCamera) {
          lines.push(`   Możliwy RTSP: \`rtsp://${ip}:554/stream\``);
          lines.push(`   HTTP: \`http://${ip}:${port}\``);
        }
      });
      lines.push('');
      lines.push('💡 *Sprawdź kamerę: "monitoruj [IP]" lub otwórz `http://[IP]` w przeglądarce.*');
    }

    if (!localIp) {
      lines.push('\n⚠️ Nie udało się wykryć lokalnego IP — skanowanie oparte na domyślnej podsieci 192.168.1.x');
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: isCameraQuery ? 'Kamery (przeglądarka)' : 'Sieć (przeglądarka)' }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
      } as any,
    };
  }

  /**
   * Detect local IP address using WebRTC ICE candidates.
   * Returns the local LAN IP (e.g. "192.168.1.42") or null if detection fails.
   */
  private detectLocalIp(): Promise<string | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 3000);

      try {
        const RTCPeerConnection = (window as any).RTCPeerConnection
          || (window as any).webkitRTCPeerConnection
          || (window as any).mozRTCPeerConnection;

        if (!RTCPeerConnection) {
          clearTimeout(timeout);
          console.log('[NetworkScanPlugin] WebRTC not available for IP detection');
          resolve(null);
          return;
        }

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        pc.createDataChannel('');
        pc.createOffer().then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer)).catch(() => {
          clearTimeout(timeout);
          resolve(null);
        });

        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (!event.candidate) return;
          const candidate = event.candidate.candidate;
          // Extract IP from candidate string: "... <ip> <port> typ host ..."
          const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
          if (ipMatch) {
            const ip = ipMatch[1];
            // Only accept private LAN IPs
            if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.match(/^172\.(1[6-9]|2\d|3[01])\./)) {
              clearTimeout(timeout);
              pc.close();
              console.log(`[NetworkScanPlugin] Detected local IP via WebRTC: ${ip}`);
              resolve(ip);
            }
          }
        };
      } catch {
        clearTimeout(timeout);
        resolve(null);
      }
    });
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

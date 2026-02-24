import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { CAMERA_VENDORS, detectCameraVendor, getVendorInfo } from './cameraVendorDatabase';

export class CameraLivePlugin implements Plugin {
  readonly id = 'camera-live';
  readonly name = 'Camera Live Preview';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:live', 'camera:preview', 'camera:snapshot'];

  private static readonly CAN_HANDLE_PATTERNS: readonly RegExp[] = [
    /pokaż.*live|pokaz.*live|live.*preview|podgląd.*live|podglad.*live/i,
    /^rtsp:\/\//i,
    /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]*$/,
    /test.*streams/i,
    /pokaż\s+kamer[ęe]\s+\d{1,3}\.\d{1,3}\./i,
    /pokaz\s+kamer[ęe]\s+\d{1,3}\.\d{1,3}\./i,
  ];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const trimmed = input.trim();
    return CameraLivePlugin.CAN_HANDLE_PATTERNS.some(p => p.test(trimmed));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();

    // Explicit stream test command (Tauri best-effort)
    if (/^test\s+streams\b/i.test(input) || /testuj\s+streamy\b/i.test(input)) {
      const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      const userMatch = input.match(/user:(\S+)/i);
      const passMatch = input.match(/(?:admin|pass|password):(\S*)/i);
      const ip = ipMatch?.[1];
      const username = userMatch?.[1] ?? 'admin';
      const password = passMatch?.[1] ?? '';

      if (!ip) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: '❌ Podaj IP kamery, np. `test streams 192.168.1.100 user:admin admin:HASŁO`',
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      return this.handleTestStreams(ip, username, password, context, start);
    }

    // Extract IP address or RTSP URL
    let ip: string | null = null;
    let rtspUrl: string | null = null;
    let username = 'admin';
    let password = '';

    // Check if input is direct RTSP URL
    const sanitizedInput = this.sanitizeRtspInput(input);
    const rtspMatch = sanitizedInput.match(/rtsp:\/\/(?:([^:@\/\s]+)(?::([^@]*))?@)?([^:\/\s]+)(?::(\d+))?(\/[\S]*)?/i);
    if (rtspMatch) {
      username = rtspMatch[1] || 'admin';
      password = rtspMatch[2] || '';
      ip = rtspMatch[3];
      rtspUrl = sanitizedInput;

      // Persist RTSP path so MonitorPlugin can reuse the correct vendor path
      if (ip) {
        const { configStore } = await import('../../config/configStore');
        const storedPath = this.extractRtspPath(rtspUrl) ?? rtspUrl;
        configStore.set(`camera.rtspPath.${ip}`, storedPath);
        if (username) configStore.set(`camera.credentials.${ip}.username`, username);
        if (password) configStore.set(`camera.credentials.${ip}.password`, password);
      }
    } else if (/^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]*$/.test(input.trim())) {
      // Handle credential testing like "admin:123456"
      const credMatch = input.trim().match(/^([^:]+):(.*)$/);
      if (credMatch) {
        username = credMatch[1];
        password = credMatch[2];

        // Return credential testing response
        return this.handleCredentialTest(username, password, start);
      }
    } else if (/test.*streams/i.test(input)) {
      // Handle "test streams IP user:username admin:password" command
      const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      const userMatch = input.match(/user:([^\s]+)/);
      const passMatch = input.match(/admin:([^\s]+)/);

      if (ipMatch) {
        ip = ipMatch[1];
        username = userMatch ? userMatch[1] : 'admin';
        password = passMatch ? passMatch[1] : '';

        return this.handleTestStreams(ip, username, password, context, start);
      }
    } else {
      // Extract IP from "pokaż live IP" command
      const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (ipMatch) {
        ip = ipMatch[1];

        // Try to get credentials from config store
        const { configStore } = await import('../../config/configStore');
        const storedUsername = configStore.get(`camera.credentials.${ip}.username`) as string | undefined;
        const storedPassword = configStore.get(`camera.credentials.${ip}.password`) as string | undefined;
        const storedRtspUrl = configStore.get(`camera.rtspPath.${ip}`) as string | undefined;

        if (storedUsername) {
          username = storedUsername;
          password = storedPassword || '';
        }

        // Prefer last known working RTSP URL (saved when user pasted a full RTSP URL)
        if (storedRtspUrl) {
          const sanitizedStored = this.sanitizeRtspInput(storedRtspUrl);
          if (/^rtsp:\/\//i.test(sanitizedStored)) {
            rtspUrl = sanitizedStored;
          } else if (sanitizedStored.startsWith('/')) {
            const auth = username && password ? `${username}:${password}@` : username ? `${username}@` : '';
            rtspUrl = `rtsp://${auth}${ip}:554${sanitizedStored}`;
          } else {
            // Fallback: if someone stored something non-URL-ish, keep previous behavior
            rtspUrl = sanitizedStored;
          }
        } else {
          // Build RTSP URL (fallback)
          const auth = username && password ? `${username}:${password}@` : '';
          rtspUrl = `rtsp://${auth}${ip}:554/stream`;
        }
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

    // Try to detect camera vendor — prefer DB vendor (from scan) and RTSP path.
    const rtspPathForDetection = rtspUrl ? rtspUrl.replace(/^rtsp:\/\/[^/]+/, '') : undefined;
    const dbVendorId = await this.resolveVendorFromDb(ip, context);
    const vendorId = dbVendorId ?? detectCameraVendor({ rtspPath: rtspPathForDetection });
    const vendor = getVendorInfo(vendorId);

    const auth = username && password ? `${username}:${password}@` : username ? `${username}@` : '';
    const rtspCandidates = [...new Set([
      ...(rtspUrl ? [rtspUrl] : []),
      ...vendor.rtspPaths.slice(0, 6).map((p) => `rtsp://${auth}${ip}:554${p.path}`),
    ])].map((candidate) => this.sanitizeRtspInput(candidate));
    const snapshotCandidates = vendor.httpSnapshotPaths
      .slice(0, 6)
      .map((p) => `http://${auth}${ip}${p.path}`);

    let previewBase64: string | null = null;
    let previewMimeType: string = 'image/jpeg';
    let rtspStatusLine = '';
    let snapshotStatusLine = '';
    let workingRtspUrl: string | null = null;
    let workingSnapshotUrl: string | null = null;

    if (context.isTauri && context.tauriInvoke) {
      // RTSP validation + preview (best-effort)
      let lastRtspErr: string | null = null;
      for (const candidate of rtspCandidates) {
        try {
          const result = await context.tauriInvoke('rtsp_capture_frame', {
            url: candidate,
            cameraId: ip,
            camera_id: ip,
          }) as { base64?: string };
          if (result?.base64) {
            previewBase64 = result.base64;
            workingRtspUrl = candidate;
            rtspStatusLine = `✅ **RTSP OK** — \`${candidate}\``;
            break;
          }
        } catch (e) {
          lastRtspErr = (e instanceof Error ? e.message : String(e)) || lastRtspErr;
        }
      }

      if (!workingRtspUrl) {
        const msg = lastRtspErr ? this.truncateOneLine(lastRtspErr, 220) : 'nie udało się pobrać klatki';
        rtspStatusLine = `❌ **RTSP nie działa** — ${msg}`;
      }

      // HTTP snapshot validation (best-effort) via backend (avoids CORS)
      for (const candidate of snapshotCandidates) {
        try {
          const res = await context.tauriInvoke('http_fetch_base64', { url: candidate }) as {
            url: string;
            status: number;
            content_type?: string | null;
            base64: string;
          };
          if (res?.status && res.status >= 200 && res.status < 300 && res.base64) {
            previewBase64 = previewBase64 ?? res.base64;
            previewMimeType = (res.content_type && res.content_type.includes('png')) ? 'image/png' : 'image/jpeg';
            workingSnapshotUrl = candidate;
            snapshotStatusLine = `✅ **HTTP snapshot OK** — ${res.status} (\`${candidate}\`)`;
            break;
          }
          snapshotStatusLine = `❌ **HTTP snapshot** — ${res?.status ?? 'ERR'} (\`${candidate}\`)`;
        } catch {
          // try next
        }
      }
      if (!snapshotStatusLine) {
        snapshotStatusLine = '⚠️ **HTTP snapshot** — nie udało się pobrać (sprawdź URL/credentials)';
      }
    } else {
      rtspStatusLine = 'ℹ️ **RTSP preview w czacie wymaga aplikacji Tauri** (w przeglądarce RTSP nie zadziała)';
      snapshotStatusLine = 'ℹ️ **Snapshot w czacie wymaga aplikacji Tauri** (w przeglądarce blokuje CORS). Otwórz snapshot URL w nowej karcie.';
    }


    let data = `📹 **Podgląd live z kamery**\n\n`;
    data += `🌐 **IP:** ${ip}\n`;
    data += `🏭 **Producent:** ${vendor.name}\n`;
    if (username) {
      data += `👤 **User:** ${username}\n`;
    }

    data += `\n📶 **Status:**\n`;
    if (rtspStatusLine) data += `${rtspStatusLine}\n`;
    if (snapshotStatusLine) data += `${snapshotStatusLine}\n`;

    // Show default credentials if no password provided
    if (!password && vendor.defaultCredentials.length > 0) {
      data += `\n🔐 **Domyślne hasła dla ${vendor.name}:**\n`;
      vendor.defaultCredentials.slice(0, 3).forEach((cred, idx) => {
        data += `${idx + 1}. \`${cred.username}:${cred.password || '(puste)'}\` — ${cred.description}\n`;
      });
    }

    // Show RTSP URLs for all quality levels
    data += `\n🎥 **RTSP Streams:**\n`;
    vendor.rtspPaths.slice(0, 6).forEach((path, idx) => {
      const url = `rtsp://${auth}${ip}:554${path.path}`;
      const okMark = workingRtspUrl === url ? ' ✅' : '';
      data += `${idx + 1}. **${path.description}** (${path.quality})${okMark}\n   \`${url}\`\n`;
    });
    data += `*(Otwórz w VLC → Media → Otwórz strumień sieciowy)*\n`;

    // Show HTTP snapshot URLs
    data += `\n📸 **HTTP Snapshot URLs:**\n`;
    vendor.httpSnapshotPaths.slice(0, 6).forEach((path, idx) => {
      const url = `http://${auth}${ip}${path.path}`;
      const okMark = workingSnapshotUrl === url ? ' ✅' : '';
      data += `${idx + 1}. \`${path.description}\`${okMark}\n   \`${url}\`\n`;
    });

    data += `\n💡 **Jak używać:**\n`;
    data += `- Skopiuj RTSP URL do VLC lub innego odtwarzacza\n`;
    data += `- Otwórz HTTP snapshot URL w przeglądarce (odświeżaj F5)\n`;
    if (!password) {
      data += `- Wypróbuj domyślne hasła podane powyżej\n`;
    }

    data += `\n---\n💡 **Sugerowane akcje:**\n`;

    // Suggest trying default credentials
    if (!password && vendor.defaultCredentials.length > 0) {
      vendor.defaultCredentials.slice(0, 2).forEach(cred => {
        data += `- "monitoruj ${ip} user:${cred.username} admin:${cred.password}" — Spróbuj ${cred.description.toLowerCase()}\n`;
      });
    } else {
      data += `- "monitoruj ${ip} user:${username} admin:${password || 'HASŁO'}" — Rozpocznij monitoring\n`;
    }
    data += `- "przeglądaj http://${ip}" — Otwórz interfejs web kamery\n`;

    const result: PluginResult = {
      pluginId: this.id,
      status: 'success',
      content: [
        ...(previewBase64
          ? [{
            type: 'image' as const,
            data: previewBase64,
            mimeType: previewMimeType,
            title: `Podgląd: ${ip}`,
          }]
          : []),
        ...((workingRtspUrl || workingSnapshotUrl)
          ? [{
            type: 'structured' as const,
            data: JSON.stringify({
              kind: 'camera_live',
              url: workingRtspUrl ?? workingSnapshotUrl,
              cameraId: ip,
              fps: 1,
              initialBase64: previewBase64 ?? undefined,
              initialMimeType: previewMimeType ?? undefined,
              snapshotUrl: workingSnapshotUrl ?? undefined,
              // If RTSP failed but snapshot works, start in snapshot mode immediately
              startInSnapshotMode: !workingRtspUrl && !!workingSnapshotUrl,
            }),
            title: `Live (1fps): ${ip}`,
            mimeType: 'application/json',
          }]
          : []),
        {
          type: 'text',
          data,
          title: `Live Preview: ${ip}`,
        },
      ],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
      },
    };

    // Add clickable actions (cards) so user can insert/run without copy-paste
    (result.metadata as any).configPrompt = {
      title: 'Akcje kamery',
      actions: [
        {
          id: 'start-monitor',
          label: 'Monitoruj kamerę',
          icon: '🟢',
          type: 'execute' as const,
          executeQuery: `monitoruj ${ip} user:${username} admin:${password || 'HASŁO'}`,
          variant: 'primary' as const,
          description: 'Uruchom monitoring (zmiany, logi, alerty)',
        },
        {
          id: 'open-web-ui',
          label: 'Otwórz web UI',
          icon: '🌐',
          type: 'execute' as const,
          executeQuery: `przeglądaj http://${ip}`,
          variant: 'secondary' as const,
          description: 'Panel administracyjny kamery w przeglądarce',
        },
        ...(workingRtspUrl ? [{
          id: 'test-working-rtsp',
          label: 'Testuj działający RTSP',
          icon: '✅',
          type: 'execute' as const,
          executeQuery: workingRtspUrl,
          variant: 'success' as const,
          description: 'Testuj zweryfikowany strumień RTSP',
        }] : []),
        {
          id: 'test-credentials',
          label: 'Testuj credentials',
          icon: '🔐',
          type: 'execute' as const,
          executeQuery: `${username}:${password || ''}`,
          variant: 'secondary' as const,
          description: 'Sprawdź, do jakich kamer pasują te dane',
        },
        {
          id: 'test-all-streams',
          label: 'Testuj wszystkie streamy',
          icon: '🔄',
          type: 'execute' as const,
          executeQuery: `test streams ${ip} user:${username} admin:${password || ''}`,
          variant: 'secondary' as const,
          description: 'Przetestuj wszystkie ścieżki RTSP',
        },
        {
          id: 'try-reolink',
          label: 'Spróbuj Reolink',
          icon: '🎥',
          type: 'execute' as const,
          executeQuery: `rtsp://${username}:${password || ''}@${ip}:554/h264Preview_01_main`,
          variant: 'outline' as const,
          description: 'Testuj ścieżkę Reolink (h264Preview_01_main)',
        },
        {
          id: 'try-hikvision',
          label: 'Spróbuj Hikvision',
          icon: '🎥',
          type: 'execute' as const,
          executeQuery: `rtsp://${username}:${password || ''}@${ip}:554/Streaming/Channels/101`,
          variant: 'outline' as const,
          description: 'Testuj ścieżkę Hikvision (Channels/101)',
        },
        {
          id: 'try-dahua',
          label: 'Spróbuj Dahua',
          icon: '🎥',
          type: 'execute' as const,
          executeQuery: `rtsp://${username}:${password || ''}@${ip}:554/cam/realmonitor?channel=1&subtype=0`,
          variant: 'outline' as const,
          description: 'Testuj ścieżkę Dahua (realmonitor)',
        },
      ],
      layout: 'cards' as const,
    };

    return result;
  }

  private async resolveVendorFromDb(ip: string, context: PluginContext): Promise<string | null> {
    if (!context.databaseManager || !context.databaseManager.isReady()) return null;
    try {
      const { DeviceRepository } = await import('../../persistence/deviceRepository');
      const repo = new DeviceRepository(context.databaseManager.getDevicesDb());
      const device = await repo.getByIp(ip);
      if (!device?.vendor) return null;
      return this.mapVendorStringToId(device.vendor);
    } catch {
      return null;
    }
  }

  private mapVendorStringToId(vendor: string): string | null {
    const v = vendor.toLowerCase();
    if (v.includes('annke')) return 'annke';
    if (v.includes('hikvision')) return 'hikvision';
    if (v.includes('dahua')) return 'dahua';
    if (v.includes('reolink')) return 'reolink';
    if (v.includes('axis')) return 'axis';

    // Fallback: try aliases database
    for (const [id, info] of Object.entries(CAMERA_VENDORS)) {
      if (id === 'generic') continue;
      if (info.aliases.some((a) => v.includes(a.toLowerCase()))) return id;
    }
    return null;
  }

  private async handleTestStreams(
    ip: string,
    username: string,
    password: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    const dbVendorId = await this.resolveVendorFromDb(ip, context);
    const vendorId = dbVendorId ?? detectCameraVendor({});
    const vendor = getVendorInfo(vendorId);
    const auth = username && password ? `${username}:${password}@` : username ? `${username}@` : '';

    let data = `🔄 **Testowanie streamów RTSP**\n\n`;
    data += `🌐 **IP:** ${ip}\n`;
    data += `👤 **User:** ${username}\n`;
    data += `🏭 **Producent:** ${vendor.name}\n\n`;

    // Test all RTSP paths
    data += `🎥 **Testowanie ścieżek RTSP:**\n\n`;

    const testResults: Array<{ path: string; status: string; working: boolean }> = [];
    let firstWorkingBase64: string | null = null;

    for (const [index, path] of vendor.rtspPaths.entries()) {
      const rtspUrl = `rtsp://${auth}${ip}:554${path.path}`;
      let status = '⏳ Testowanie...';
      let working = false;

      try {
        if (context.isTauri && context.tauriInvoke) {
          const result = await context.tauriInvoke('rtsp_capture_frame', {
            url: rtspUrl,
            cameraId: `${ip}-${index}`,
            camera_id: `${ip}-${index}`,
          }) as { base64?: string };

          if (result?.base64) {
            status = '✅ Działa';
            working = true;
            if (!firstWorkingBase64) firstWorkingBase64 = result.base64;
          } else {
            status = '❌ Brak obrazu';
          }
        } else {
          status = 'ℹ️ Wymaga Tauri';
        }
      } catch (e) {
        status = '❌ Błąd połączenia';
      }

      testResults.push({ path: path.path, status, working });
      data += `${index + 1}. **${path.description}** (${path.quality})\n`;
      data += `   URL: \`${rtspUrl}\`\n`;
      data += `   Status: ${status}\n\n`;
    }

    // Show working streams first
    const workingStreams = testResults.filter(r => r.working);
    if (workingStreams.length > 0) {
      data += `✅ **Działające streamy (${workingStreams.length}):**\n`;
      workingStreams.forEach((result, idx) => {
        const path = vendor.rtspPaths.find(p => p.path === result.path);
        const url = `rtsp://${auth}${ip}:554${result.path}`;
        data += `${idx + 1}. \`${url}\` — ${path?.description}\n`;
      });
      data += `\n`;
    }

    // Add suggestions
    data += `💡 **Sugerowane akcje:**\n`;

    if (workingStreams.length > 0) {
      data += `- Użyj działającego streamu do VLC lub monitoringu\n`;
      data += `- "monitoruj ${ip} user:${username} admin:${password}" — Uruchom monitoring\n`;
    } else {
      data += `- Spróbuj innych credentials (np. "admin:12345")\n`;
      data += `- Sprawdź, czy kamera jest włączona i dostępna\n`;
      data += `- Spróbuj innych portów (np. 8554 zamiast 554)\n`;
    }

    // Add clickable actions
    const result: PluginResult = {
      pluginId: this.id,
      status: 'success',
      content: [
        ...(firstWorkingBase64
          ? [{
            type: 'image' as const,
            data: firstWorkingBase64,
            mimeType: 'image/jpeg',
            title: `Podgląd (działający stream): ${ip}`,
          }]
          : []),
        {
          type: 'text',
          data,
          title: `Test Streams: ${ip}`,
        },
      ],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
      },
    };

    (result.metadata as any).configPrompt = {
      title: 'Akcje testowania',
      actions: [
        ...(workingStreams.length > 0 ? [{
          id: 'use-working-stream',
          label: 'Użyj działającego streamu',
          icon: '✅',
          type: 'prefill' as const,
          prefillText: `rtsp://${auth}${ip}:554${workingStreams[0].path}`,
          variant: 'success' as const,
          description: 'Użyj pierwszego działającego streamu',
        }] : []),
        {
          id: 'test-credentials',
          label: 'Testuj inne credentials',
          icon: '🔐',
          type: 'prefill' as const,
          prefillText: `test streams ${ip} user:${username} admin:HASŁO`,
          variant: 'secondary' as const,
          description: 'Sprawdź domyślne hasła',
        },
        {
          id: 'start-monitor',
          label: 'Uruchom monitoring',
          icon: '🟢',
          type: 'prefill' as const,
          prefillText: `monitoruj ${ip} user:${username} admin:${password || 'HASŁO'}`,
          variant: 'primary' as const,
          description: 'Uruchom monitoring kamery',
        },
      ],
      layout: 'cards' as const,
    };

    return result;
  }

  private handleCredentialTest(username: string, password: string, start: number): PluginResult {
    let data = `🔐 **Test credentials**\n\n`;
    data += `👤 **Username:** \`${username}\`\n`;
    data += `🔒 **Password:** \`${password || '(puste)'}\`\n\n`;

    // Find which vendors use these credentials
    const matchingVendors: string[] = [];

    for (const [vendorId, vendor] of Object.entries(CAMERA_VENDORS)) {
      const hasMatch = vendor.defaultCredentials.some(
        cred => cred.username === username && cred.password === password
      );
      if (hasMatch) {
        matchingVendors.push(vendor.name);
      }
    }

    if (matchingVendors.length > 0) {
      data += `🏭 **Pasuje do producentów:**\n`;
      matchingVendors.forEach(vendor => {
        data += `- ${vendor}\n`;
      });
      data += `\n`;
    } else {
      data += `⚠️ **Nie pasuje do żadnych domyślnych credentials**\n\n`;
    }

    data += `💡 **Jak użyć:**\n`;
    data += `- \`pokaż live 192.168.1.100\` — testuj z tą kamerą\n`;
    data += `- \`monitoruj 192.168.1.100 user:${username} admin:${password}\` — monitoring\n`;
    data += `- \`rtsp://${username}:${password}@192.168.1.100:554/stream\` — RTSP URL\n\n`;

    if (matchingVendors.length > 0) {
      data += `🎯 **Sugerowane ścieżki RTSP dla ${matchingVendors[0]}:**\n`;
      const vendor = Object.values(CAMERA_VENDORS).find(v => v.name === matchingVendors[0]);
      if (vendor) {
        vendor.rtspPaths.slice(0, 3).forEach((path, idx) => {
          const url = `rtsp://${username}:${password}@IP:554${path.path}`;
          data += `${idx + 1}. \`${url}\` — ${path.description}\n`;
        });
      }
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data,
        title: `Credentials: ${username}:${password}`,
      }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: false,
      },
    };
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read blob'));
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') return reject(new Error('Invalid FileReader result'));
        const idx = result.indexOf(',');
        if (idx === -1) return reject(new Error('Invalid data URL'));
        resolve(result.slice(idx + 1));
      };
      reader.readAsDataURL(blob);
    });
  }

  private sanitizeRtspInput(input: string): string {
    return input
      .trim()
      .replace(/^[`'"\s]+/, '')
      .replace(/[`'"\s]+$/, '')
      .replace(/[),.;:!?]+$/, '');
  }

  private extractRtspPath(rtspUrl: string): string | null {
    const match = rtspUrl.match(/^rtsp:\/\/(?:[^@\/\s]+@)?[^\/\s]+(\/[^\s]*)$/i);
    return match?.[1] ?? null;
  }

  private truncateOneLine(text: string, maxLen: number): string {
    const one = String(text).replace(/\s+/g, ' ').trim();
    if (one.length <= maxLen) return one;
    return one.slice(0, Math.max(0, maxLen - 1)) + '…';
  }

  async initialize(context: PluginContext): Promise<void> {
    console.log('CameraLivePlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('CameraLivePlugin disposed');
  }
}

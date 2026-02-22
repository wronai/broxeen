/**
 * Camera Snapshot Plugin - captures and displays camera snapshots
 * Scope: cameras, local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class CameraSnapshotPlugin implements Plugin {
  readonly id = 'camera-snapshot';
  readonly name = 'Camera Snapshot';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:snapshot', 'camera:capture'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /zrób.*zdjęcie.*kamer/i.test(lower) ||
      /zrob.*zdjecie.*kamer/i.test(lower) ||
      /snapshot.*kamer/i.test(lower) ||
      /capture.*camera/i.test(lower) ||
      /zrzut.*kamer/i.test(lower) ||
      /złap.*klatkę/i.test(lower) ||
      /zlap.*klatke/i.test(lower) ||
      /zapisz.*obraz.*kamer/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const cameraId = this.extractCameraId(input);

    if (context.isTauri && context.tauriInvoke) {
      try {
        const result = await context.tauriInvoke('camera_snapshot', {
          cameraId: cameraId || 'default',
        }) as { base64: string; width: number; height: number; cameraName: string; timestamp: number };

        return {
          pluginId: this.id,
          status: 'success',
          content: [
            {
              type: 'image',
              data: result.base64,
              mimeType: 'image/jpeg',
              title: `Snapshot: ${result.cameraName}`,
            },
            {
              type: 'text',
              data: `📸 **Snapshot z kamery: ${result.cameraName}**\n\nRozdzielczość: ${result.width}x${result.height}\nCzas: ${new Date(result.timestamp).toLocaleString('pl-PL')}`,
            },
          ],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (error) {
        return this.errorResult(`Błąd snapshot: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo - generate placeholder
    const cameraName = this.cameraLabel(cameraId);
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `🧪 **Tryb demonstracyjny — Snapshot**\n\n` +
          `📸 Kamera: **${cameraName}**\n` +
          `Czas: ${new Date().toLocaleString('pl-PL')}\n\n` +
          `W trybie przeglądarki przechwytywanie obrazu nie jest dostępne.\n` +
          `W aplikacji Tauri snapshot zostanie pobrany z kamery przez HTTP lub RTSP.\n\n` +
          `💡 *Aby zobaczyć prawdziwy obraz, uruchom aplikację Tauri z dostępem do kamery.*`,
        title: `Snapshot: ${cameraName} (demo)`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private extractCameraId(input: string): string | null {
    if (/wejści|front|wejsc/i.test(input)) return 'cam-front';
    if (/ogr[oó]d|garden/i.test(input)) return 'cam-garden';
    if (/salon|living/i.test(input)) return 'cam-salon';
    if (/garaż|garage|garaz/i.test(input)) return 'cam-garage';
    return null;
  }

  private cameraLabel(id: string | null): string {
    const labels: Record<string, string> = {
      'cam-front': 'Kamera Wejście',
      'cam-garden': 'Kamera Ogród',
      'cam-salon': 'Kamera Salon',
      'cam-garage': 'Kamera Garaż',
    };
    return id ? labels[id] || id : 'Domyślna kamera';
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('CameraSnapshotPlugin initialized'); }
  async dispose(): Promise<void> { console.log('CameraSnapshotPlugin disposed'); }
}

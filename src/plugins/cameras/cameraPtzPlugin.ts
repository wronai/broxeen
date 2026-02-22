/**
 * Camera PTZ Plugin - Pan/Tilt/Zoom control for cameras
 * Scope: cameras, local-network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export type PtzDirection = 'up' | 'down' | 'left' | 'right' | 'zoom-in' | 'zoom-out' | 'home' | 'preset';

export interface PtzCommand {
  cameraId: string;
  direction: PtzDirection;
  speed?: number;
  presetId?: number;
}

export class CameraPtzPlugin implements Plugin {
  readonly id = 'camera-ptz';
  readonly name = 'Camera PTZ Control';
  readonly version = '1.0.0';
  readonly supportedIntents = ['camera:ptz', 'camera:move', 'camera:zoom'];

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return /obróć.*kamer/i.test(lower) ||
      /obroc.*kamer/i.test(lower) ||
      /przesuń.*kamer/i.test(lower) ||
      /przesun.*kamer/i.test(lower) ||
      /zoom.*kamer/i.test(lower) ||
      /przybliż/i.test(lower) ||
      /przybliz/i.test(lower) ||
      /oddal/i.test(lower) ||
      /kamer.*w.*lewo/i.test(lower) ||
      /kamer.*w.*prawo/i.test(lower) ||
      /kamer.*do.*góry/i.test(lower) ||
      /kamer.*w.*dół/i.test(lower) ||
      /ptz/i.test(lower) ||
      /pan.*tilt/i.test(lower) ||
      /camera.*move/i.test(lower) ||
      /preset.*kamer/i.test(lower);
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const cmd = this.parseCommand(input);

    if (!cmd) {
      return this.errorResult(
        'Nie rozpoznano komendy PTZ. Przykłady:\n' +
        '- "obróć kamerę w lewo"\n' +
        '- "przybliż kamerę ogród"\n' +
        '- "kamera salon do góry"\n' +
        '- "preset 1 kamera wejście"',
        start,
      );
    }

    if (context.isTauri && context.tauriInvoke) {
      try {
        await context.tauriInvoke('camera_ptz_move', {
          cameraId: cmd.cameraId,
          direction: cmd.direction,
          speed: cmd.speed ?? 50,
          presetId: cmd.presetId,
        });

        const dirLabel = this.directionLabel(cmd.direction);
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `✅ **PTZ: ${dirLabel}**\n\nKamera: ${cmd.cameraId}\nKierunek: ${dirLabel}\nSzybkość: ${cmd.speed ?? 50}%`,
            title: `PTZ — ${dirLabel}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      } catch (error) {
        return this.errorResult(`Błąd PTZ: ${error instanceof Error ? error.message : String(error)}`, start);
      }
    }

    // Browser demo
    const dirLabel = this.directionLabel(cmd.direction);
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `🧪 **Tryb demonstracyjny — PTZ Control**\n\n` +
          `Kamera: ${cmd.cameraId}\n` +
          `Kierunek: ${dirLabel}\n` +
          `Szybkość: ${cmd.speed ?? 50}%\n\n` +
          `W trybie przeglądarki sterowanie PTZ nie jest dostępne.\n\n` +
          `💡 *W aplikacji Tauri komendy PTZ wysyłane są przez ONVIF.*`,
        title: `PTZ — ${dirLabel} (demo)`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private parseCommand(input: string): PtzCommand | null {
    const lower = input.toLowerCase();
    let direction: PtzDirection | null = null;
    let presetId: number | undefined;

    if (/w\s*lewo|left/i.test(lower)) direction = 'left';
    else if (/w\s*prawo|right/i.test(lower)) direction = 'right';
    else if (/do\s*góry|do\s*gory|up|w\s*górę|w\s*gore/i.test(lower)) direction = 'up';
    else if (/w\s*dół|w\s*dol|down/i.test(lower)) direction = 'down';
    else if (/przybliż|przybliz|zoom\s*in|zbliż|zbliz/i.test(lower)) direction = 'zoom-in';
    else if (/oddal|zoom\s*out|odsuń|odsun/i.test(lower)) direction = 'zoom-out';
    else if (/home|pozycja.*początkow|pozycja.*poczatkow/i.test(lower)) direction = 'home';
    else if (/preset/i.test(lower)) {
      direction = 'preset';
      const presetMatch = lower.match(/preset\s*(\d+)/);
      presetId = presetMatch ? parseInt(presetMatch[1]) : 1;
    }

    if (!direction) return null;

    const cameraId = this.extractCameraId(lower);

    return {
      cameraId: cameraId || 'cam-default',
      direction,
      speed: 50,
      presetId,
    };
  }

  private extractCameraId(input: string): string | null {
    if (/wejści|front|wejsc/i.test(input)) return 'cam-front';
    if (/ogr[oó]d|garden/i.test(input)) return 'cam-garden';
    if (/salon|living/i.test(input)) return 'cam-salon';
    if (/garaż|garage|garaz/i.test(input)) return 'cam-garage';
    return null;
  }

  private directionLabel(dir: PtzDirection): string {
    const labels: Record<PtzDirection, string> = {
      'up': '⬆️ W górę',
      'down': '⬇️ W dół',
      'left': '⬅️ W lewo',
      'right': '➡️ W prawo',
      'zoom-in': '🔍 Przybliżenie',
      'zoom-out': '🔍 Oddalenie',
      'home': '🏠 Pozycja domowa',
      'preset': '📌 Preset',
    };
    return labels[dir];
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: 'error',
      content: [{ type: 'text', data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(context: PluginContext): Promise<void> { console.log('CameraPtzPlugin initialized'); }
  async dispose(): Promise<void> { console.log('CameraPtzPlugin disposed'); }
}

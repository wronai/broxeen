import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginContext } from '../../core/types';
import { CameraLivePlugin } from './cameraLivePlugin';

describe('CameraLivePlugin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes direct RTSP input with trailing punctuation and captures frame via Tauri', async () => {
    const plugin = new CameraLivePlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: unknown) => {
      if (command === 'rtsp_capture_frame') {
        const url = (args as { url: string }).url;
        if (url === 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main') {
          return { base64: 'mock-frame-base64' };
        }
        throw new Error(`unexpected rtsp url: ${url}`);
      }

      if (command === 'http_fetch_base64') {
        return {
          status: 404,
          content_type: 'text/plain',
          base64: '',
          url: (args as { url: string }).url,
        };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    const result = await plugin.execute(
      'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main:',
      context,
    );

    const rtspCall = tauriInvoke.mock.calls.find(([command]) => command === 'rtsp_capture_frame');
    expect(rtspCall).toBeTruthy();
    expect((rtspCall?.[1] as { url: string }).url).toBe('rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main');

    const imageBlock = result.content.find((block) => block.type === 'image');
    expect(imageBlock).toBeTruthy();
    expect(imageBlock?.data).toBe('mock-frame-base64');
  });

  it('passes both cameraId and camera_id keys for Tauri arg compatibility', async () => {
    const plugin = new CameraLivePlugin();

    const tauriInvoke = vi.fn(async (command: string, args?: unknown) => {
      if (command === 'rtsp_capture_frame') {
        return { base64: 'ok' };
      }

      if (command === 'http_fetch_base64') {
        return {
          status: 404,
          content_type: 'text/plain',
          base64: '',
          url: (args as { url: string }).url,
        };
      }

      throw new Error(`unexpected command: ${command}`);
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main', context);

    const rtspCall = tauriInvoke.mock.calls.find(([command]) => command === 'rtsp_capture_frame');
    const rtspArgs = rtspCall?.[1] as { cameraId?: string; camera_id?: string };

    expect(rtspArgs.cameraId).toBe('192.168.188.146');
    expect(rtspArgs.camera_id).toBe('192.168.188.146');
  });

  it('passes both cameraId and camera_id in test-streams probing flow', async () => {
    const plugin = new CameraLivePlugin();

    const tauriInvoke = vi.fn(async (command: string) => {
      if (command === 'rtsp_capture_frame') {
        return { base64: 'ok' };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const context: PluginContext = {
      isTauri: true,
      tauriInvoke,
    };

    await plugin.execute('test streams 192.168.188.146 user:admin admin:123456', context);

    const firstRtspCall = tauriInvoke.mock.calls.find(([command]) => command === 'rtsp_capture_frame');
    expect(firstRtspCall).toBeTruthy();

    const rtspArgs = firstRtspCall?.[1] as { cameraId?: string; camera_id?: string };
    expect(rtspArgs.cameraId).toBe('192.168.188.146-0');
    expect(rtspArgs.camera_id).toBe('192.168.188.146-0');
  });
});

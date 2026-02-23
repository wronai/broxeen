import { describe, expect, it, vi } from 'vitest';
import { TauriRtspGrabber } from './rtspCameraPlugin';

describe('TauriRtspGrabber', () => {
  it('passes both cameraId and camera_id to rtsp_capture_frame', async () => {
    const invoke = vi.fn().mockResolvedValue({
      base64: 'mock-base64-frame',
      width: 1280,
      height: 720,
    });

    const grabber = new TauriRtspGrabber(invoke);

    const frame = await grabber.capture({
      id: 'cam-reolink-1',
      name: 'Reolink Front',
      rtspUrl: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
    });

    expect(invoke).toHaveBeenCalledWith('rtsp_capture_frame', {
      url: 'rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main',
      cameraId: 'cam-reolink-1',
      camera_id: 'cam-reolink-1',
    });

    expect(frame.base64).toBe('mock-base64-frame');
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(720);
    expect(frame.mimeType).toBe('image/jpeg');
  });

  it('throws for camera without rtspUrl', async () => {
    const invoke = vi.fn();
    const grabber = new TauriRtspGrabber(invoke);

    await expect(
      grabber.capture({
        id: 'cam-no-rtsp',
        name: 'No RTSP',
      }),
    ).rejects.toThrow('has no rtspUrl configured');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonitorPlugin } from './monitorPlugin';

describe('MonitorPlugin - Vision Pipeline', () => {
  let plugin: MonitorPlugin;
  let mockContext: any;

  beforeEach(() => {
    plugin = new MonitorPlugin();
    mockContext = {
      tauriInvoke: vi.fn(),
      scope: 'local',
      isTauri: true,
      databaseManager: {
        devicesDb: { getDevices: vi.fn() }
      }
    };
  });

  it('should handle vision pipeline status with no active pipelines', async () => {
    mockContext.tauriInvoke.mockResolvedValue([]);
    
    const result = await plugin.execute('status vision', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Status Vision Pipeline');
    expect(result.content[0].data).toContain('Brak aktywnych vision pipeline');
    expect(result.content[0].data).toContain('Uruchom vision pipeline');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_status');
  });

  it('should handle vision pipeline status with active pipelines', async () => {
    const mockStatus = [
      {
        camera_id: 'camera-192.168.1.100',
        rtsp_url: 'rtsp://192.168.1.100:554/stream',
        db_path: 'monitoring.db',
        llm_threshold: 0.6,
        process_every: 4,
        started_at: '2026-02-23T18:00:00Z'
      }
    ];
    mockContext.tauriInvoke.mockResolvedValue(mockStatus);
    
    const result = await plugin.execute('vision status', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Aktywne vision pipeline: 1');
    expect(result.content[0].data).toContain('camera-192.168.1.100');
    expect(result.content[0].data).toContain('rtsp://192.168.1.100:554/stream');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_status');
  });

  it('should handle vision pipeline start with RTSP URL', async () => {
    mockContext.tauriInvoke.mockResolvedValue('started');
    
    const result = await plugin.execute('vision pipeline start rtsp://192.168.1.100:554/stream', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Uruchomiono Vision Pipeline');
    expect(result.content[0].data).toContain('camera-192.168.1.100');
    expect(result.content[0].data).toContain('rtsp://192.168.1.100:554/stream');
    expect(result.content[0].data).toContain('Co teraz?');
    expect(result.content[0].data).toContain('ile osób było w pomieszczeniu');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_start', {
      cameraId: 'camera-192.168.1.100',
      rtspUrl: 'rtsp://192.168.1.100:554/stream',
      dbPath: 'monitoring.db',
      llmThreshold: 0.6,
      processEvery: 4,
      varThreshold: 40,
      bgHistory: 500,
      cooldownSec: 2.0,
      maxCropPx: 640,
    });
  });

  it('should handle vision pipeline start with IP address', async () => {
    mockContext.tauriInvoke.mockResolvedValue('started');
    
    const result = await plugin.execute('ai monitoring dla 192.168.1.100', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('camera-192.168.1.100');
    expect(result.content[0].data).toContain('rtsp://192.168.1.100:554/stream');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_start', expect.objectContaining({
      cameraId: 'camera-192.168.1.100',
      rtspUrl: 'rtsp://192.168.1.100:554/stream',
    }));
  });

  it('should handle vision pipeline start using active monitor', async () => {
    // Mock active monitor
    plugin['targets'].set('camera-192.168.1.176', {
      id: 'camera-192.168.1.176',
      name: 'Kamera 192.168.1.176',
      address: 'rtsp://192.168.1.176:554/stream',
      intervalMs: 3000,
      threshold: 0.15
    });
    
    mockContext.tauriInvoke.mockResolvedValue('started');
    
    const result = await plugin.execute('uruchom detekcję AI', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('camera-192.168.1.176');
    expect(result.content[0].data).toContain('rtsp://192.168.1.176:554/stream');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_start', expect.objectContaining({
      cameraId: 'camera-192.168.1.176',
      rtspUrl: 'rtsp://192.168.1.176:554/stream',
    }));
  });

  it('should handle vision pipeline stop for all cameras', async () => {
    mockContext.tauriInvoke.mockResolvedValue('stopped');
    
    const result = await plugin.execute('stop vision wszystkie', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Zatrzymano wszystkie vision pipeline');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_stop', { cameraId: '' });
  });

  it('should handle vision pipeline stop for specific camera', async () => {
    mockContext.tauriInvoke.mockResolvedValue('stopped');
    
    const result = await plugin.execute('zatrzymaj vision camera-192.168.1.100', mockContext);
    
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Zatrzymano vision pipeline: camera-192.168.1.100');
    expect(mockContext.tauriInvoke).toHaveBeenCalledWith('motion_pipeline_stop', { cameraId: 'camera-192.168.1.100' });
  });

  it('should handle vision pipeline not available error', async () => {
    mockContext.tauriInvoke.mockRejectedValue(new Error('vision feature not available'));
    
    const result = await plugin.execute('vision pipeline start rtsp://192.168.1.100:554/stream', mockContext);
    
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Vision pipeline nie jest dostępny');
    expect(result.content[0].data).toContain('cargo build --features vision');
    expect(result.content[0].data).toContain('vision feature not available');
  });

  it('should handle vision pipeline in non-Tauri environment', async () => {
    const browserContext = { ...mockContext, tauriInvoke: undefined };
    
    const result = await plugin.execute('vision status', browserContext);
    
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('wymaga środowiska Tauri');
  });

  it('should handle vision pipeline start with no target', async () => {
    const result = await plugin.execute('vision pipeline start', mockContext);
    
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Podaj adres RTSP lub IP kamery');
    expect(result.content[0].data).toContain('vision pipeline start rtsp://');
  });

  it('should recognize various vision pipeline commands', async () => {
    const commands = [
      'vision pipeline start rtsp://192.168.1.100:554/stream',
      'ai monitoring dla kamery wejściowej',
      'detekcja AI dla 192.168.1.100',
      'yolo monitor rtsp://192.168.1.100:554/stream',
      'monitoring ai start',
      'status vision',
      'vision status',
      'stop vision',
      'zatrzymaj vision camera-1',
      'uruchom vision pipeline'
    ];

    for (const command of commands) {
      expect(await plugin.canHandle(command, mockContext)).toBe(true);
    }
  });
});

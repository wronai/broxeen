import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiskInfoPlugin } from './diskInfoPlugin';
import type { PluginContext } from '../../core/types';

describe('DiskInfoPlugin', () => {
  let plugin: DiskInfoPlugin;
  let mockContext: PluginContext;

  beforeEach(() => {
    plugin = new DiskInfoPlugin();
    mockContext = {
      isTauri: false,
      tauriInvoke: undefined,
    };
  });

  describe('metadata', () => {
    it('has correct id and supported intents', () => {
      expect(plugin.id).toBe('disk-info');
      expect(plugin.supportedIntents).toContain('disk:info');
      expect(plugin.supportedIntents).toContain('disk:usage');
      expect(plugin.supportedIntents).toContain('disk:partitions');
    });
  });

  describe('canHandle', () => {
    it.each([
      'pokaż dysk',
      'disk usage',
      'ile wolnego miejsca',
      'partycje',
      'ile zajęte na dysku',
      'df -h',
      'storage info',
    ])('returns true for "%s"', async (input) => {
      expect(await plugin.canHandle(input, mockContext)).toBe(true);
    });

    it.each([
      'skanuj sieć',
      'pokaż kamery',
      'ping 192.168.1.1',
    ])('returns false for "%s"', async (input) => {
      expect(await plugin.canHandle(input, mockContext)).toBe(false);
    });
  });

  describe('execute (browser fallback)', () => {
    it('returns partial result in browser mode', async () => {
      const result = await plugin.execute('pokaż dysk', mockContext);
      expect(result.pluginId).toBe('disk-info');
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('Tauri');
    });
  });

  describe('execute (Tauri mode)', () => {
    it('calls get_disk_info via tauriInvoke', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        hostname: 'test-host',
        partitions: [
          {
            device: '/dev/sda1',
            mount_point: '/',
            fs_type: 'ext4',
            total_bytes: 500_000_000_000,
            used_bytes: 200_000_000_000,
            available_bytes: 300_000_000_000,
            use_percent: 40.0,
          },
        ],
        total_bytes: 500_000_000_000,
        used_bytes: 200_000_000_000,
        available_bytes: 300_000_000_000,
        use_percent: 40.0,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('pokaż dysk', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('get_disk_info', {});
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('test-host');
      expect(result.content[0].data).toContain('/');
      expect((result.metadata as any).configPrompt).toBeDefined();
    });

    it('calls get_disk_usage for specific path', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        device: '/dev/sda1',
        mount_point: '/home',
        fs_type: 'ext4',
        total_bytes: 500_000_000_000,
        used_bytes: 200_000_000_000,
        available_bytes: 300_000_000_000,
        use_percent: 40.0,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('dysk ścieżka /home', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('get_disk_usage', { path: '/home' });
      expect(result.status).toBe('success');
    });

    it('warns about high disk usage', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        hostname: 'test-host',
        partitions: [
          {
            device: '/dev/sda1',
            mount_point: '/',
            fs_type: 'ext4',
            total_bytes: 500_000_000_000,
            used_bytes: 475_000_000_000,
            available_bytes: 25_000_000_000,
            use_percent: 95.0,
          },
        ],
        total_bytes: 500_000_000_000,
        used_bytes: 475_000_000_000,
        available_bytes: 25_000_000_000,
        use_percent: 95.0,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('dysk', tauriContext);
      expect(result.content[0].data).toContain('Ostrzeżenia');
      expect(result.content[0].data).toContain('95%');
    });
  });

  describe('execute (remote disk via SSH)', () => {
    it('queries remote host via ssh_execute', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        command: 'df -h',
        stdout: 'Filesystem  Size  Used  Avail  Use%  Mounted on\n/dev/sda1  500G  200G  300G  40%  /',
        stderr: '',
        exit_code: 0,
        duration_ms: 150,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('dysk na 192.168.1.100', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('ssh_execute', expect.objectContaining({
        host: '192.168.1.100',
      }));
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('192.168.1.100');
    });
  });
});

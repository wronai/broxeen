import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SshPlugin } from './sshPlugin';
import type { PluginContext } from '../../core/types';

describe('SshPlugin', () => {
  let plugin: SshPlugin;
  let mockContext: PluginContext;

  beforeEach(() => {
    plugin = new SshPlugin();
    mockContext = {
      isTauri: false,
      tauriInvoke: undefined,
    };
  });

  describe('metadata', () => {
    it('has correct id and supported intents', () => {
      expect(plugin.id).toBe('ssh');
      expect(plugin.supportedIntents).toContain('ssh:execute');
      expect(plugin.supportedIntents).toContain('ssh:hosts');
    });
  });

  describe('canHandle', () => {
    it.each([
      'ssh 192.168.1.1 uptime',
      'text2ssh 10.0.0.1 jakie procesy',
      'połącz ssh do serwera',
      'wykonaj na 192.168.1.100 df -h',
      'sprawdź na 192.168.1.100 pamięć',
    ])('returns true for "%s"', async (input) => {
      expect(await plugin.canHandle(input, mockContext)).toBe(true);
    });

    it.each([
      'pokaż dysk',
      'skanuj sieć',
      'ping 192.168.1.1',
    ])('returns false for "%s"', async (input) => {
      expect(await plugin.canHandle(input, mockContext)).toBe(false);
    });
  });

  describe('execute', () => {
    it('returns partial for known hosts in browser mode', async () => {
      const result = await plugin.execute('ssh', mockContext);
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('Znane hosty');
    });

    it('requires Tauri for SSH execution', async () => {
      const result = await plugin.execute('ssh 192.168.1.1 uptime', mockContext);
      expect(result.status).toBe('error');
      expect(result.content[0].data).toContain('Tauri');
    });

    it('executes SSH command via Tauri', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        command: 'uptime',
        stdout: ' 14:30:01 up 5 days, 3:42, 2 users, load average: 0.15, 0.10, 0.05',
        stderr: '',
        exit_code: 0,
        duration_ms: 200,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.1.100 uptime', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('ssh_execute', expect.objectContaining({
        host: '192.168.1.100',
        command: expect.stringContaining('uptime'),
      }));
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('192.168.1.100');
      expect(result.content[0].data).toContain('up 5 days');
    });

    it('text2ssh resolves natural language to command', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '10.0.0.1',
        command: 'free -h',
        stdout: '              total   used   free\nMem:           16G    8G     8G',
        stderr: '',
        exit_code: 0,
        duration_ms: 150,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('text2ssh 10.0.0.1 ile pamięci', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('ssh_execute', expect.objectContaining({
        host: '10.0.0.1',
        command: expect.stringContaining('free'),
      }));
      expect(result.status).toBe('success');
    });

    it('lists known hosts', async () => {
      const mockInvoke = vi.fn().mockResolvedValue([
        { host: '192.168.1.1', key_type: 'ssh-ed25519' },
        { host: '10.0.0.5', key_type: 'ssh-rsa' },
      ]);

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh hosty', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('ssh_list_known_hosts', {});
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('192.168.1.1');
      expect(result.content[0].data).toContain('10.0.0.5');
    });

    it('tests SSH connection', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        port: 22,
        reachable: true,
        auth_ok: true,
        ssh_version: 'SSH-2.0-OpenSSH_8.9',
        duration_ms: 50,
        error: null,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('test ssh 192.168.1.100', tauriContext);
      expect(mockInvoke).toHaveBeenCalledWith('ssh_test_connection', expect.objectContaining({
        host: '192.168.1.100',
      }));
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('Autoryzacja OK');
    });

    it('handles SSH failure gracefully', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        command: 'uptime',
        stdout: '',
        stderr: 'Permission denied (publickey)',
        exit_code: 255,
        duration_ms: 1200,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.1.100 uptime', tauriContext);
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('255');
    });

    it('provides smart diagnosis for connection refused', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.188.146',
        command: 'top -bn1 | head -20',
        stdout: '',
        stderr: 'ssh: connect to host 192.168.188.146 port 22: Connection refused',
        exit_code: 255,
        duration_ms: 30,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.188.146 top -bn1 | head -20', tauriContext);
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('🔍 **Diagnoza:**');
      expect(result.content[0].data).toContain('SSH nie jest dostępne na tym urządzeniu');
      expect(result.content[0].data).toContain('Może to być kamera, router lub urządzenie IoT');
      expect(result.content[0].data).toContain('"ping 192.168.188.146"');
      expect(result.content[0].data).toContain('"skanuj porty 192.168.188.146"');
      expect(result.content[0].data).toContain('"przeglądaj http://192.168.188.146"');
    });

    it('provides smart diagnosis for permission denied', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        command: 'uptime',
        stdout: '',
        stderr: 'Permission denied (publickey,password)',
        exit_code: 255,
        duration_ms: 500,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.1.100 uptime', tauriContext);
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('🔍 **Diagnoza:**');
      expect(result.content[0].data).toContain('Błąd autentykacji');
      expect(result.content[0].data).toContain('"ssh 192.168.1.100 user admin"');
      expect(result.content[0].data).toContain('"ssh 192.168.1.100 port 2222"');
    });

    it('provides smart diagnosis for timeout', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.200',
        command: 'uptime',
        stdout: '',
        stderr: 'ssh: connect to host 192.168.1.200 port 22: Connection timed out',
        exit_code: 255,
        duration_ms: 30000,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.1.200 uptime', tauriContext);
      expect(result.status).toBe('partial');
      expect(result.content[0].data).toContain('🔍 **Diagnoza:**');
      expect(result.content[0].data).toContain('Przekroczono czas oczekiwania');
      expect(result.content[0].data).toContain('firewall');
      expect(result.content[0].data).toContain('"ping 192.168.1.200"');
    });

    it('provides default suggestions for successful SSH', async () => {
      const mockInvoke = vi.fn().mockResolvedValue({
        host: '192.168.1.100',
        command: 'uptime',
        stdout: ' 14:30:01 up 5 days, 3:42, 2 users, load average: 0.15, 0.10, 0.05',
        stderr: '',
        exit_code: 0,
        duration_ms: 200,
      });

      const tauriContext: PluginContext = {
        isTauri: true,
        tauriInvoke: mockInvoke,
      };

      const result = await plugin.execute('ssh 192.168.1.100 uptime', tauriContext);
      expect(result.status).toBe('success');
      expect(result.content[0].data).toContain('💡 **Sugerowane akcje:**');
      expect(result.content[0].data).toContain('"ssh 192.168.1.100 df -h"');
      expect(result.content[0].data).toContain('"ssh 192.168.1.100 free -h"');
      expect(result.content[0].data).toContain('"ssh 192.168.1.100 top -bn1 | head -10"');
    });
  });
});

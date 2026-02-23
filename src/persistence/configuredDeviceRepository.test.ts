import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfiguredDeviceRepository } from './configuredDeviceRepository';
import { InMemoryDbAdapter } from './databaseManager';

describe('ConfiguredDeviceRepository', () => {
  let db: InMemoryDbAdapter;
  let repo: ConfiguredDeviceRepository;

  beforeEach(() => {
    db = new InMemoryDbAdapter(':memory:');
    repo = new ConfiguredDeviceRepository(db);
  });

  describe('save', () => {
    it('calls execute with INSERT SQL and returns a generated id', async () => {
      const spy = vi.spyOn(db, 'execute');
      const id = await repo.save({ label: 'Kamera wejście', ip: '192.168.1.10', device_type: 'camera' });

      expect(id).toMatch(/^cd_/);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO configured_devices'),
        expect.arrayContaining(['192.168.1.10', 'Kamera wejście', 'camera']),
      );
    });

    it('uses provided id when given (upsert)', async () => {
      const spy = vi.spyOn(db, 'execute');
      const id = await repo.save({ id: 'cd_custom_123', label: 'Kamera B', ip: '192.168.1.20', device_type: 'camera' });

      expect(id).toBe('cd_custom_123');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO configured_devices'),
        expect.arrayContaining(['cd_custom_123']),
      );
    });

    it('passes monitor_enabled=1 by default', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.save({ label: 'Kamera', ip: '192.168.1.30', device_type: 'camera' });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([1]),
      );
    });

    it('passes monitor_enabled=0 when explicitly false', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.save({ label: 'Kamera', ip: '192.168.1.31', device_type: 'camera', monitor_enabled: false });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0]),
      );
    });

    it('passes rtsp_url, http_url, username, password when provided', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.save({
        label: 'Kamera RTSP',
        ip: '192.168.1.200',
        device_type: 'camera',
        rtsp_url: 'rtsp://192.168.1.200:554/stream',
        http_url: 'http://192.168.1.200/snap.jpg',
        username: 'admin',
        password: 'secret',
        monitor_interval_ms: 5000,
      });

      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          'rtsp://192.168.1.200:554/stream',
          'http://192.168.1.200/snap.jpg',
          'admin',
          'secret',
          5000,
        ]),
      );
    });
  });

  describe('listAll', () => {
    it('calls query with SELECT * FROM configured_devices', async () => {
      const spy = vi.spyOn(db, 'query').mockResolvedValue([]);
      await repo.listAll();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM configured_devices'),
      );
    });

    it('converts monitor_enabled integer to boolean', async () => {
      vi.spyOn(db, 'query').mockResolvedValue([
        { id: 'cd_1', label: 'A', ip: '10.0.0.1', device_type: 'camera', monitor_enabled: 1,
          monitor_interval_ms: 3000, monitor_change_threshold: 0.15, last_snapshot_at: null, notes: null,
          device_id: null, rtsp_url: null, http_url: null, username: null,
          password: null, stream_path: null, created_at: 0, updated_at: 0 },
        { id: 'cd_2', label: 'B', ip: '10.0.0.2', device_type: 'camera', monitor_enabled: 0,
          monitor_interval_ms: 3000, monitor_change_threshold: 0.15, last_snapshot_at: null, notes: null,
          device_id: null, rtsp_url: null, http_url: null, username: null,
          password: null, stream_path: null, created_at: 0, updated_at: 0 },
      ] as any);

      const all = await repo.listAll();
      expect(all[0].monitor_enabled).toBe(true);
      expect(all[1].monitor_enabled).toBe(false);
      expect(typeof all[0].monitor_enabled).toBe('boolean');
    });

    it('returns empty array on error', async () => {
      vi.spyOn(db, 'query').mockRejectedValue(new Error('DB error'));
      const result = await repo.listAll();
      expect(result).toEqual([]);
    });
  });

  describe('listMonitored', () => {
    it('queries with WHERE monitor_enabled = 1', async () => {
      const spy = vi.spyOn(db, 'query').mockResolvedValue([]);
      await repo.listMonitored();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE monitor_enabled = 1'),
      );
    });
  });

  describe('getById', () => {
    it('calls queryOne with id param', async () => {
      const spy = vi.spyOn(db, 'queryOne').mockResolvedValue(null);
      await repo.getById('cd_abc');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        ['cd_abc'],
      );
    });

    it('returns null when not found', async () => {
      vi.spyOn(db, 'queryOne').mockResolvedValue(null);
      expect(await repo.getById('missing')).toBeNull();
    });

    it('converts monitor_enabled to boolean on found row', async () => {
      vi.spyOn(db, 'queryOne').mockResolvedValue({
        id: 'cd_1', label: 'X', ip: '1.2.3.4', device_type: 'camera',
        monitor_enabled: 1, monitor_interval_ms: 3000, monitor_change_threshold: 0.15, last_snapshot_at: null,
        notes: null, device_id: null, rtsp_url: null, http_url: null,
        username: null, password: null, stream_path: null, created_at: 0, updated_at: 0,
      } as any);

      const device = await repo.getById('cd_1');
      expect(device).not.toBeNull();
      expect(device!.monitor_enabled).toBe(true);
    });
  });

  describe('getByIp', () => {
    it('calls queryOne with ip param', async () => {
      const spy = vi.spyOn(db, 'queryOne').mockResolvedValue(null);
      await repo.getByIp('192.168.1.5');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ip = ?'),
        ['192.168.1.5'],
      );
    });
  });

  describe('listByIp', () => {
    it('calls query with ip param', async () => {
      const spy = vi.spyOn(db, 'query').mockResolvedValue([]);
      await repo.listByIp('192.168.1.60');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ip = ?'),
        ['192.168.1.60'],
      );
    });
  });

  describe('setMonitorEnabled', () => {
    it('calls execute with UPDATE and correct params', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.setMonitorEnabled('cd_abc', true);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE configured_devices SET monitor_enabled'),
        expect.arrayContaining([1, 'cd_abc']),
      );
    });

    it('passes 0 when disabling', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.setMonitorEnabled('cd_abc', false);
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0, 'cd_abc']),
      );
    });
  });

  describe('updateLastSnapshot', () => {
    it('calls execute with UPDATE and id param', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.updateLastSnapshot('cd_xyz');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE configured_devices SET last_snapshot_at'),
        expect.arrayContaining(['cd_xyz']),
      );
    });
  });

  describe('remove', () => {
    it('calls execute with DELETE and id param', async () => {
      const spy = vi.spyOn(db, 'execute');
      await repo.remove('cd_del');
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM configured_devices WHERE id = ?'),
        ['cd_del'],
      );
    });
  });

  describe('count', () => {
    it('calls queryOne with count SQL', async () => {
      const spy = vi.spyOn(db, 'queryOne').mockResolvedValue({ cnt: 3 } as any);
      const result = await repo.count();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('count(*)'),
      );
      expect(result).toBe(3);
    });

    it('returns 0 on error', async () => {
      vi.spyOn(db, 'queryOne').mockRejectedValue(new Error('fail'));
      expect(await repo.count()).toBe(0);
    });
  });
});

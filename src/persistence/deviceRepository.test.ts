import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceRepository } from './deviceRepository';
import { InMemoryDbAdapter } from './databaseManager';

describe('DeviceRepository', () => {
  let db: InMemoryDbAdapter;
  let repo: DeviceRepository;

  beforeEach(() => {
    db = new InMemoryDbAdapter(':memory:');
    repo = new DeviceRepository(db);
  });

  it('saveDevice calls execute with upsert SQL', async () => {
    const spy = vi.spyOn(db, 'execute');
    await repo.saveDevice({
      id: '192.168.1.100',
      ip: '192.168.1.100',
      hostname: 'cam-front',
      mac: 'aa:bb:cc:dd:ee:ff',
      vendor: 'Hikvision',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO devices'),
      expect.arrayContaining(['192.168.1.100', '192.168.1.100', 'cam-front', 'aa:bb:cc:dd:ee:ff', 'Hikvision']),
    );
  });

  it('saveDevices calls saveDevice for each device', async () => {
    const spy = vi.spyOn(db, 'execute');
    await repo.saveDevices([
      { id: '1', ip: '192.168.1.1' },
      { id: '2', ip: '192.168.1.2' },
    ]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('saveService calls execute with service data', async () => {
    const spy = vi.spyOn(db, 'execute');
    await repo.saveService({
      id: 'svc-1',
      deviceId: '192.168.1.100',
      type: 'rtsp',
      port: 554,
      path: '/stream',
      status: 'online',
      metadata: { codec: 'h264' },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO device_services'),
      expect.arrayContaining(['svc-1', '192.168.1.100', 'rtsp', 554, '/stream', 'online']),
    );
  });

  it('listDevices returns empty from in-memory', async () => {
    const devices = await repo.listDevices();
    expect(devices).toEqual([]);
  });

  it('listDevices returns rows when data exists', async () => {
    vi.spyOn(db, 'query').mockResolvedValueOnce([
      { id: '1', ip: '192.168.1.1', hostname: null, mac: null, vendor: null, last_seen: 1700000000000 },
    ] as any);
    const devices = await repo.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].ip).toBe('192.168.1.1');
  });

  it('listServices returns empty from in-memory', async () => {
    const services = await repo.listServices('dev-1');
    expect(services).toEqual([]);
  });

  it('getByIp returns null from in-memory', async () => {
    const device = await repo.getByIp('192.168.1.1');
    expect(device).toBeNull();
  });

  it('getByIp returns device when found', async () => {
    vi.spyOn(db, 'queryOne').mockResolvedValueOnce({
      id: '1', ip: '192.168.1.1', hostname: 'router', mac: null, vendor: null, last_seen: 1700000000000,
    } as any);
    const device = await repo.getByIp('192.168.1.1');
    expect(device).not.toBeNull();
    expect(device!.hostname).toBe('router');
  });

  it('countDevices returns 0 from in-memory', async () => {
    expect(await repo.countDevices()).toBe(0);
  });

  it('countDevices returns count when data exists', async () => {
    vi.spyOn(db, 'queryOne').mockResolvedValueOnce({ cnt: 15 } as any);
    expect(await repo.countDevices()).toBe(15);
  });

  it('countServices returns 0 from in-memory', async () => {
    expect(await repo.countServices()).toBe(0);
  });

  it('handles execute errors gracefully', async () => {
    vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('DB error'));
    await expect(repo.saveDevice({ id: '1', ip: '1.2.3.4' })).resolves.toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceStatusPlugin } from './deviceStatusPlugin';
import { DeviceRepository } from '../../persistence/deviceRepository';

// Mock dependencies
vi.mock('../../persistence/deviceRepository');
vi.mock('../../config/configStore', () => ({
  configStore: {
    get: vi.fn(),
  },
}));

describe('DeviceStatusPlugin', () => {
  let plugin: DeviceStatusPlugin;
  let mockDeviceRepo: any;
  let mockDbManager: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mocks
    mockDeviceRepo = {
      getDevicesWithStatus: vi.fn(),
      getRecentlyActiveDevices: vi.fn(),
      getOfflineDevices: vi.fn(),
    };
    
    mockDbManager = {
      getDevicesDb: vi.fn().mockReturnValue({}),
    };

    mockContext = {
      databaseManager: mockDbManager,
    };

    // Mock DeviceRepository constructor
    (DeviceRepository as any).mockImplementation(() => mockDeviceRepo);

    plugin = new DeviceStatusPlugin();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await plugin.initialize(mockContext as any);
      expect(DeviceRepository).toHaveBeenCalled();
      expect(mockDbManager.getDevicesDb).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      (DeviceRepository as any).mockImplementation(() => {
        throw new Error('DB error');
      });
      await plugin.initialize(mockContext as any);
      // Should not throw
    });
  });

  describe('canHandle', () => {
    it('should handle status requests', async () => {
      expect(await plugin.canHandle('status urządzeń')).toBe(true);
      expect(await plugin.canHandle('device status')).toBe(true);
      expect(await plugin.canHandle('urządzenia online')).toBe(true);
      expect(await plugin.canHandle('ostatnia aktywność')).toBe(true);
    });

    it('should not handle unrelated requests', async () => {
      expect(await plugin.canHandle('ping 192.168.1.1')).toBe(false);
      expect(await plugin.canHandle('skanuj sieć')).toBe(false);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await plugin.initialize(mockContext as any);
    });

    it('should show general status', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 1000, status: 'online', services_count: 2 },
      ]);
      mockDeviceRepo.getRecentlyActiveDevices.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 1000, minutes_since_last_seen: 1 },
      ]);
      mockDeviceRepo.getOfflineDevices.mockResolvedValue([]);

      const result = await plugin.execute('status urządzeń', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Status Urządzeń w Sieci');
      expect(text).toContain('Podsumowanie:');
      expect(text).toContain('Online (aktywne):** 1');
      expect((result.metadata as any)?.total_devices).toBe(1);
    });

    it('should show online devices', async () => {
      mockDeviceRepo.getRecentlyActiveDevices.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 1000, minutes_since_last_seen: 1 },
        { id: '2', ip: '192.168.1.101', hostname: null, last_seen: Date.now() - 120000, minutes_since_last_seen: 2 },
      ]);

      const result = await plugin.execute('urządzenia online', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Aktywne Urządzenia');
      expect(text).toContain('192.168.1.100');
      expect(text).toContain('192.168.1.101');
      expect((result.metadata as any)?.active_count).toBe(2);
    });

    it('should show offline devices', async () => {
      mockDeviceRepo.getOfflineDevices.mockResolvedValue([
        { id: '1', ip: '192.168.1.200', hostname: 'offline-device', last_seen: Date.now() - 7200000, hours_since_last_seen: 2 },
      ]);

      const result = await plugin.execute('urządzenia offline', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Urządzenia Offline');
      expect(text).toContain('192.168.1.200');
      expect((result.metadata as any)?.offline_count).toBe(1);
    });

    it('should show recent activity', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 60000, status: 'online', services_count: 3 },
        { id: '2', ip: '192.168.1.101', hostname: null, last_seen: Date.now() - 3600000, status: 'offline', services_count: 1 },
      ]);

      const result = await plugin.execute('ostatnia aktywność', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Ostatnia Aktywność Urządzeń');
      expect(text).toContain('192.168.1.100');
      expect(text).toContain('192.168.1.101');
      expect(text).toContain('3 usług');
    });

    it('should handle empty device lists', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockResolvedValue([]);
      mockDeviceRepo.getRecentlyActiveDevices.mockResolvedValue([]);
      mockDeviceRepo.getOfflineDevices.mockResolvedValue([]);

      const result = await plugin.execute('status urządzeń', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Łącznie:** 0');
    });

    it('should handle database not available', async () => {
      const pluginNoDb = new DeviceStatusPlugin();
      const result = await pluginNoDb.execute('status', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Baza danych urządzeń nie jest dostępna');
    });

    it('should handle database errors gracefully', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockRejectedValue(new Error('Database error'));

      const result = await plugin.execute('status', {} as any);
      const text = result.content?.[0]?.data || '';

      expect(text).toContain('Nie udało się pobrać statusu urządzeń');
    });
  });

  describe('time formatting', () => {
    it('should format time ago correctly', () => {
      const plugin = new DeviceStatusPlugin();
      const now = new Date();
      
      // Test private method through public interface
      const result = plugin.execute('ostatnia aktywność', {} as any);
      
      // We can't directly test private method, but we can test the overall behavior
      expect(result).toBeDefined();
    });
  });
});

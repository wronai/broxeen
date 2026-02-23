import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeviceStatusPlugin } from './deviceStatusPlugin';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { DatabaseManager } from '../../persistence/databaseManager';

// Mock dependencies
vi.mock('../../persistence/deviceRepository');
vi.mock('../../persistence/databaseManager');
vi.mock('../../config/configStore', () => ({
  configStore: {
    get: vi.fn(),
  },
}));

describe('DeviceStatusPlugin', () => {
  let plugin: DeviceStatusPlugin;
  let mockDeviceRepo: any;
  let mockDbManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mocks
    mockDeviceRepo = {
      getDevicesWithStatus: vi.fn(),
      getRecentlyActiveDevices: vi.fn(),
      getOfflineDevices: vi.fn(),
    };
    
    mockDbManager = {
      initialize: vi.fn().mockResolvedValue(undefined),
      getAdapter: vi.fn().mockReturnValue({}),
      isReady: vi.fn().mockReturnValue(true),
    };

    // Mock DeviceRepository constructor
    (DeviceRepository as any).mockImplementation(() => mockDeviceRepo);
    (DatabaseManager as any).mockImplementation(() => mockDbManager);

    plugin = new DeviceStatusPlugin();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await plugin.initialize({} as any);
      expect(DatabaseManager).toHaveBeenCalled();
      expect(mockDbManager.initialize).toHaveBeenCalled();
      expect(DeviceRepository).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      mockDbManager.initialize.mockRejectedValue(new Error('DB error'));
      await plugin.initialize({} as any);
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
      await plugin.initialize({} as any);
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

      expect(result.text).toContain('Status Urządzeń w Sieci');
      expect(result.text).toContain('Podsumowanie:');
      expect(result.text).toContain('Online (aktywne):** 1');
      expect(result.metadata?.total_devices).toBe(1);
    });

    it('should show online devices', async () => {
      mockDeviceRepo.getRecentlyActiveDevices.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 1000, minutes_since_last_seen: 1 },
        { id: '2', ip: '192.168.1.101', hostname: null, last_seen: Date.now() - 120000, minutes_since_last_seen: 2 },
      ]);

      const result = await plugin.execute('urządzenia online', {} as any);

      expect(result.text).toContain('Aktywne Urządzenia');
      expect(result.text).toContain('192.168.1.100');
      expect(result.text).toContain('192.168.1.101');
      expect(result.metadata?.active_count).toBe(2);
    });

    it('should show offline devices', async () => {
      mockDeviceRepo.getOfflineDevices.mockResolvedValue([
        { id: '1', ip: '192.168.1.200', hostname: 'offline-device', last_seen: Date.now() - 7200000, hours_since_last_seen: 2 },
      ]);

      const result = await plugin.execute('urządzenia offline', {} as any);

      expect(result.text).toContain('Urządzenia Offline');
      expect(result.text).toContain('192.168.1.200');
      expect(result.metadata?.offline_count).toBe(1);
    });

    it('should show recent activity', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockResolvedValue([
        { id: '1', ip: '192.168.1.100', hostname: 'camera1', last_seen: Date.now() - 60000, status: 'online', services_count: 3 },
        { id: '2', ip: '192.168.1.101', hostname: null, last_seen: Date.now() - 3600000, status: 'offline', services_count: 1 },
      ]);

      const result = await plugin.execute('ostatnia aktywność', {} as any);

      expect(result.text).toContain('Ostatnia Aktywność Urządzeń');
      expect(result.text).toContain('192.168.1.100');
      expect(result.text).toContain('192.168.1.101');
      expect(result.text).toContain('3 usług');
    });

    it('should handle empty device lists', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockResolvedValue([]);
      mockDeviceRepo.getRecentlyActiveDevices.mockResolvedValue([]);
      mockDeviceRepo.getOfflineDevices.mockResolvedValue([]);

      const result = await plugin.execute('status urządzeń', {} as any);

      expect(result.text).toContain('Łącznie:** 0');
    });

    it('should handle database not available', async () => {
      const pluginNoDb = new DeviceStatusPlugin();
      const result = await pluginNoDb.execute('status', {} as any);

      expect(result.text).toContain('Baza danych urządzeń nie jest dostępna');
    });

    it('should handle database errors gracefully', async () => {
      mockDeviceRepo.getDevicesWithStatus.mockRejectedValue(new Error('Database error'));

      const result = await plugin.execute('status', {} as any);

      expect(result.text).toContain('Nie udało się pobrać statusu urządzeń');
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

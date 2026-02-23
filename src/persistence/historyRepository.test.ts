import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryRepository } from './historyRepository';
import { InMemoryDbAdapter } from './databaseManager';

// Use a real-ish in-memory store for testing
function createMockDb() {
  const rows: Record<string, any[]> = {};

  return {
    dbPath: ':memory:',
    isOpen: true,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      // Simple table tracking for test assertions
      const table = sql.match(/INTO\s+(\w+)/i)?.[1] || sql.match(/UPDATE\s+(\w+)/i)?.[1];
      if (table && !rows[table]) rows[table] = [];
    }),
    query: vi.fn(async <T>(_sql: string, _params: unknown[] = []): Promise<T[]> => {
      return [] as T[];
    }),
    queryOne: vi.fn(async <T>(_sql: string, _params: unknown[] = []): Promise<T | null> => {
      return null;
    }),
    close: vi.fn(async () => {}),
    _rows: rows,
  };
}

describe('HistoryRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: HistoryRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new HistoryRepository(db as any);
  });

  describe('Command History', () => {
    it('upsertCommand inserts new command when not existing', async () => {
      db.queryOne.mockResolvedValueOnce(null); // no existing

      await repo.upsertCommand('skanuj sieć', 'Znaleziono 3 urządzenia', 'network', true);

      expect(db.queryOne).toHaveBeenCalledWith(
        'SELECT id FROM command_history WHERE command = ?',
        ['skanuj sieć'],
      );
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO command_history'),
        expect.arrayContaining(['skanuj sieć', 'Znaleziono 3 urządzenia', 'network', 1]),
      );
    });

    it('upsertCommand updates existing command', async () => {
      db.queryOne.mockResolvedValueOnce({ id: '123' });

      await repo.upsertCommand('skanuj sieć', 'Nowy wynik', 'network', true);

      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE command_history'),
        expect.arrayContaining(['Nowy wynik', 'network', 1, '123']),
      );
    });

    it('saveCommand calls execute with correct params', async () => {
      await repo.saveCommand({
        id: 'cmd-1',
        command: 'ping 192.168.1.1',
        result: 'OK',
        category: 'network',
        success: true,
        timestamp: 1000,
      });

      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO command_history'),
        ['cmd-1', 'ping 192.168.1.1', 'OK', 'network', 1, 1000],
      );
    });

    it('listCommands returns empty array on error', async () => {
      db.query.mockRejectedValueOnce(new Error('db error'));
      const result = await repo.listCommands();
      expect(result).toEqual([]);
    });

    it('listCommands maps success field from number to boolean', async () => {
      db.query.mockResolvedValueOnce([
        { id: '1', command: 'test', result: null, category: 'other', success: 1, timestamp: 1000 },
        { id: '2', command: 'fail', result: 'err', category: 'network', success: 0, timestamp: 900 },
      ]);

      const result = await repo.listCommands();
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
    });
  });

  describe('Network History', () => {
    it('saveNetworkEntry inserts new entry when not existing', async () => {
      db.queryOne.mockResolvedValueOnce(null);

      await repo.saveNetworkEntry({
        address: '192.168.1.0/24',
        name: 'Sieć lokalna',
        scope: 'local',
        description: 'Test',
      });

      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO network_history'),
        expect.arrayContaining(['192.168.1.0/24', 'Sieć lokalna', 'local', 'Test']),
      );
    });

    it('saveNetworkEntry updates existing entry and increments usage_count', async () => {
      db.queryOne.mockResolvedValueOnce({ id: 'net-1', usage_count: 3 });

      await repo.saveNetworkEntry({
        address: '192.168.1.0/24',
        name: 'Sieć lokalna',
        scope: 'local',
      });

      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE network_history'),
        expect.arrayContaining(['Sieć lokalna', 'local', 4, 'net-1']),
      );
    });

    it('listNetworkHistory returns empty array on error', async () => {
      db.query.mockRejectedValueOnce(new Error('db error'));
      const result = await repo.listNetworkHistory();
      expect(result).toEqual([]);
    });

    it('getNetworkEntryByAddress returns null on error', async () => {
      db.queryOne.mockRejectedValueOnce(new Error('db error'));
      const result = await repo.getNetworkEntryByAddress('192.168.1.0/24');
      expect(result).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('saveCommand does not throw on db error', async () => {
      db.execute.mockRejectedValueOnce(new Error('db error'));
      await expect(
        repo.saveCommand({ id: '1', command: 'test', timestamp: 1000 }),
      ).resolves.toBeUndefined();
    });

    it('upsertCommand does not throw on db error', async () => {
      db.queryOne.mockRejectedValueOnce(new Error('db error'));
      await expect(repo.upsertCommand('test')).resolves.toBeUndefined();
    });

    it('saveNetworkEntry does not throw on db error', async () => {
      db.queryOne.mockRejectedValueOnce(new Error('db error'));
      await expect(
        repo.saveNetworkEntry({ address: '1.2.3.0/24', name: 'test', scope: 'local' }),
      ).resolves.toBeUndefined();
    });
  });
});

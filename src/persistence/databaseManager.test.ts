import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DatabaseManager,
  TauriDbAdapter,
  InMemoryDbAdapter,
} from './databaseManager';

// ── InMemoryDbAdapter ──────────────────────────────────────

describe('InMemoryDbAdapter', () => {
  let adapter: InMemoryDbAdapter;

  beforeEach(() => {
    adapter = new InMemoryDbAdapter('test.db');
  });

  it('reports dbPath', () => {
    expect(adapter.dbPath).toBe('test.db');
  });

  it('starts open', () => {
    expect(adapter.isOpen).toBe(true);
  });

  it('execute is a no-op', async () => {
    await expect(adapter.execute('CREATE TABLE t (id INT)')).resolves.toBeUndefined();
  });

  it('query returns empty array', async () => {
    const rows = await adapter.query('SELECT * FROM t');
    expect(rows).toEqual([]);
  });

  it('queryOne returns null', async () => {
    const row = await adapter.queryOne('SELECT * FROM t WHERE id = 1');
    expect(row).toBeNull();
  });

  it('close sets isOpen to false', async () => {
    await adapter.close();
    expect(adapter.isOpen).toBe(false);
  });
});

// ── TauriDbAdapter ─────────────────────────────────────────

describe('TauriDbAdapter', () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let adapter: TauriDbAdapter;

  beforeEach(() => {
    mockInvoke = vi.fn().mockResolvedValue(undefined);
    adapter = new TauriDbAdapter('test.db', mockInvoke);
  });

  it('calls db_execute via invoke', async () => {
    await adapter.execute('INSERT INTO t VALUES (?)', [42]);
    expect(mockInvoke).toHaveBeenCalledWith('db_execute', {
      db: 'test.db',
      sql: 'INSERT INTO t VALUES (?)',
      params: [42],
    });
  });

  it('calls db_query via invoke and returns rows', async () => {
    mockInvoke.mockResolvedValueOnce([{ id: 1, name: 'a' }]);
    const rows = await adapter.query('SELECT * FROM t');
    expect(rows).toEqual([{ id: 1, name: 'a' }]);
    expect(mockInvoke).toHaveBeenCalledWith('db_query', {
      db: 'test.db',
      sql: 'SELECT * FROM t',
      params: [],
    });
  });

  it('queryOne returns first row or null', async () => {
    mockInvoke.mockResolvedValueOnce([{ id: 1 }]);
    expect(await adapter.queryOne('SELECT * FROM t LIMIT 1')).toEqual({ id: 1 });

    mockInvoke.mockResolvedValueOnce([]);
    expect(await adapter.queryOne('SELECT * FROM t WHERE 0')).toBeNull();
  });

  it('close calls db_close and sets isOpen false', async () => {
    await adapter.close();
    expect(mockInvoke).toHaveBeenCalledWith('db_close', { db: 'test.db' });
    expect(adapter.isOpen).toBe(false);
  });
});

// ── DatabaseManager ────────────────────────────────────────

describe('DatabaseManager', () => {
  it('initializes in in-memory mode (no tauriInvoke)', async () => {
    const mgr = new DatabaseManager({
      devicesDbPath: 'devices.db',
      chatDbPath: 'chat.db',
      walMode: true,
      connectionPoolSize: 1,
    });

    await mgr.initialize();
    expect(mgr.isReady()).toBe(true);

    const devDb = mgr.getDevicesDb();
    expect(devDb).toBeDefined();
    expect(devDb.dbPath).toBe('devices.db');

    const chatDb = mgr.getChatDb();
    expect(chatDb).toBeDefined();
    expect(chatDb.dbPath).toBe('chat.db');

    await mgr.close();
    expect(mgr.isReady()).toBe(false);
  });

  it('initializes in Tauri mode with mock invoke', async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    const mgr = new DatabaseManager(
      {
        devicesDbPath: 'devices.db',
        chatDbPath: 'chat.db',
        walMode: true,
        connectionPoolSize: 1,
      },
      mockInvoke,
    );

    await mgr.initialize();
    expect(mgr.isReady()).toBe(true);

    // Should have called db_execute for migrations table + db_query for applied versions
    expect(mockInvoke).toHaveBeenCalled();

    const devDb = mgr.getDevicesDb();
    expect(devDb).toBeInstanceOf(TauriDbAdapter);

    await mgr.close();
  });

  it('does not double-initialize', async () => {
    const mgr = new DatabaseManager({
      devicesDbPath: ':memory:',
      chatDbPath: ':memory:',
      walMode: true,
      connectionPoolSize: 1,
    });

    await mgr.initialize();
    await mgr.initialize(); // should be idempotent
    expect(mgr.isReady()).toBe(true);
    await mgr.close();
  });

  it('throws when getting db before init', () => {
    const mgr = new DatabaseManager({
      devicesDbPath: ':memory:',
      chatDbPath: ':memory:',
      walMode: true,
      connectionPoolSize: 1,
    });

    expect(() => mgr.getDevicesDb()).toThrow('Devices database not initialized');
    expect(() => mgr.getChatDb()).toThrow('Chat database not initialized');
  });

  it('getStats works in in-memory mode', async () => {
    const mgr = new DatabaseManager({
      devicesDbPath: ':memory:',
      chatDbPath: ':memory:',
      walMode: true,
      connectionPoolSize: 1,
    });
    await mgr.initialize();
    const stats = await mgr.getStats();
    expect(stats).toHaveProperty('devices');
    expect(stats).toHaveProperty('chat');
    await mgr.close();
  });

  it('transaction passes both dbs', async () => {
    const mgr = new DatabaseManager({
      devicesDbPath: ':memory:',
      chatDbPath: ':memory:',
      walMode: true,
      connectionPoolSize: 1,
    });
    await mgr.initialize();

    const result = await mgr.transaction(async (devDb, chatDb) => {
      expect(devDb).toBeDefined();
      expect(chatDb).toBeDefined();
      return 'ok';
    });
    expect(result).toBe('ok');

    await mgr.close();
  });
});

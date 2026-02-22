/**
 * @module persistence/database
 * @description SQLite database manager for Broxeen.
 *
 * Two separate databases (SRP):
 * - devices.db: network devices, services, content snapshots, change history
 * - chat.db: conversations, messages, watch rules
 *
 * Uses better-sqlite3 in Tauri (via Rust) or sql.js in browser.
 * Abstracted behind DbAdapter interface (DIP).
 */

// ─── Database Adapter Interface ─────────────────────────────

export interface DbAdapter {
  execute(sql: string, params?: unknown[]): void;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  close(): void;
  readonly isOpen: boolean;
}

// ─── Schema Definitions ─────────────────────────────────────

const DEVICES_SCHEMA = `
  -- Wykryte urządzenia w sieci lokalnej
  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,          -- np. "192.168.1.100" lub UUID
    ip          TEXT NOT NULL,
    mac         TEXT,
    hostname    TEXT,
    name        TEXT,                      -- friendly name nadany przez usera
    device_type TEXT DEFAULT 'unknown',    -- camera, sensor, server, printer...
    first_seen  INTEGER NOT NULL,          -- unix ms
    last_seen   INTEGER NOT NULL,
    is_online   INTEGER DEFAULT 1,
    metadata    TEXT DEFAULT '{}'          -- JSON extra fields
  );

  CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
  CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(device_type);

  -- Usługi wykryte na urządzeniu
  CREATE TABLE IF NOT EXISTS device_services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    protocol    TEXT NOT NULL,             -- http, https, rtsp, mqtt, ssh, api
    port        INTEGER NOT NULL,
    path        TEXT DEFAULT '/',          -- np. "/stream", "/api/v1"
    label       TEXT,                      -- "Kamera HD", "MQTT Broker"
    is_active   INTEGER DEFAULT 1,
    probed_at   INTEGER NOT NULL,
    response_ms INTEGER,
    metadata    TEXT DEFAULT '{}',
    UNIQUE(device_id, protocol, port, path)
  );

  CREATE INDEX IF NOT EXISTS idx_services_device ON device_services(device_id);
  CREATE INDEX IF NOT EXISTS idx_services_protocol ON device_services(protocol);

  -- Snapshoty treści z endpointów (do wykrywania zmian)
  CREATE TABLE IF NOT EXISTS content_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id TEXT NOT NULL,             -- "http://192.168.1.100:80/" lub "camera:cam-front"
    content_hash TEXT NOT NULL,            -- SHA-256 of content
    content_text TEXT,                     -- treść (do diffowania), NULL dla obrazów
    content_size INTEGER,
    snapshot_at INTEGER NOT NULL,
    metadata    TEXT DEFAULT '{}'          -- np. { "scene_description": "..." } dla kamer
  );

  CREATE INDEX IF NOT EXISTS idx_snapshots_endpoint ON content_snapshots(endpoint_id, snapshot_at);

  -- Historia zmian na endpointach
  CREATE TABLE IF NOT EXISTS change_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id   TEXT NOT NULL,
    change_type   TEXT NOT NULL,           -- content_changed, status_changed, new_service, device_offline
    description   TEXT NOT NULL,           -- opis zmiany do wyświetlenia
    old_hash      TEXT,
    new_hash      TEXT,
    diff_summary  TEXT,                    -- krótki diff
    severity      TEXT DEFAULT 'info',     -- info, warning, alert
    detected_at   INTEGER NOT NULL,
    acknowledged  INTEGER DEFAULT 0       -- czy user widział
  );

  CREATE INDEX IF NOT EXISTS idx_changes_endpoint ON change_history(endpoint_id, detected_at);
  CREATE INDEX IF NOT EXISTS idx_changes_unread ON change_history(acknowledged, detected_at);
`;

const CHAT_SCHEMA = `
  -- Konwersacje
  CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    metadata    TEXT DEFAULT '{}'
  );

  -- Wiadomości (zastępuje in-memory EventStore dla persistence)
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,           -- user, assistant, system
    type            TEXT DEFAULT 'text',     -- text, content, image, error, notification
    content         TEXT NOT NULL,
    title           TEXT,
    source_plugin   TEXT,                    -- plugin_id który wygenerował odpowiedź
    source_url      TEXT,
    created_at      INTEGER NOT NULL,
    metadata        TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

  -- Reguły obserwacji (watch rules)
  CREATE TABLE IF NOT EXISTS watch_rules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_id   TEXT NOT NULL,             -- co obserwować
    intent        TEXT NOT NULL,             -- camera:describe, browse, iot:read
    query_text    TEXT,                      -- oryginalne zapytanie usera
    plugin_id     TEXT NOT NULL,
    poll_interval_ms INTEGER DEFAULT 60000,  -- jak często sprawdzać
    watch_until   INTEGER NOT NULL,          -- unix ms — kiedy przestać
    is_active     INTEGER DEFAULT 1,
    created_at    INTEGER NOT NULL,
    last_poll_at  INTEGER,
    metadata      TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_watch_active ON watch_rules(is_active, watch_until);
  CREATE INDEX IF NOT EXISTS idx_watch_endpoint ON watch_rules(endpoint_id);
`;

// ─── Database Manager ───────────────────────────────────────

export class DatabaseManager {
  private devicesDb: DbAdapter | null = null;
  private chatDb: DbAdapter | null = null;

  constructor(
    private readonly createAdapter: (path: string) => DbAdapter,
    private readonly basePath: string = "",
  ) {}

  async initialize(): Promise<void> {
    const devicesPath = this.basePath
      ? `${this.basePath}/devices.db`
      : ":memory:";
    const chatPath = this.basePath
      ? `${this.basePath}/chat.db`
      : ":memory:";

    this.devicesDb = this.createAdapter(devicesPath);
    this.chatDb = this.createAdapter(chatPath);

    // Enable WAL mode for concurrent reads
    this.devicesDb.execute("PRAGMA journal_mode=WAL");
    this.devicesDb.execute("PRAGMA foreign_keys=ON");
    this.chatDb.execute("PRAGMA journal_mode=WAL");
    this.chatDb.execute("PRAGMA foreign_keys=ON");

    // Run migrations
    this.devicesDb.execute(DEVICES_SCHEMA);
    this.chatDb.execute(CHAT_SCHEMA);
  }

  get devices(): DbAdapter {
    if (!this.devicesDb) throw new Error("DatabaseManager not initialized");
    return this.devicesDb;
  }

  get chat(): DbAdapter {
    if (!this.chatDb) throw new Error("DatabaseManager not initialized");
    return this.chatDb;
  }

  close(): void {
    this.devicesDb?.close();
    this.chatDb?.close();
    this.devicesDb = null;
    this.chatDb = null;
  }
}

// ─── Tauri SQLite Adapter (calls Rust) ──────────────────────

export class TauriSqliteAdapter implements DbAdapter {
  private _isOpen = false;
  private readonly dbPath: string;
  private readonly invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  constructor(
    dbPath: string,
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.dbPath = dbPath;
    this.invoke = invoke;
    this._isOpen = true;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  execute(sql: string, params: unknown[] = []): void {
    // Fire-and-forget to Rust
    this.invoke("db_execute", { db: this.dbPath, sql, params });
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    // Synchronous bridge — in practice this would be async
    // For now, we use a sync wrapper pattern
    throw new Error("Use queryAsync() in Tauri — sync query not supported");
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    throw new Error("Use queryOneAsync() in Tauri");
  }

  close(): void {
    this._isOpen = false;
    this.invoke("db_close", { db: this.dbPath });
  }
}

// ─── In-Memory Adapter (for browser/testing) ────────────────

export class InMemoryDbAdapter implements DbAdapter {
  private tables = new Map<string, unknown[]>();
  private _isOpen = true;
  private autoId = 0;

  get isOpen(): boolean {
    return this._isOpen;
  }

  execute(sql: string, _params: unknown[] = []): void {
    // Minimal SQL parser for CREATE TABLE and PRAGMA — real impl uses sql.js
    if (sql.includes("PRAGMA") || sql.includes("CREATE")) return;

    // For INSERT/UPDATE/DELETE, delegate to internal store
    // This is a simplified mock — production uses sql.js WASM
  }

  query<T>(sql: string, params: unknown[] = []): T[] {
    return [] as T[];
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | null {
    const results = this.query<T>(sql, params);
    return results[0] ?? null;
  }

  close(): void {
    this._isOpen = false;
    this.tables.clear();
  }
}

# Broxeen v2.1 — Discovery, Persistence & Reactive Monitoring

## Overview

Broxeen v2.1 introduces a comprehensive multi-layer architecture for device discovery, persistent storage, and reactive monitoring. The system automatically discovers network devices, monitors them for changes, and provides real-time notifications through an intuitive chat interface.

## Architecture Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                      PRESENTATION                                 │
│  Chat.tsx + WatchBadge (powiadomienia o zmianach)                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────────┐
│                   REACTIVE LAYER (NOWY)                            │
│                                                                    │
│  ┌────────────────────┐  ┌──────────────────────────────────┐    │
│  │ WatchManager       │  │ ChangeDetector                   │    │
│  │ • time windows     │  │ • diff content snapshots         │    │
│  │ • auto-watch from  │  │ • emit ChangeDetectedEvent       │    │
│  │   recent queries   │  │ • configurable poll intervals    │    │
│  └────────────────────┘  └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────────┐
│                   DISCOVERY LAYER (NOWY)                           │
│                                                                    │
│  ┌────────────────────┐  ┌──────────────────────────────────┐    │
│  │ NetworkScanner     │  │ ServiceProber                    │    │
│  │ • ARP/ping sweep   │  │ • HTTP probe (80,443,8080)      │    │
│  │ • mDNS/Bonjour     │  │ • RTSP probe (554)              │    │
│  │ • SSDP/UPnP        │  │ • MQTT probe (1883,9001)        │    │
│  └────────────────────┘  │ • SSH/API probe                  │    │
│                           └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────────┐
│                   PERSISTENCE LAYER (NOWY)                         │
│                                                                    │
│  ┌─────────────────────────┐  ┌────────────────────────────────┐ │
│  │ devices.db (SQLite)     │  │ chat.db (SQLite)               │ │
│  │ • devices               │  │ • messages                     │ │
│  │ • device_services       │  │ • conversations                │ │
│  │ • content_snapshots     │  │ • watch_rules                  │ │
│  │ • change_history        │  │                                │ │
│  └─────────────────────────┘  └────────────────────────────────┘ │
│                                                                    │
│  DatabaseManager: migration, connection pooling, WAL mode          │
└──────────────────────────────────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────────┐
│              PLUGIN LAYER (rozszerzony)                             │
│  HTTP Browse │ RTSP Camera │ MQTT │ ← discovery auto-registers     │
└──────────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Network Discovery
- **Multiple scan methods**: ARP, ping sweep, mDNS/Bonjour, SSDP/UPnP
- **Service probing**: HTTP, RTSP, MQTT, SSH, API endpoints
- **Automatic device classification**: Cameras, servers, IoT devices
- **Concurrent scanning**: Configurable parallelism for performance

### 2. Persistent Storage
- **Dual SQLite databases**: `devices.db` for network data, `chat.db` for conversations
- **Automatic migrations**: Schema evolution with version tracking
- **WAL mode**: Optimized for concurrent access
- **Connection pooling**: Efficient database resource management

### 3. Reactive Monitoring
- **Time window logic**: Auto-watch based on recent queries
- **Change detection**: Content diff analysis with configurable thresholds
- **Real-time notifications**: WatchBadge component for UI alerts
- **Configurable polling**: Service-specific intervals and sensitivity

### 4. Chat Integration
- **Natural language queries**: "skanuj sieć", "co widać na kamerze w salonie?"
- **Intent recognition**: Automatic routing to appropriate plugins
- **Auto-watch triggers**: Queries automatically create monitoring rules
- **Change notifications**: Real-time alerts in chat interface

## Database Schema

### devices.db
```sql
-- Discovered network devices
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL UNIQUE,
  hostname TEXT,
  mac TEXT,
  vendor TEXT,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Services running on devices
CREATE TABLE device_services (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'rtsp', 'mqtt', 'ssh', 'api')),
  port INTEGER NOT NULL,
  path TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_checked INTEGER NOT NULL,
  metadata TEXT, -- JSON
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Content snapshots for change detection
CREATE TABLE content_snapshots (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  captured_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES device_services(id) ON DELETE CASCADE
);

-- History of detected changes
CREATE TABLE change_history (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  previous_snapshot_id TEXT NOT NULL,
  current_snapshot_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('content', 'status', 'metadata')),
  change_score REAL NOT NULL,
  detected_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES device_services(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE,
  FOREIGN KEY (current_snapshot_id) REFERENCES content_snapshots(id) ON DELETE CASCADE
);
```

### chat.db
```sql
-- Conversation sessions
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  metadata TEXT -- JSON
);

-- Chat messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  metadata TEXT, -- JSON
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Watch rules for monitoring
CREATE TABLE watch_rules (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('device', 'service')),
  intent TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  poll_interval_ms INTEGER NOT NULL,
  change_threshold REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_polled INTEGER,
  last_change_detected INTEGER,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

## Usage Examples

### Network Discovery
```bash
# User queries
"skanuj sieć"
"odkryj urządzenia"
"znajdź kamery w sieci"

# System response
🔍 **Skanowanie sieci zakończone**

Metoda: ping
Czas trwania: 2341ms
Znaleziono urządzeń: 5

**Znalezione urządzenia:**

1. **192.168.1.1**
   Hostname: router
   MAC: aa:bb:cc:dd:ee:ff
   Producent: TP-Link
   Otwarte porty: 80, 443
   Czas odpowiedzi: 12ms
```

### Service Probing
```bash
# User queries
"co działa na 192.168.1.50?"
"sprawdź kamerę salon"
"opisz usługi na serwerze"

# System response
🔍 **Sprawdzanie usług na 192.168.1.50**

Czas trwania: 1250ms
Znaleziono usług: 2

**Znalezione usługi:**

1. **HTTP** (port 80)
   Status: 🟢 Online
   Czas odpowiedzi: 45ms
   Tytuł: Camera Live Stream
   Serwer: nginx/1.18.0

2. **RTSP** (port 554)
   Status: 🟢 Online
   Czas odpowiedzi: 23ms
   RTSP: OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN
```

### Auto-Watch & Change Detection
```bash
# User query triggers auto-watch
"co widać na kamerze w salonie?"

# System creates watch rule and starts monitoring
👁️ Started watching service:camera-salon

# 20 minutes later - change detected
🔔 **Change detected for service:camera-salon**
Motion detected in living room (75.3% change)
```

## Configuration

### Watch Parameters
```typescript
// Default configuration
export const defaultWatchConfig = {
  defaultDurationMs: 3600000, // 1 hour
  defaultPollIntervalMs: 30000, // 30 seconds
  defaultChangeThreshold: 0.15, // 15% change
  maxConcurrentWatches: 50,
  cleanupIntervalMs: 300000 // 5 minutes
};

// Service-specific settings
export const servicePollIntervals = {
  camera: 30000, // 30 seconds for cameras
  http: 60000, // 1 minute for HTTP services
  rtsp: 15000, // 15 seconds for RTSP streams
  mqtt: 120000, // 2 minutes for MQTT topics
  api: 30000, // 30 seconds for API endpoints
  device: 60000 // 1 minute for device status
};
```

### Auto-Watch Logic
```typescript
// Time window configuration
export const defaultAutoWatchConfig = {
  enabled: true,
  timeWindowMs: 3600000, // Look back 1 hour for recent queries
  watchDurationMs: 3600000, // Watch for 1 hour after query
  intentsToWatch: [
    'camera:describe',
    'device:status',
    'service:describe',
    'http:describe',
    'rtsp:describe',
    'mqtt:describe',
    'api:describe'
  ],
  excludePatterns: ['test', 'demo', 'przykład', 'example']
};
```

## Implementation Details

### Time Window Logic
The system implements intelligent auto-watch based on user query patterns:

```
query_time ─────── watch_start ─────── watch_end
    │                   │                   │
    └─── pytanie ───────┘─── monitoring ────┘
                        teraz            +1h
```

1. User asks about a device/service
2. System checks for recent queries (within time window)
3. If recent query found, auto-watch is triggered
4. Monitoring continues for configured duration
5. Changes detected generate notifications

### Change Detection Algorithm
```typescript
// Jaccard similarity for content comparison
const changeScore = 1 - (intersectionSize / unionSize);

// Change types
- content: Text/visual content changes
- status: Online/offline status changes  
- metadata: Headers, configuration changes

// Thresholds
- camera: 10% (sensitive to visual changes)
- http: 20% (moderate sensitivity)
- rtsp: 15% (stream changes)
- mqtt: 30% (data fluctuations)
```

### Plugin Architecture
New discovery plugins automatically register with the plugin system:

```typescript
// Network Scan Plugin
export class NetworkScanPlugin implements Plugin {
  readonly id = 'network-scan';
  readonly supportedIntents = ['network:scan', 'network:discover', 'network:devices'];
  
  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const result = await this.networkScanner.scanNetwork();
    return { status: 'success', content: [/* formatted results */] };
  }
}

// Service Probe Plugin  
export class ServiceProbePlugin implements Plugin {
  readonly id = 'service-prober';
  readonly supportedIntents = ['service:probe', 'http:describe', 'rtsp:describe'];
  
  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const result = await this.serviceProber.probeDevice(deviceId, target);
    return { status: 'success', content: [/* service details */] };
  }
}
```

## File Structure

```
src/
├── persistence/
│   ├── types.ts              # Database types and interfaces
│   ├── migrations.ts         # Database schema migrations
│   └── databaseManager.ts   # SQLite connection management
├── discovery/
│   ├── types.ts              # Discovery interfaces
│   ├── networkScanner.ts     # Network device discovery
│   └── serviceProber.ts      # Service endpoint probing
├── reactive/
│   ├── types.ts              # Reactive monitoring interfaces
│   ├── watchManager.ts       # Watch rule management
│   └── changeDetector.ts     # Change detection logic
├── integration/
│   └── autoWatchIntegration.ts # Chat-to-watch integration
├── components/
│   └── WatchBadge.tsx        # Change notification UI
├── plugins/discovery/
│   ├── networkScanPlugin.ts  # Network scanning plugin
│   └── serviceProbePlugin.ts # Service probing plugin
└── config/
    └── watchConfig.ts        # Configuration management
```

## Development Notes

### Environment Configuration
```typescript
// Development vs Production settings
export const environmentConfigs = {
  development: {
    watchConfig: {
      defaultPollIntervalMs: 10000, // Faster for testing
      cleanupIntervalMs: 60000
    }
  },
  production: {
    watchConfig: defaultWatchConfig
  }
};
```

### Performance Considerations
- **Concurrent limits**: Configurable parallelism for scanning/probing
- **Database pooling**: WAL mode with connection pooling
- **Efficient polling**: Service-specific intervals to balance responsiveness vs resource usage
- **Change detection**: Content hashing and diff algorithms for performance

### Security Considerations
- **Network scanning**: Configurable exclude ranges for sensitive networks
- **Service probing**: Timeout limits and retry policies
- **Data persistence**: Local SQLite storage (no cloud dependencies)
- **Access control**: Plugin-based intent routing for permission management

## Future Enhancements

1. **Advanced Discovery**: Zeroconf, UPnP event notifications
2. **Machine Learning**: Anomaly detection, pattern recognition
3. **Cloud Integration**: Optional cloud storage and remote monitoring
4. **Mobile Support**: Responsive design for mobile devices
5. **API Gateway**: REST API for external integrations
6. **Dashboard**: Web dashboard for system overview and management

---

This architecture provides a solid foundation for intelligent network monitoring and reactive automation while maintaining modularity, performance, and extensibility.

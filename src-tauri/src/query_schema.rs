//! query_schema.rs — Schema definitions for all Broxeen data sources.
//!
//! Inspired by nlp2cmd's Action Registry pattern: define typed schemas
//! that constrain LLM output to valid, safe queries.
//!
//! Instead of hardcoded keyword matching (extract_date_filter, nl_to_sql),
//! the LLM receives these schemas and generates correct SQL/commands.

/// SQLite schema for the monitoring/detections database.
/// Used as context for LLM text-to-SQL generation.
pub const DETECTIONS_SCHEMA: &str = r#"
-- Table: detections (YOLO object detections, one row per tracked object)
CREATE TABLE detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,        -- ISO 8601 UTC, e.g. '2026-02-23T18:05:30Z'
    local_date TEXT NOT NULL,       -- 'YYYY-MM-DD' in local timezone
    local_hour INTEGER NOT NULL,    -- 0-23 in local timezone
    camera_id TEXT NOT NULL,        -- e.g. 'camera-192.168.188.176'
    track_id TEXT NOT NULL,         -- UUID of tracked object
    label TEXT NOT NULL,            -- YOLO class: 'person','car','truck','bus','bicycle','motorcycle','dog','cat','bird','horse','backpack','handbag','suitcase','umbrella','bottle','chair','laptop','cell phone','clock'
    confidence REAL NOT NULL,       -- 0.0-1.0 detection confidence
    movement TEXT,                  -- description: 'walking left', 'standing', 'running'
    direction TEXT,                 -- 'left','right','up','down','stationary'
    speed_label TEXT,               -- 'slow','moderate','fast'
    entry_zone TEXT,                -- where object entered: 'left','right','upper-left','centre','bottom'
    exit_zone TEXT,                 -- where object exited (empty if still present)
    duration_s REAL NOT NULL DEFAULT 0, -- how long object was tracked (seconds)
    thumbnail BLOB                  -- optional JPEG crop
);

-- Table: llm_events (LLM-generated scene narratives, ~1 per minute)
CREATE TABLE IF NOT EXISTS llm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    narrative TEXT NOT NULL,         -- LLM-generated scene description
    object_count INTEGER,
    labels TEXT                      -- comma-separated labels seen
);

-- View: monitoring_history (combined view for queries)
CREATE VIEW IF NOT EXISTS monitoring_history AS
SELECT
    d.id, d.timestamp, d.camera_id, d.label, d.confidence,
    d.movement, d.direction, d.speed_label,
    d.entry_zone, d.exit_zone, d.duration_s,
    e.narrative
FROM detections d
LEFT JOIN llm_events e ON d.camera_id = e.camera_id
    AND abs(julianday(d.timestamp) - julianday(e.timestamp)) < 0.0007;
"#;

/// SQLite schema for the devices database.
pub const DEVICES_SCHEMA: &str = r#"
-- Table: devices (discovered network devices)
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    hostname TEXT,
    mac TEXT,
    vendor TEXT,
    last_seen INTEGER NOT NULL,     -- Unix timestamp ms
    status TEXT DEFAULT 'unknown'   -- 'online','offline','unknown'
);

-- Table: services (discovered services on devices)
CREATE TABLE services (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    type TEXT NOT NULL,              -- 'http','rtsp','ssh','mqtt','api'
    port INTEGER NOT NULL,
    path TEXT,
    status TEXT DEFAULT 'unknown',
    metadata TEXT,                   -- JSON
    last_checked INTEGER NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id)
);

-- Table: configured_devices (user-configured monitoring targets)
CREATE TABLE configured_devices (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    ip TEXT NOT NULL,
    rtsp_url TEXT,
    http_url TEXT,
    device_type TEXT DEFAULT 'camera',
    username TEXT,
    password TEXT,
    monitor_enabled INTEGER DEFAULT 0,
    monitor_interval_ms INTEGER DEFAULT 3000,
    monitor_change_threshold REAL DEFAULT 0.15,
    last_snapshot_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

/// SQLite schema for the chat database.
pub const CHAT_SCHEMA: &str = r#"
-- Table: conversations
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
);

-- Table: messages
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,              -- 'user','assistant','system'
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    metadata TEXT,                   -- JSON
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Table: command_history
CREATE TABLE command_history (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    result TEXT,
    category TEXT,
    success INTEGER DEFAULT 1,
    timestamp INTEGER NOT NULL,
    count INTEGER DEFAULT 1
);
"#;

/// System prompt for text-to-SQL generation.
/// Constrains LLM output to valid SQLite SELECT statements.
pub fn build_text_to_sql_prompt(schema: &str) -> String {
    format!(
        r#"You are a SQLite query generator for a monitoring system.

Given the database schema below, convert the user's natural language question into a single SQLite SELECT query.

SCHEMA:
```sql
{schema}
```

RULES:
- Output ONLY the SQL query, nothing else
- No markdown, no explanation, no backticks
- Only SELECT queries (never INSERT, UPDATE, DELETE, DROP)
- Use only tables and columns from the schema
- For time filters use: datetime('now', '-N minutes') or datetime('now', '-N hours')
- 'today' = date(timestamp) = date('now') or local_date = date('now','localtime')
- 'yesterday' = date(timestamp) = date('now','-1 day')
- Labels are lowercase: 'person', 'car', 'truck', 'bus', 'bicycle', etc.
- Always use COUNT(*) for counting questions
- Include MIN(timestamp) as first_seen, MAX(timestamp) as last_seen for time ranges
- For Polish: 'osób/osoby/ludzi' = person, 'samochód/auto' = car, 'rower' = bicycle
- Use GROUP BY camera_id when asking per-camera stats
- Default ORDER BY timestamp DESC
- Default LIMIT 50 unless user specifies otherwise"#,
        schema = schema
    )
}

/// Available data sources that the LLM can query.
/// Used to route queries to the correct database.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DataSource {
    /// monitoring.db — detections, llm_events
    Monitoring,
    /// broxeen_devices.db — devices, services, configured_devices
    Devices,
    /// broxeen_chat.db — conversations, messages, command_history
    Chat,
}

impl DataSource {
    /// Get the database filename for this data source.
    pub fn db_filename(&self) -> &'static str {
        match self {
            DataSource::Monitoring => "monitoring.db",
            DataSource::Devices => "broxeen_devices.db",
            DataSource::Chat => "broxeen_chat.db",
        }
    }

    /// Get the SQL schema for this data source.
    pub fn schema(&self) -> &'static str {
        match self {
            DataSource::Monitoring => DETECTIONS_SCHEMA,
            DataSource::Devices => DEVICES_SCHEMA,
            DataSource::Chat => CHAT_SCHEMA,
        }
    }
}

/// Detect which data source a query targets based on keywords.
/// This is a lightweight pre-filter; the LLM handles the actual SQL generation in text_to_sql().
pub fn detect_data_source(question: &str) -> DataSource {
    detect_data_source_keywords(question)
}

/// LLM-based data source detection
fn detect_data_source_llm(question: &str, api_key: &str) -> Option<DataSource> {
    use serde_json::{json, Value};
    
    let prompt = format!(
        r#"Analyze this question and determine which data source it targets.
        
Data sources:
- Monitoring: camera detections, motion, objects, people, vehicles, AI analysis
- Devices: network devices, cameras, services, hosts, IP addresses, RTSP, MQTT
- Chat: conversations, messages, history, commands

Question: "{}"

Respond with only one word: "Monitoring", "Devices", or"Chat"."#,
        question
    );

    let client = reqwest::Client::new();
    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": std::env::var("LLM_MODEL").unwrap_or_else(|_| "google/gemini-2.0-flash-exp:free".to_string()),
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.0,
            "max_tokens": 10
        }))
        .send()
        .await;

    if let Ok(resp) = response {
        if let Ok(text) = resp.text().await {
            if let Ok(json_val) = serde_json::from_str::<Value>(&text) {
                if let Some(content) = json_val
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                {
                    let content = content.trim().to_lowercase();
                    return match content.as_str() {
                        "monitoring" => Some(DataSource::Monitoring),
                        "devices" => Some(DataSource::Devices),
                        "chat" => Some(DataSource::Chat),
                        _ => None,
                    };
                }
            }
        }
    }

    None
}

/// Keyword-based data source detection (original implementation)
fn detect_data_source_keywords(question: &str) -> DataSource {
    let q = question.to_lowercase();

    // Monitoring / detection keywords
    if q.contains("osob") || q.contains("osób") || q.contains("person") || q.contains("ludzi")
        || q.contains("samochod") || q.contains("samochód") || q.contains("car")
        || q.contains("rower") || q.contains("bicycle")
        || q.contains("detekcj") || q.contains("detect")
        || q.contains("monitor") || q.contains("kamer")
        || q.contains("ruch") || q.contains("motion")
        || q.contains("obiekt") || q.contains("object")
        || q.contains("pies") || q.contains("dog")
        || q.contains("kot") || q.contains("cat")
        || q.contains("nar") // narrative
    {
        return DataSource::Monitoring;
    }

    // Device / network keywords
    if q.contains("urządzen") || q.contains("device")
        || q.contains("sieć") || q.contains("siec") || q.contains("network")
        || q.contains("ip ") || q.contains("host")
        || q.contains("usłu") || q.contains("service")
        || q.contains("port") || q.contains("ssh")
        || q.contains("rtsp") || q.contains("mqtt")
        || q.contains("online") || q.contains("offline")
    {
        return DataSource::Devices;
    }

    // Chat / history keywords
    if q.contains("rozmow") || q.contains("conversation")
        || q.contains("wiadomoś") || q.contains("message")
        || q.contains("histori") || q.contains("history")
        || q.contains("polecen") || q.contains("command")
    {
        return DataSource::Chat;
    }

    // Default to monitoring
    DataSource::Monitoring
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_monitoring() {
        assert_eq!(detect_data_source("ile osób było w pomieszczeniu"), DataSource::Monitoring);
        assert_eq!(detect_data_source("pokaż samochody z ostatniej godziny"), DataSource::Monitoring);
        assert_eq!(detect_data_source("how many people detected today"), DataSource::Monitoring);
    }

    #[test]
    fn test_detect_devices() {
        assert_eq!(detect_data_source("pokaż urządzenia online"), DataSource::Devices);
        assert_eq!(detect_data_source("list network devices"), DataSource::Devices);
        assert_eq!(detect_data_source("jakie usługi są dostępne"), DataSource::Devices);
    }

    #[test]
    fn test_detect_chat() {
        assert_eq!(detect_data_source("historia rozmów"), DataSource::Chat);
        assert_eq!(detect_data_source("pokaż ostatnie polecenia"), DataSource::Chat);
    }

    #[test]
    fn test_default_monitoring() {
        assert_eq!(detect_data_source("co się dzieje"), DataSource::Monitoring);
    }
}

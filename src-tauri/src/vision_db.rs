//! Two-track monitoring database:
//!
//! Track A — LOCAL:  Every detected object → `detections` table (sub-second latency)
//! Track B — LLM:    Every minute batch  → `llm_events` table (confirmed descriptions)
//!
//! Combined view → `monitoring_history` (queryable via text-to-SQL)

use anyhow::Result;
use chrono::{DateTime, Local, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ─── Structs ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalDetection {
    pub id:          i64,
    pub timestamp:   DateTime<Utc>,
    pub camera_id:   String,
    pub track_id:    String,
    pub label:       String,
    pub confidence:  f32,
    pub movement:    Option<String>,
    pub duration_s:  f32,
    pub entry_zone:  Option<String>,
    pub exit_zone:   Option<String>,
    pub direction:   Option<String>,
    pub speed_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmEvent {
    pub id:           i64,
    pub timestamp:    DateTime<Utc>,
    pub camera_id:    String,
    pub period_start: DateTime<Utc>,
    pub period_end:   DateTime<Utc>,
    pub narrative:    String,
    pub provider:     String,
    pub crops_sent:   u32,
    pub context:      String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Statistics {
    pub period_hours:     u32,
    pub camera_id:        Option<String>,
    pub by_class:         Vec<(String, u64)>,
    pub by_hour:          Vec<(String, u64)>,
    pub unique_entries:   u64,
    pub total_detections: u64,
}

// ─── Database ─────────────────────────────────────────────────────────────────

pub struct VisionDatabase {
    conn: Connection,
}

/// The SQL schema — exposed for text-to-SQL context.
pub const SCHEMA: &str = r#"
-- TABLE: detections  (local YOLO results, saved every second per detected object)
CREATE TABLE detections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,          -- ISO8601 UTC
    local_date  TEXT NOT NULL,          -- date('now') for daily grouping
    local_hour  INTEGER NOT NULL,       -- 0..23 local hour
    camera_id   TEXT NOT NULL,          -- e.g. "front-door"
    track_id    TEXT NOT NULL,          -- UUID per tracked object
    label       TEXT NOT NULL,          -- person/car/truck/bus/motorcycle/bicycle/...
    confidence  REAL NOT NULL,          -- 0.0..1.0 YOLO confidence
    movement    TEXT,                   -- e.g. "moving right, centre→right, 2.3s"
    direction   TEXT,                   -- left/right/up/down/upper-right/...
    speed_label TEXT,                   -- slow/moderate/fast/stationary
    entry_zone  TEXT,                   -- upper-left/top/centre/...
    exit_zone   TEXT,
    duration_s  REAL NOT NULL DEFAULT 0,
    thumbnail   BLOB NOT NULL           -- JPEG ≤400px
);

-- TABLE: llm_events  (LLM-confirmed scene descriptions, ~1 per minute)
CREATE TABLE llm_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    TEXT NOT NULL,
    local_date   TEXT NOT NULL,
    camera_id    TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end   TEXT NOT NULL,
    narrative    TEXT NOT NULL,         -- LLM scene description
    provider     TEXT NOT NULL,         -- "openrouter/gemini-2.0-flash" or "local/llava"
    crops_sent   INTEGER NOT NULL,
    context      TEXT NOT NULL          -- timeline sent to LLM
);

-- VIEW: monitoring_history  (unified for NL queries)
CREATE VIEW monitoring_history AS
SELECT
    d.id,
    d.timestamp,
    d.local_date  AS date,
    d.local_hour  AS hour,
    d.camera_id,
    d.track_id,
    d.label       AS object_type,
    d.confidence,
    d.movement,
    d.direction,
    d.speed_label AS speed,
    d.entry_zone,
    d.exit_zone,
    d.duration_s,
    (SELECT le.narrative
     FROM llm_events le
     WHERE le.camera_id = d.camera_id
       AND le.period_start <= d.timestamp
       AND le.period_end   >= d.timestamp
     ORDER BY le.id DESC LIMIT 1) AS llm_narrative
FROM detections d;
"#;

impl VisionDatabase {
    pub fn open(path: &str) -> Result<Self> {
        let resolved = resolve_db_path(path);
        let conn = Connection::open(&resolved)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch("
            CREATE TABLE IF NOT EXISTS detections (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   TEXT    NOT NULL,
                local_date  TEXT    NOT NULL,
                local_hour  INTEGER NOT NULL,
                camera_id   TEXT    NOT NULL,
                track_id    TEXT    NOT NULL,
                label       TEXT    NOT NULL,
                confidence  REAL    NOT NULL,
                movement    TEXT,
                direction   TEXT,
                speed_label TEXT,
                entry_zone  TEXT,
                exit_zone   TEXT,
                duration_s  REAL    NOT NULL DEFAULT 0,
                thumbnail   BLOB    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS llm_events (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp    TEXT    NOT NULL,
                local_date   TEXT    NOT NULL,
                camera_id    TEXT    NOT NULL,
                period_start TEXT    NOT NULL,
                period_end   TEXT    NOT NULL,
                narrative    TEXT    NOT NULL,
                provider     TEXT    NOT NULL DEFAULT '',
                crops_sent   INTEGER NOT NULL DEFAULT 0,
                context      TEXT    NOT NULL DEFAULT ''
            );

            CREATE VIEW IF NOT EXISTS monitoring_history AS
            SELECT
                d.id, d.timestamp, d.local_date AS date, d.local_hour AS hour,
                d.camera_id, d.track_id, d.label AS object_type,
                d.confidence, d.movement, d.direction, d.speed_label AS speed,
                d.entry_zone, d.exit_zone, d.duration_s,
                (SELECT le.narrative FROM llm_events le
                 WHERE le.camera_id = d.camera_id
                   AND le.period_start <= d.timestamp
                   AND le.period_end   >= d.timestamp
                 ORDER BY le.id DESC LIMIT 1) AS llm_narrative
            FROM detections d;

            CREATE INDEX IF NOT EXISTS idx_det_ts     ON detections(timestamp);
            CREATE INDEX IF NOT EXISTS idx_det_cam    ON detections(camera_id);
            CREATE INDEX IF NOT EXISTS idx_det_label  ON detections(label);
            CREATE INDEX IF NOT EXISTS idx_det_date   ON detections(local_date);
            CREATE INDEX IF NOT EXISTS idx_llm_ts     ON llm_events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_llm_cam    ON llm_events(camera_id);
        ")?;
        Ok(())
    }

    // ─── Insert ──────────────────────────────────────────────────────────────

    /// Insert a locally-detected object (called immediately on track completion).
    pub fn insert_detection(
        &self,
        camera_id:   &str,
        track_id:    &str,
        label:       &str,
        confidence:  f32,
        movement:    Option<&str>,
        direction:   Option<&str>,
        speed_label: Option<&str>,
        entry_zone:  Option<&str>,
        exit_zone:   Option<&str>,
        duration_s:  f32,
        thumbnail:   &[u8],
    ) -> Result<i64> {
        let now = Utc::now();
        let local = now.with_timezone(&Local);
        self.conn.execute(
            "INSERT INTO detections
             (timestamp,local_date,local_hour,camera_id,track_id,label,confidence,
              movement,direction,speed_label,entry_zone,exit_zone,duration_s,thumbnail)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            params![
                now.to_rfc3339(),
                local.format("%Y-%m-%d").to_string(),
                local.hour(),
                camera_id, track_id, label, confidence,
                movement, direction, speed_label, entry_zone, exit_zone,
                duration_s, thumbnail,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Insert LLM-generated event narrative.
    pub fn insert_llm_event(
        &self,
        camera_id:    &str,
        period_start: DateTime<Utc>,
        period_end:   DateTime<Utc>,
        narrative:    &str,
        provider:     &str,
        crops_sent:   u32,
        context:      &str,
    ) -> Result<i64> {
        let now = Utc::now();
        let local = now.with_timezone(&Local);
        self.conn.execute(
            "INSERT INTO llm_events
             (timestamp,local_date,camera_id,period_start,period_end,
              narrative,provider,crops_sent,context)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                now.to_rfc3339(),
                local.format("%Y-%m-%d").to_string(),
                camera_id,
                period_start.to_rfc3339(),
                period_end.to_rfc3339(),
                narrative, provider, crops_sent, context,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    // ─── Queries ─────────────────────────────────────────────────────────────

    pub fn get_statistics(&self, camera_id: Option<&str>, hours: u32) -> Result<Statistics> {
        let cam_f = cam_filter(camera_id);
        let tf = time_filter(hours);

        let by_class: Vec<(String, u64)> = {
            let sql = format!(
                "SELECT label, COUNT(*) FROM detections WHERE {tf}{cam_f}
                 GROUP BY label ORDER BY 2 DESC"
            );
            let mut s = self.conn.prepare(&sql)?;
            s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,u64>(1)?)))?
                .filter_map(|r| r.ok()).collect()
        };

        let by_hour: Vec<(String, u64)> = {
            let sql = format!(
                "SELECT CAST(local_hour AS TEXT), COUNT(*) FROM detections
                 WHERE {tf}{cam_f} GROUP BY local_hour ORDER BY local_hour"
            );
            let mut s = self.conn.prepare(&sql)?;
            s.query_map([], |r| Ok((r.get::<_,String>(0)?, r.get::<_,u64>(1)?)))?
                .filter_map(|r| r.ok()).collect()
        };

        let unique_entries: u64 = self.conn.query_row(
            &format!("SELECT COUNT(DISTINCT track_id) FROM detections WHERE {tf}{cam_f}"),
            [], |r| r.get(0),
        )?;

        let total: u64 = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM detections WHERE {tf}{cam_f}"),
            [], |r| r.get(0),
        )?;

        Ok(Statistics {
            period_hours: hours,
            camera_id: camera_id.map(String::from),
            by_class, by_hour, unique_entries, total_detections: total,
        })
    }

    /// Execute a raw SQL SELECT query (from text-to-SQL).
    pub fn execute_query(&self, sql: &str) -> Result<(Vec<String>, Vec<Vec<String>>)> {
        let trimmed = sql.trim().to_uppercase();
        if !trimmed.starts_with("SELECT") && !trimmed.starts_with("WITH") {
            anyhow::bail!("Only SELECT queries are allowed");
        }

        let mut stmt = self.conn.prepare(sql)?;
        let col_names: Vec<String> = stmt.column_names()
            .into_iter().map(String::from).collect();

        let rows = stmt.query_map([], |row| {
            let n = row.as_ref().column_count();
            let mut vals = Vec::with_capacity(n);
            for i in 0..n {
                let v = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null       => "NULL".into(),
                    rusqlite::types::ValueRef::Integer(i) => i.to_string(),
                    rusqlite::types::ValueRef::Real(f)    => format!("{:.2}", f),
                    rusqlite::types::ValueRef::Text(t)    => String::from_utf8_lossy(t).into_owned(),
                    rusqlite::types::ValueRef::Blob(b)    => format!("[BLOB {}B]", b.len()),
                };
                vals.push(v);
            }
            Ok(vals)
        })?
        .filter_map(|r| r.ok())
        .collect();

        Ok((col_names, rows))
    }

    pub fn get_thumbnail(&self, id: i64) -> Result<Vec<u8>> {
        Ok(self.conn.query_row(
            "SELECT thumbnail FROM detections WHERE id=?1",
            params![id], |r| r.get(0),
        )?)
    }

    pub fn get_recent_llm_events(&self, camera_id: Option<&str>, limit: u32) -> Result<Vec<LlmEvent>> {
        let cam_f = cam_filter(camera_id);
        let sql = format!(
            "SELECT id,timestamp,camera_id,period_start,period_end,narrative,provider,crops_sent,context
             FROM llm_events WHERE 1=1{cam_f} ORDER BY timestamp DESC LIMIT {limit}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(LlmEvent {
                id:           r.get(0)?,
                timestamp:    parse_dt(r.get::<_,String>(1)?),
                camera_id:    r.get(2)?,
                period_start: parse_dt(r.get::<_,String>(3)?),
                period_end:   parse_dt(r.get::<_,String>(4)?),
                narrative:    r.get(5)?,
                provider:     r.get(6)?,
                crops_sent:   r.get::<_,i64>(7)? as u32,
                context:      r.get(8)?,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn cam_filter(camera_id: Option<&str>) -> String {
    match camera_id {
        Some(id) => format!(" AND camera_id='{}'", id.replace('\'', "''")),
        None     => String::new(),
    }
}

fn time_filter(hours: u32) -> String {
    format!("timestamp > datetime('now', '-{hours} hours')")
}

fn parse_dt(s: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&s)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

/// Resolve bare DB filenames to local app data directory.
fn resolve_db_path(db_path: &str) -> String {
    if Path::new(db_path).is_absolute() {
        return db_path.to_string();
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        let full = data_dir.join("broxeen").join(db_path);
        if let Some(parent) = full.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        return full.to_string_lossy().to_string();
    }
    db_path.to_string()
}

/// Vision Detection Database — SQLite persistence
///
/// Stores detection records with JPEG thumbnails, supports
/// statistics queries and LLM verification updates.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// A saved detection record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRecord {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub camera_id: String,
    pub label: String,
    pub confidence: f32,
    pub llm_label: Option<String>,
    pub llm_description: Option<String>,
    pub sent_to_llm: bool,
    pub bbox_x1: i32,
    pub bbox_y1: i32,
    pub bbox_x2: i32,
    pub bbox_y2: i32,
    pub area: i64,
}

/// Statistics response.
#[derive(Debug, Serialize, Deserialize)]
pub struct Statistics {
    pub period_hours: u32,
    pub camera_id: Option<String>,
    pub by_class: Vec<(String, u64)>,
    pub by_hour: Vec<(String, u64)>,
    pub unique_events_30s: u64,
    pub total: u64,
}

pub struct VisionDatabase {
    conn: Connection,
}

impl VisionDatabase {
    pub fn open(path: &str) -> Result<Self> {
        // Resolve relative paths to local app data
        let resolved = resolve_db_path(path);
        let conn = Connection::open(&resolved)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS detections (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp        TEXT    NOT NULL,
                camera_id        TEXT    NOT NULL,
                label            TEXT    NOT NULL,
                confidence       REAL    NOT NULL,
                llm_label        TEXT,
                llm_description  TEXT,
                sent_to_llm      INTEGER NOT NULL DEFAULT 0,
                thumbnail        BLOB    NOT NULL,
                bbox_x1          INTEGER NOT NULL,
                bbox_y1          INTEGER NOT NULL,
                bbox_x2          INTEGER NOT NULL,
                bbox_y2          INTEGER NOT NULL,
                area             INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ts      ON detections (timestamp);
            CREATE INDEX IF NOT EXISTS idx_cam     ON detections (camera_id);
            CREATE INDEX IF NOT EXISTS idx_label   ON detections (label);
            CREATE INDEX IF NOT EXISTS idx_cam_ts  ON detections (camera_id, timestamp);
        ",
        )?;
        Ok(())
    }

    /// Insert a new detection. `thumbnail` is JPEG bytes.
    pub fn insert_detection(
        &self,
        camera_id: &str,
        label: &str,
        confidence: f32,
        thumbnail: &[u8],
        bbox: (i32, i32, i32, i32),
        area: i64,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO detections
             (timestamp, camera_id, label, confidence, thumbnail,
              bbox_x1, bbox_y1, bbox_x2, bbox_y2, area)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                Utc::now().to_rfc3339(),
                camera_id,
                label,
                confidence,
                thumbnail,
                bbox.0,
                bbox.1,
                bbox.2,
                bbox.3,
                area,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Update an existing record with LLM verification result.
    pub fn update_llm_result(
        &self,
        id: i64,
        llm_label: &str,
        llm_description: &str,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE detections
             SET llm_label = ?1, llm_description = ?2, sent_to_llm = 1
             WHERE id = ?3",
            params![llm_label, llm_description, id],
        )?;
        Ok(())
    }

    /// Retrieve thumbnail JPEG bytes for a detection.
    pub fn get_thumbnail(&self, id: i64) -> Result<Vec<u8>> {
        let bytes: Vec<u8> = self.conn.query_row(
            "SELECT thumbnail FROM detections WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(bytes)
    }

    /// Retrieve recent detections (without thumbnail blob for speed).
    pub fn get_recent(
        &self,
        camera_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DetectionRecord>> {
        let sql = match camera_id {
            Some(_) => {
                "SELECT id, timestamp, camera_id, label, confidence,
                        llm_label, llm_description, sent_to_llm,
                        bbox_x1, bbox_y1, bbox_x2, bbox_y2, area
                 FROM detections
                 WHERE camera_id = ?1 ORDER BY timestamp DESC LIMIT ?2"
            }
            None => {
                "SELECT id, timestamp, camera_id, label, confidence,
                        llm_label, llm_description, sent_to_llm,
                        bbox_x1, bbox_y1, bbox_x2, bbox_y2, area
                 FROM detections
                 ORDER BY timestamp DESC LIMIT ?1"
            }
        };

        let mut stmt = self.conn.prepare(sql)?;

        let rows = if let Some(cam) = camera_id {
            stmt.query_map(params![cam, limit], map_row)?
        } else {
            stmt.query_map(params![limit], map_row)?
        };

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Aggregate statistics for a given time window.
    pub fn get_statistics(
        &self,
        camera_id: Option<&str>,
        hours: u32,
    ) -> Result<Statistics> {
        let cam_filter = match camera_id {
            Some(id) => format!("AND camera_id = '{}'", id.replace('\'', "''")),
            None => String::new(),
        };
        let time_filter = format!("timestamp > datetime('now', '-{} hours')", hours);

        // Per-class counts
        let by_class: Vec<(String, u64)> = {
            let sql = format!(
                "SELECT label, COUNT(*) as cnt FROM detections
                 WHERE {} {} GROUP BY label ORDER BY cnt DESC",
                time_filter, cam_filter
            );
            let mut stmt = self.conn.prepare(&sql)?;
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Per-hour activity
        let by_hour: Vec<(String, u64)> = {
            let sql = format!(
                "SELECT strftime('%H', timestamp) as hr, COUNT(*) as cnt
                 FROM detections WHERE {} {}
                 GROUP BY hr ORDER BY hr",
                time_filter, cam_filter
            );
            let mut stmt = self.conn.prepare(&sql)?;
            stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Unique events in 30-second windows
        let unique_events_30s: u64 = {
            let sql = format!(
                "SELECT COUNT(DISTINCT
                     CAST(strftime('%s', timestamp) / 30 AS INTEGER) || '_' || label)
                 FROM detections
                 WHERE {} {} AND label IN ('person','car','truck','bus','motorcycle')",
                time_filter, cam_filter
            );
            self.conn.query_row(&sql, [], |row| row.get(0))?
        };

        let total: u64 = {
            let sql = format!(
                "SELECT COUNT(*) FROM detections WHERE {} {}",
                time_filter, cam_filter
            );
            self.conn.query_row(&sql, [], |row| row.get(0))?
        };

        Ok(Statistics {
            period_hours: hours,
            camera_id: camera_id.map(String::from),
            by_class,
            by_hour,
            unique_events_30s,
            total,
        })
    }

    /// Count per-class for a specific camera in the last N seconds (cooldown).
    pub fn count_recent_label(
        &self,
        camera_id: &str,
        label: &str,
        seconds: u64,
    ) -> Result<u64> {
        let count: u64 = self.conn.query_row(
            "SELECT COUNT(*) FROM detections
             WHERE camera_id = ?1
               AND label = ?2
               AND timestamp > datetime('now', ?3)",
            params![camera_id, label, format!("-{} seconds", seconds)],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DetectionRecord> {
    let ts_str: String = row.get(1)?;
    let timestamp = DateTime::parse_from_rfc3339(&ts_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or(Utc::now());

    Ok(DetectionRecord {
        id: row.get(0)?,
        timestamp,
        camera_id: row.get(2)?,
        label: row.get(3)?,
        confidence: row.get(4)?,
        llm_label: row.get(5)?,
        llm_description: row.get(6)?,
        sent_to_llm: row.get::<_, i32>(7)? != 0,
        bbox_x1: row.get(8)?,
        bbox_y1: row.get(9)?,
        bbox_x2: row.get(10)?,
        bbox_y2: row.get(11)?,
        area: row.get(12)?,
    })
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

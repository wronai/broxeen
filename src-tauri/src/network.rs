// src-tauri/src/network.rs
//
// Tauri commands for SQLite database access.
// Network scanning functions are implemented in network_scan.rs

use std::sync::Mutex;
use std::collections::HashMap;
use std::path::Path;

// ─── SQLite Commands ────────────────────────────────────────

// These commands provide SQLite access from the frontend.
// Uses rusqlite for actual database operations.

// Global connection pool (lazy-initialized)
lazy_static::lazy_static! {
    static ref DB_CONNECTIONS: Mutex<HashMap<String, rusqlite::Connection>> =
        Mutex::new(HashMap::new());
}

#[tauri::command]
pub fn db_execute(db: String, sql: String, params: Vec<serde_json::Value>) -> Result<(), String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;
    let db_path = resolve_db_path(&db)?;

    if !conns.contains_key(&db_path) {
        conns.insert(db_path.clone(), open_database_connection(&db_path)?);
    }

    let conn = conns
        .get_mut(&db_path)
        .ok_or_else(|| format!("Database connection missing for {}", db_path))?;

    if params.is_empty() {
        conn.execute_batch(&sql).map_err(|e| e.to_string())?;
    } else {
        let sqlite_params: Vec<Box<dyn rusqlite::types::ToSql>> = params
            .iter()
            .map(|v| json_to_sqlite_param(v))
            .collect();

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            sqlite_params.iter().map(|p| p.as_ref()).collect();

        conn.execute(&sql, param_refs.as_slice())
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn db_query(
    db: String,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<HashMap<String, serde_json::Value>>, String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;
    let db_path = resolve_db_path(&db)?;

    if !conns.contains_key(&db_path) {
        conns.insert(db_path.clone(), open_database_connection(&db_path)?);
    }

    let conn = conns
        .get_mut(&db_path)
        .ok_or_else(|| format!("Database connection missing for {}", db_path))?;

    let sqlite_params: Vec<Box<dyn rusqlite::types::ToSql>> = params
        .iter()
        .map(|v| json_to_sqlite_param(v))
        .collect();

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        sqlite_params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let column_names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let mut map = HashMap::new();
            for (i, name) in column_names.iter().enumerate() {
                let value: rusqlite::types::Value = row.get(i)?;
                map.insert(name.clone(), sqlite_to_json(value));
            }
            Ok(map)
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }

    Ok(results)
}

#[tauri::command]
pub fn db_close(db: String) -> Result<(), String> {
    let mut conns = DB_CONNECTIONS.lock().map_err(|e| e.to_string())?;
    let db_path = resolve_db_path(&db)?;
    conns.remove(&db_path);
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────

fn resolve_db_path(db: &str) -> Result<String, String> {
    if db == ":memory:" {
        return Ok(db.to_string());
    }

    let path = Path::new(db);

    // Keep absolute paths and explicit relative subpaths as-is.
    // Only normalize bare filenames (e.g. "broxeen_devices.db").
    if path.is_absolute() || path.parent().is_some_and(|p| p != Path::new("")) {
        return Ok(db.to_string());
    }

    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "Cannot resolve local data directory".to_string())?;
    let app_dir = base.join("broxeen");
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    Ok(app_dir.join(path).to_string_lossy().into_owned())
}

fn open_database_connection(db_path: &str) -> Result<rusqlite::Connection, String> {
    let c = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(c)
}

fn json_to_sqlite_param(value: &serde_json::Value) -> Box<dyn rusqlite::types::ToSql> {
    match value {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(rusqlite::types::Null)
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        _ => Box::new(value.to_string()),
    }
}

fn sqlite_to_json(value: rusqlite::types::Value) -> serde_json::Value {
    match value {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(i) => serde_json::json!(i),
        rusqlite::types::Value::Real(f) => serde_json::json!(f),
        rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b) => {
            use base64::Engine as _;
            serde_json::Value::String(
                base64::engine::general_purpose::STANDARD.encode(&b),
            )
        }
    }
}

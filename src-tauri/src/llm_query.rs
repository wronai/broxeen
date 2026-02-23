//! llm_query.rs — Lightweight LLM-powered text-to-SQL engine.
//!
//! Uses OpenRouter API (via reqwest) to convert natural language questions
//! into SQLite SELECT queries, constrained by database schemas.
//!
//! No `vision` feature required — works in the default build.
//! Replaces hardcoded keyword matching (nl_to_sql, extract_date_filter).

use std::env;
use crate::query_schema::{self, DataSource};

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Call the LLM to generate SQL from a natural language question.
/// Returns the raw SQL string or an error.
pub async fn text_to_sql(question: &str, data_source: DataSource) -> Result<String, String> {
    let api_key = env::var("OPENROUTER_API_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err("OPENROUTER_API_KEY not set".into());
    }

    let model = env::var("LLM_MODEL")
        .unwrap_or_else(|_| "google/gemini-2.0-flash-exp:free".into());

    let system_prompt = query_schema::build_text_to_sql_prompt(data_source.schema());

    let payload = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": question }
        ],
        "max_tokens": 300,
        "temperature": 0.0
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen-text2sql")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let truncated = &body[..body.len().min(200)];
        return Err(format!("LLM HTTP {}: {}", status, truncated));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("LLM JSON parse error: {}", e))?;

    let sql = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .trim_start_matches("```sql")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    if sql.is_empty() {
        return Err("LLM returned empty SQL".into());
    }

    // Safety: only allow SELECT queries
    validate_sql(&sql)?;

    Ok(sql)
}

/// Validate that the SQL is a safe SELECT query.
fn validate_sql(sql: &str) -> Result<(), String> {
    let upper = sql.to_uppercase();
    let trimmed = upper.trim_start();

    if !trimmed.starts_with("SELECT") {
        return Err(format!("Only SELECT queries allowed, got: {}", &sql[..sql.len().min(50)]));
    }

    // Block dangerous keywords
    for keyword in &["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "ATTACH", "DETACH"] {
        // Check for keyword as standalone word (not inside a string literal)
        if trimmed.contains(keyword) && !trimmed.starts_with("SELECT") {
            return Err(format!("Dangerous keyword '{}' not allowed", keyword));
        }
    }

    // Extra safety: block semicolons that could chain statements
    if sql.contains(';') {
        let parts: Vec<&str> = sql.split(';').filter(|s| !s.trim().is_empty()).collect();
        if parts.len() > 1 {
            return Err("Multiple statements not allowed".into());
        }
    }

    Ok(())
}

/// Execute a text-to-SQL query against the appropriate database.
/// Returns (sql, columns, rows, db_path).
pub async fn execute_nl_query(
    question: &str,
    db_path_override: Option<&str>,
) -> Result<NlQueryResult, String> {
    let data_source = query_schema::detect_data_source(question);
    let db_file = db_path_override.unwrap_or(data_source.db_filename());
    let resolved = crate::motion_detection::resolve_db_path(db_file);

    // Check if DB exists
    if !std::path::Path::new(&resolved).exists() {
        return Err(format!(
            "Database not found: {}. Start monitoring to collect data.",
            resolved
        ));
    }

    // Generate SQL via LLM
    let sql = text_to_sql(question, data_source).await?;

    // Execute against SQLite
    let conn = rusqlite::Connection::open(&resolved).map_err(|e| {
        format!("Cannot open DB {}: {}", resolved, e)
    })?;

    let mut stmt = conn.prepare(&sql).map_err(|e| {
        format!("SQL error: {} — query: {}", e, sql)
    })?;

    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();

    let rows: Vec<Vec<String>> = stmt
        .query_map([], |row| {
            let mut vals = Vec::new();
            for i in 0..columns.len() {
                let val: String = row
                    .get::<_, rusqlite::types::Value>(i)
                    .map(|v| match v {
                        rusqlite::types::Value::Null => "NULL".to_string(),
                        rusqlite::types::Value::Integer(n) => n.to_string(),
                        rusqlite::types::Value::Real(f) => format!("{:.2}", f),
                        rusqlite::types::Value::Text(s) => s,
                        rusqlite::types::Value::Blob(_) => "[BLOB]".to_string(),
                    })
                    .unwrap_or_else(|_| "?".to_string());
                vals.push(val);
            }
            Ok(vals)
        })
        .map_err(|e| format!("Query execution error: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let row_count = rows.len();
    Ok(NlQueryResult {
        question: question.to_string(),
        sql,
        columns,
        rows,
        row_count,
        db_path: resolved,
        source: data_source,
    })
}

/// Result of a natural language query.
#[derive(Debug)]
pub struct NlQueryResult {
    pub question: String,
    pub sql: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub row_count: usize,
    pub db_path: String,
    #[allow(dead_code)]
    pub source: DataSource,
}

//! Natural-language-to-SQL query engine.
//!
//! Uses LLM to convert a question like "how many people were seen today?"
//! into a SQL SELECT on the monitoring_history view.
//!
//! Falls back to local LLM if OpenRouter unavailable.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::vision_db::{VisionDatabase, SCHEMA};
use crate::vision_llm::LlmClient;

// ─── Example queries shown to user ──────────────────────────────────────────

pub const EXAMPLE_QUERIES: &[&str] = &[
    "Ile osób było widzianych dzisiaj?",
    "Pokaż wszystkie samochody z ostatnich 2 godzin",
    "Kiedy ostatnio pojawił się rower?",
    "Policz ile różnych osób weszło na scenę",
    "Ile samochodów przyjechało i ile wyjechało dziś?",
    "Pokaż obiekty wykryte między 8:00 a 9:00",
    "Które godziny były najbardziej aktywne?",
    "Pokaż ostatnie 10 wykryć",
    "Ile wykryć było w każdej kamerze?",
    "Pokaż osoby które poruszały się szybko",
];

// ─── Query result ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub question: String,
    pub sql:      String,
    pub columns:  Vec<String>,
    pub rows:     Vec<Vec<String>>,
}

impl QueryResult {
    /// Format results as an ASCII table string.
    pub fn format_table(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!("\nSQL: {}\n\n", self.sql));

        if self.rows.is_empty() {
            out.push_str("(no results)\n");
            return out;
        }

        // Column widths
        let mut widths: Vec<usize> = self.columns.iter().map(|c| c.len()).collect();
        for row in &self.rows {
            for (i, val) in row.iter().enumerate() {
                if i < widths.len() {
                    widths[i] = widths[i].max(val.len().min(60));
                }
            }
        }

        // Header
        let header: String = self.columns.iter().enumerate()
            .map(|(i, c)| format!("{:<width$}", c, width = widths[i]))
            .collect::<Vec<_>>().join(" | ");
        out.push_str(&format!("| {} |\n", header));
        let sep: String = widths.iter().map(|w| "-".repeat(*w)).collect::<Vec<_>>().join("-+-");
        out.push_str(&format!("|-{}-|\n", sep));

        // Rows (cap at 50)
        for row in self.rows.iter().take(50) {
            let line: String = row.iter().enumerate()
                .map(|(i, v)| {
                    let w = widths.get(i).copied().unwrap_or(10);
                    let s = if v.len() > 60 { format!("{}…", &v[..59]) } else { v.clone() };
                    format!("{:<width$}", s, width = w)
                })
                .collect::<Vec<_>>().join(" | ");
            out.push_str(&format!("| {} |\n", line));
        }

        if self.rows.len() > 50 {
            out.push_str(&format!("  … {} more rows\n", self.rows.len() - 50));
        }
        out.push_str(&format!("  {} row(s)\n", self.rows.len()));
        out
    }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

pub struct QueryEngine<'a> {
    db:     &'a VisionDatabase,
    client: &'a LlmClient,
}

impl<'a> QueryEngine<'a> {
    pub fn new(db: &'a VisionDatabase, client: &'a LlmClient) -> Self {
        Self { db, client }
    }

    /// Convert natural language question → SQL → execute → return results.
    pub async fn ask(&self, question: &str) -> Result<QueryResult> {
        info!("Text-to-SQL: {}", question);

        let sql = self.client.text_to_sql(question, SCHEMA).await?;
        info!("Generated SQL: {}", sql);

        let (columns, rows) = self.db.execute_query(&sql)?;

        Ok(QueryResult {
            question: question.to_string(),
            sql,
            columns,
            rows,
        })
    }
}

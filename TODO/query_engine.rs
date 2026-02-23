//! Natural-language-to-SQL query engine.
//!
//! Uses LLM to convert a question like "how many people were seen today?"
//! into a SQL SELECT on the monitoring_history view.
//!
//! Falls back to local LLM if OpenRouter unavailable.

use anyhow::Result;
use std::io::{self, Write};
use tracing::info;

use crate::database::{Database, SCHEMA};
use crate::llm::LlmClient;

// ─── Example queries shown to user on startup ────────────────────────────────

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

pub struct QueryResult {
    pub question:   String,
    pub sql:        String,
    pub columns:    Vec<String>,
    pub rows:       Vec<Vec<String>>,
}

impl QueryResult {
    pub fn print_table(&self) {
        println!();
        println!("SQL: {}", self.sql);
        println!();

        if self.rows.is_empty() {
            println!("(no results)");
            return;
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
            .collect::<Vec<_>>().join(" │ ");
        println!("┌─{}─┐", "─".repeat(header.len()));
        println!("│ {} │", header);
        println!("├─{}─┤", "─".repeat(header.len()));

        // Rows (cap at 50)
        for row in self.rows.iter().take(50) {
            let line: String = row.iter().enumerate()
                .map(|(i, v)| {
                    let w = widths.get(i).copied().unwrap_or(10);
                    let s = if v.len() > 60 { format!("{}…", &v[..59]) } else { v.clone() };
                    format!("{:<width$}", s, width = w)
                })
                .collect::<Vec<_>>().join(" │ ");
            println!("│ {} │", line);
        }
        println!("└─{}─┘", "─".repeat(header.len()));

        if self.rows.len() > 50 {
            println!("  … {} more rows", self.rows.len() - 50);
        }
        println!("  {} row(s)", self.rows.len());
    }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

pub struct QueryEngine {
    db:     Database,
    client: LlmClient,
}

impl QueryEngine {
    pub fn new(db: Database, client: LlmClient) -> Self {
        Self { db, client }
    }

    /// Convert natural language question → SQL → execute → display.
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

    /// Interactive REPL loop — ask questions until "exit".
    pub async fn repl(&self) {
        println!();
        println!("╔════════════════════════════════════════════════════╗");
        println!("║   Broxeen Vision — Monitoring Query Interface      ║");
        println!("╠════════════════════════════════════════════════════╣");
        println!("║  Zadaj pytanie po polsku lub angielsku.            ║");
        println!("║  Wpisz 'exit' lub Ctrl+C aby wyjść.               ║");
        println!("╠════════════════════════════════════════════════════╣");
        println!("  Przykłady:");
        for q in EXAMPLE_QUERIES {
            println!("    • {}", q);
        }
        println!("╚════════════════════════════════════════════════════╝");
        println!();

        loop {
            print!("❯ ");
            io::stdout().flush().ok();

            let mut input = String::new();
            if io::stdin().read_line(&mut input).is_err() { break; }
            let question = input.trim();

            if question.is_empty() { continue; }
            if question.eq_ignore_ascii_case("exit")
                || question.eq_ignore_ascii_case("quit")
                || question == "q" { break; }

            match self.ask(question).await {
                Ok(result) => result.print_table(),
                Err(e)     => println!("Error: {}", e),
            }
            println!();
        }
    }
}

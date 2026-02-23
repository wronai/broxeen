mod capture;
mod config;
mod database;
mod detector;
mod llm;
mod motion;
mod movement;
mod pipeline;
mod query_engine;
mod scene_buffer;
mod stats_cli;
mod tracker;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "broxeen-vision", version = "0.3.0")]
#[command(about = "YOLOv8 camera monitoring — local-first + OpenRouter LLM scene narrative")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start monitoring pipeline
    Run {
        #[arg(long)] url:       Option<String>,
        #[arg(long)] camera_id: Option<String>,
    },

    /// Interactive natural-language query (text-to-SQL)
    Query,

    /// Ask a single question (non-interactive)
    Ask {
        question: String,
    },

    /// Show recent LLM scene narratives
    Narratives {
        #[arg(short, long)] camera: Option<String>,
        #[arg(short, long, default_value = "5")] limit: u32,
    },

    /// Show recent local detections
    Recent {
        #[arg(short, long)] camera: Option<String>,
        #[arg(short, long, default_value = "20")] limit: u32,
        #[arg(long)] json: bool,
    },

    /// Detection statistics
    Stats(stats_cli::StatsArgs),

    /// Export thumbnail for a detection
    Thumbnail {
        id: i64,
        #[arg(short, long)] output: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("broxeen_vision=info,warn")),
        )
        .compact()
        .init();

    let cli = Cli::parse();
    let mut cfg = config::load_config().unwrap_or_else(|e| {
        tracing::warn!("Config load failed ({}), using defaults", e);
        config::default_config()
    });

    match cli.command {
        Command::Run { url, camera_id } => {
            if let Some(u)  = url       { cfg.camera.url       = u; }
            if let Some(id) = camera_id { cfg.camera.camera_id = id; }
            if cfg.camera.url.is_empty() {
                anyhow::bail!("No camera URL. Use --url or BROXEEN__CAMERA__URL");
            }
            print_startup_info(&cfg);
            pipeline::Pipeline::new(cfg).run().await?;
        }

        Command::Query => {
            let db     = database::Database::open(&cfg.database.path)?;
            let client = llm::LlmClient::from_config(&cfg.llm);
            let engine = query_engine::QueryEngine::new(db, client);
            engine.repl().await;
        }

        Command::Ask { question } => {
            let db     = database::Database::open(&cfg.database.path)?;
            let client = llm::LlmClient::from_config(&cfg.llm);
            let engine = query_engine::QueryEngine::new(db, client);
            let result = engine.ask(&question).await?;
            result.print_table();
        }

        Command::Narratives { camera, limit } => {
            let db = database::Database::open(&cfg.database.path)?;
            let events = db.get_recent_llm_events(camera.as_deref(), limit)?;
            if events.is_empty() {
                println!("No LLM events found.");
            } else {
                for e in events {
                    println!("┌─────────────────────────────────────────────");
                    println!("│ {} → {} │ cam={} │ crops={} │ by={}",
                        e.period_start.format("%H:%M:%S"),
                        e.period_end.format("%H:%M:%S"),
                        e.camera_id, e.crops_sent, e.provider);
                    println!("├─────────────────────────────────────────────");
                    println!("{}", e.narrative);
                    println!();
                }
            }
        }

        Command::Recent { camera, limit, json } => {
            let conn = rusqlite::Connection::open(&cfg.database.path)?;
            let cam_f = camera.map(|c| format!(" AND camera_id='{}'", c)).unwrap_or_default();
            let sql = format!(
                "SELECT id,timestamp,camera_id,label,confidence,movement,duration_s,direction,speed_label
                 FROM detections WHERE 1=1{} ORDER BY timestamp DESC LIMIT {}",
                cam_f, limit
            );
            let mut stmt = conn.prepare(&sql)?;

            if json {
                let rows: Vec<_> = stmt.query_map([], |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_,i64>(0)?,
                        "ts": r.get::<_,String>(1)?,
                        "cam": r.get::<_,String>(2)?,
                        "label": r.get::<_,String>(3)?,
                        "conf": r.get::<_,f64>(4)?,
                        "movement": r.get::<_,Option<String>>(5)?,
                        "dur_s": r.get::<_,f64>(6)?,
                    }))
                })?.filter_map(|r| r.ok()).collect();
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                println!("{:<5} {:<20} {:<10} {:<12} {:>5} {:>5} {:<10} {}", "ID","Time","Camera","Label","Conf","Dur.s","Direction","Movement");
                println!("{}", "─".repeat(100));
                stmt.query_map([], |r| {
                    Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?, r.get::<_,String>(2)?,
                        r.get::<_,String>(3)?, r.get::<_,f64>(4)?,
                        r.get::<_,Option<String>>(5)?, r.get::<_,f64>(6)?,
                        r.get::<_,Option<String>>(7)?, r.get::<_,Option<String>>(8)?))
                })?.filter_map(|r| r.ok()).for_each(|(id,ts,cam,lbl,conf,mv,dur,dir,spd)| {
                    println!("{:<5} {:<20} {:<10} {:<12} {:>4.0}% {:>5.1}  {:<10} {}",
                        id, &ts[..19], cam, lbl, conf*100.0, dur,
                        dir.as_deref().unwrap_or(""),
                        mv.as_deref().unwrap_or(""));
                });
            }
        }

        Command::Stats(args) => {
            let db = database::Database::open(&cfg.database.path)?;
            stats_cli::print_stats(&db, &args)?;
        }

        Command::Thumbnail { id, output } => {
            let db   = database::Database::open(&cfg.database.path)?;
            let bytes = db.get_thumbnail(id)?;
            let path = output.unwrap_or_else(|| format!("thumbnail_{}.jpg", id));
            std::fs::write(&path, &bytes)?;
            println!("Saved {} bytes → {}", bytes.len(), path);
        }
    }
    Ok(())
}

fn print_startup_info(cfg: &config::AppConfig) {
    let primary = cfg.llm.openrouter_api_key.as_ref()
        .filter(|k| !k.is_empty())
        .map(|_| format!("OpenRouter/{}", cfg.llm.openrouter_model))
        .unwrap_or("none".into());
    let fallback = cfg.llm.local_base_url.as_ref()
        .filter(|u| !u.is_empty())
        .map(|u| format!("Local {} ({})", cfg.llm.local_model, u))
        .unwrap_or("none".into());

    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║            BROXEEN VISION v0.3                          ║");
    println!("╠══════════════════════════════════════════════════════════╣");
    println!("  Camera:    {} → {}", cfg.camera.camera_id, cfg.camera.url);
    println!("  Model:     {} (OpenVINO={})", cfg.detector.model_path, cfg.detector.use_openvino);
    println!("  Database:  {}", cfg.database.path);
    println!("  LLM:       {} (primary)", primary);
    println!("  Fallback:  {} (local)", fallback);
    println!("  LLM flush: every {}s, min {} crops", cfg.scene.flush_interval_secs, cfg.scene.min_crops_for_llm);
    println!("╚══════════════════════════════════════════════════════════╝");
}

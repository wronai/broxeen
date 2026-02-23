mod capture;
mod config;
mod database;
mod detector;
mod llm;
mod motion;
mod pipeline;
mod stats_cli;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Parser)]
#[command(name = "broxeen-vision")]
#[command(about = "AI Camera Monitoring — RPi5 / N5105 Edge Pipeline")]
#[command(version = "0.1.0")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start the monitoring pipeline
    Run {
        /// Override camera RTSP URL
        #[arg(long)]
        url: Option<String>,

        /// Override camera ID
        #[arg(long)]
        camera_id: Option<String>,
    },

    /// Query detection statistics
    Stats(stats_cli::StatsArgs),

    /// Show recent detections
    Recent {
        /// Camera ID filter
        #[arg(short, long)]
        camera: Option<String>,

        /// Number of records to show (default: 20)
        #[arg(short, long, default_value = "20")]
        limit: u32,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Export thumbnail for a detection ID to a JPEG file
    Thumbnail {
        /// Detection ID
        id: i64,

        /// Output path (default: thumbnail_<id>.jpg)
        #[arg(short, long)]
        output: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Logging: RUST_LOG=broxeen_vision=info,warn
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("broxeen_vision=info,warn")),
        )
        .compact()
        .init();

    let cli = Cli::parse();
    let mut cfg = config::load_config()
        .unwrap_or_else(|e| {
            tracing::warn!("Config load failed ({}), using defaults", e);
            // Return a minimal default that requires --url / --camera-id at CLI
            config::AppConfig {
                camera: config::CameraConfig {
                    url: String::new(),
                    camera_id: "cam0".to_string(),
                    fps: None,
                },
                detector: config::DetectorConfig::default(),
                pipeline: config::PipelineConfig::default(),
                database: config::DatabaseConfig::default(),
                llm: config::LlmConfig::default(),
            }
        });

    match cli.command {
        Command::Run { url, camera_id } => {
            if let Some(u) = url        { cfg.camera.url       = u; }
            if let Some(id) = camera_id { cfg.camera.camera_id = id; }

            if cfg.camera.url.is_empty() {
                anyhow::bail!(
                    "No camera URL configured. \
                     Use --url or set BROXEEN__CAMERA__URL or create broxeen.toml"
                );
            }

            tracing::info!(
                "Starting pipeline  camera={}  model={}  db={}",
                cfg.camera.camera_id,
                cfg.detector.model_path,
                cfg.database.path,
            );

            pipeline::Pipeline::new(cfg).run().await?;
        }

        Command::Stats(args) => {
            let db = database::Database::open(&cfg.database.path)?;
            stats_cli::print_stats(&db, &args)?;
        }

        Command::Recent { camera, limit, json } => {
            let db = database::Database::open(&cfg.database.path)?;
            let records = db.get_recent(camera.as_deref(), limit)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&records)?);
            } else {
                println!("{:<6} {:<22} {:<10} {:<12} {:.0}", "ID", "Timestamp", "Camera", "Label", "Conf%");
                println!("{}", "─".repeat(65));
                for r in records {
                    println!(
                        "{:<6} {:<22} {:<10} {:<12} {:.0}%  {}",
                        r.id,
                        r.timestamp.format("%Y-%m-%d %H:%M:%S"),
                        r.camera_id,
                        r.label,
                        r.confidence * 100.0,
                        r.llm_label
                            .as_deref()
                            .map(|l| format!("[LLM: {}]", l))
                            .unwrap_or_default()
                    );
                }
            }
        }

        Command::Thumbnail { id, output } => {
            let db = database::Database::open(&cfg.database.path)?;
            let bytes = db.get_thumbnail(id)?;
            let path = output.unwrap_or_else(|| format!("thumbnail_{}.jpg", id));
            std::fs::write(&path, &bytes)?;
            println!("Saved thumbnail {} bytes → {}", bytes.len(), path);
        }
    }

    Ok(())
}

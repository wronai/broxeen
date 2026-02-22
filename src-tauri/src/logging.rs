use std::path::PathBuf;
use std::sync::{Once, OnceLock};

use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::time::UtcTime;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Structured backend logging utilities backed by `tracing`.
///
/// Initializes a global subscriber once and exposes helper functions for
/// existing call-sites (`backend_info`, etc.) to keep changes localized.

static INIT_LOGGING: Once = Once::new();
static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

fn resolve_log_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("broxeen")
        .join("logs")
}

fn build_file_appender() -> Option<(RollingFileAppender, PathBuf)> {
    let log_dir = resolve_log_dir();
    if let Err(err) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "[backend][WARN] Failed to create log directory {}: {}",
            log_dir.display(),
            err
        );
        return None;
    }

    Some((RollingFileAppender::new(Rotation::DAILY, &log_dir, "backend.log"), log_dir))
}

pub fn init_logging() {
    INIT_LOGGING.call_once(|| {
        let (file_layer, log_dir_description) = if let Some((appender, dir)) = build_file_appender() {
            let (non_blocking, guard) = tracing_appender::non_blocking(appender);
            let layer = fmt::layer()
                .with_ansi(false)
                .with_target(true)
                .with_timer(UtcTime::rfc_3339())
                .with_writer(non_blocking);
            LOG_GUARD.set(guard).ok();
            (Some(layer), Some(dir))
        } else {
            (None, None)
        };

        let filter = EnvFilter::try_from_default_env()
            .or_else(|_| EnvFilter::try_new(std::env::var("BROXEEN_LOG_LEVEL").unwrap_or_else(|_| "info".into())))
            .unwrap_or_else(|_| EnvFilter::new("info"));

        let stdout_layer = fmt::layer()
            .with_target(true)
            .with_ansi(true)
            .with_timer(UtcTime::rfc_3339());

        let registry = tracing_subscriber::registry().with(filter).with(stdout_layer);
        if let Some(file_layer) = file_layer {
            registry.with(file_layer).init();
        } else {
            registry.init();
        }

        if let Some(dir) = log_dir_description {
            let dir_str = dir.display().to_string();
            backend_info(format!(
                "Structured logging initialized. Backend logs will be rotated daily under {}",
                dir_str
            ));
        } else {
            backend_warn("Structured logging initialized without file sink (using stdout only)");
        }
    });
}

pub fn backend_info(message: impl AsRef<str>) {
    info!(target: "backend", "{}", message.as_ref());
}

pub fn backend_warn(message: impl AsRef<str>) {
    warn!(target: "backend", "{}", message.as_ref());
}

pub fn backend_error(message: impl AsRef<str>) {
    error!(target: "backend", "{}", message.as_ref());
}

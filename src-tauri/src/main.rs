#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_capture;
mod audio_commands;
mod browse_rendered;
mod content_cleaning;
mod content_extraction;
mod disk_info;
mod llm;
mod logging;
mod network;
mod network_info;
mod network_scan;
mod settings;
mod ssh;
mod stt;
mod tts;
mod tts_backend;

use audio_capture::SharedRecordingState;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use crate::logging::{backend_info, backend_warn, backend_error, init_logging};
use crate::content_cleaning::{
    strip_cookie_banner_text, truncate_to_chars, normalize_whitespace,
    MIN_READABLE_CONTENT_LENGTH, MAX_BACKEND_CONTENT_CHARS,
};
use crate::content_extraction::{
    extract_search_results, extract_with_scraper,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioSettings {
    #[serde(default = "default_tts_enabled")]
    pub tts_enabled: bool,
    #[serde(default = "default_tts_rate")]
    pub tts_rate: f32,
    #[serde(default = "default_tts_pitch")]
    pub tts_pitch: f32,
    #[serde(default = "default_tts_volume")]
    pub tts_volume: f32,
    #[serde(default = "String::new")]
    pub tts_voice: String,
    #[serde(default = "default_tts_lang")]
    pub tts_lang: String,
    #[serde(default = "default_tts_engine")]
    pub tts_engine: String,
    #[serde(default = "default_stt_enabled")]
    pub stt_enabled: bool,
    #[serde(default = "default_stt_engine")]
    pub stt_engine: String,
    #[serde(default = "default_stt_model")]
    pub stt_model: String,
    #[serde(default = "default_mic_enabled")]
    pub mic_enabled: bool,
    #[serde(default = "default_device_id")]
    pub mic_device_id: String,
    #[serde(default = "default_device_id")]
    pub speaker_device_id: String,
    #[serde(default = "default_auto_listen")]
    pub auto_listen: bool,
}

fn default_tts_enabled() -> bool {
    true
}

fn default_tts_rate() -> f32 {
    1.0
}

fn default_tts_pitch() -> f32 {
    1.0
}

fn default_tts_volume() -> f32 {
    1.0
}

fn default_tts_lang() -> String {
    "pl-PL".to_string()
}

fn default_tts_engine() -> String {
    "auto".to_string()
}

fn default_stt_enabled() -> bool {
    true
}

fn default_stt_engine() -> String {
    "openrouter".to_string()
}

fn default_stt_model() -> String {
    "whisper-1".to_string()
}

fn default_mic_enabled() -> bool {
    true
}

fn default_device_id() -> String {
    "default".to_string()
}

fn default_auto_listen() -> bool {
    false
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            tts_enabled: true,
            tts_rate: 1.0,
            tts_pitch: 1.0,
            tts_volume: 1.0,
            tts_voice: String::new(),
            tts_lang: "pl-PL".to_string(),
            tts_engine: "auto".to_string(),
            stt_enabled: true,
            stt_engine: "openrouter".to_string(),
            stt_model: "whisper-1".to_string(),
            mic_enabled: true,
            mic_device_id: "default".to_string(),
            speaker_device_id: "default".to_string(),
            auto_listen: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BrowseResult {
    pub url: String,
    pub title: String,
    pub content: String,
    pub resolve_type: String,
    pub suggestions: Vec<String>,
    pub screenshot_base64: Option<String>,
    pub rss_url: Option<String>,
    pub contact_url: Option<String>,
    pub phone_url: Option<String>,
}


#[tauri::command]
async fn get_app_version() -> Result<String, String> {
    backend_info("Command get_app_version invoked");
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
async fn browse(url: String) -> Result<BrowseResult, String> {
    backend_info(format!("Command browse invoked for URL: {}", url));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Broxeen/1.0")
        .build()
        .map_err(|e| {
            backend_error(format!("Failed to build HTTP client for {}: {}", url, e));
            e.to_string()
        })?;

    let response = client.get(&url).send().await.map_err(|e| {
        backend_error(format!("HTTP request failed for {}: {}", url, e));
        e.to_string()
    })?;
    let status = response.status();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    backend_info(format!(
        "HTTP response received for {}: {} (final_url={}, content_type={})",
        url, status, final_url, content_type
    ));

    if !status.is_success() {
        let message = format!(
            "HTTP {} while fetching {} (requested: {})",
            status, final_url, url
        );
        backend_warn(message.as_str());
        return Err(message);
    }

    let html = response.text().await.map_err(|e| {
        backend_error(format!("Failed to decode response body for {}: {}", url, e));
        e.to_string()
    })?;
    backend_info(format!("Fetched {} bytes for {}", html.len(), url));

    // ── Search results detection ─────────────────────
    if let Some(search_content) = extract_search_results(&html, &url) {
        backend_info("Detected DuckDuckGo search results page, extracting results directly");
        let search_title = format!("Wyniki wyszukiwania: {}", 
            url::Url::parse(&url)
                .ok()
                .and_then(|u| u.query_pairs().find(|(k, _)| k == "q").map(|(_, v)| v.to_string()))
                .unwrap_or_else(|| url.clone())
        );
        let final_content = truncate_to_chars(&search_content, MAX_BACKEND_CONTENT_CHARS);
        return Ok(BrowseResult {
            url: final_url,
            title: search_title,
            content: final_content,
            resolve_type: "search".to_string(),
            suggestions: vec![],
            screenshot_base64: None,
            rss_url: None,
            contact_url: None,
            phone_url: None,
        });
    }

    let parsed_url = match url::Url::parse(&url) {
        Ok(parsed) => parsed,
        Err(err) => {
            backend_warn(format!(
                "Failed to parse requested URL {} for readability context: {}. Using final URL {}.",
                url, err, final_url
            ));
            url::Url::parse(&final_url)
                .unwrap_or_else(|_| url::Url::parse("https://example.com").unwrap())
        }
    };
    let mut cursor = std::io::Cursor::new(html.clone());

    // Extract action links (RSS, Contact, Phone) from the raw HTML
    let action_links = {
        let document = scraper::Html::parse_document(&html);
        crate::content_extraction::extract_action_links(&document)
    };

    // Try capturing a screenshot if available
    let screenshot_base64 = if browse_rendered::is_available() {
        match browse_rendered::capture_screenshot(&url, 10) {
            Ok(b64) => Some(b64),
            Err(e) => {
                backend_warn(format!("Screenshot capture failed: {}", e));
                None
            }
        }
    } else {
        None
    };

    // ── Tier 1: reqwest + readability/scraper ─────────
    let (title, content) = match readability::extractor::extract(&mut cursor, &parsed_url) {
        Ok(product) => {
            let readable_title = normalize_whitespace(&product.title);
            let readable_content = normalize_whitespace(&product.text);

            if readable_content.len() >= MIN_READABLE_CONTENT_LENGTH {
                backend_info("Tier 1: Readability extraction successful");
                (
                    if readable_title.is_empty() {
                        url.clone()
                    } else {
                        readable_title
                    },
                    readable_content,
                )
            } else {
                backend_warn(format!(
                    "Readability returned short content ({} chars). Falling back to scraper.",
                    readable_content.len()
                ));
                extract_with_scraper(&html, &final_url)
            }
        }
        Err(e) => {
            backend_warn(format!(
                "Readability extraction failed: {}. Falling back to scraper.",
                e
            ));
            extract_with_scraper(&html, &final_url)
        }
    };

    let mut final_title = if title.trim().is_empty() {
        final_url.clone()
    } else {
        title
    };

    let cookie_stripped = strip_cookie_banner_text(&content);
    let mut final_content = truncate_to_chars(&cookie_stripped, MAX_BACKEND_CONTENT_CHARS);
    let mut resolve_type = "exact".to_string();

    // ── Tier 2: Chrome headless --dump-dom ────────────
    if final_content.len() < MIN_READABLE_CONTENT_LENGTH && browse_rendered::is_available() {
        backend_info(format!(
            "Tier 1 content too short ({} chars). Trying headless Chrome rendering...",
            final_content.len()
        ));

        match browse_rendered::render_and_extract(&url, 8) {
            Ok((rendered_title, rendered_content)) => {
                if rendered_content.len() > final_content.len() {
                    backend_info(format!(
                        "Tier 2: Chrome rendering improved content ({} → {} chars)",
                        final_content.len(),
                        rendered_content.len()
                    ));
                    if !rendered_title.is_empty() {
                        final_title = rendered_title;
                    }
                    final_content = truncate_to_chars(&rendered_content, MAX_BACKEND_CONTENT_CHARS);
                    resolve_type = "rendered".to_string();
                } else {
                    backend_warn("Tier 2: Chrome rendering didn't improve content");
                }
            }
            Err(e) => {
                backend_warn(format!("Tier 2: Chrome rendering failed: {}", e));
            }
        }
    }

    // ── Tier 3: Chrome screenshot + Vision LLM ───────
    if final_content.len() < MIN_READABLE_CONTENT_LENGTH && browse_rendered::is_available() {
        backend_info(format!(
            "Tier 2 content still too short ({} chars). Trying screenshot + Vision LLM...",
            final_content.len()
        ));

        let api_key = std::env::var("OPENROUTER_API_KEY").unwrap_or_default();
        if !api_key.is_empty() {
            match browse_rendered::screenshot_and_describe(&url, &api_key, 10).await {
                Ok((vision_title, vision_content)) => {
                    if vision_content.len() > final_content.len() {
                        backend_info(format!(
                            "Tier 3: Vision LLM improved content ({} → {} chars)",
                            final_content.len(),
                            vision_content.len()
                        ));
                        if final_title == final_url {
                            final_title = vision_title;
                        }
                        final_content = truncate_to_chars(&vision_content, MAX_BACKEND_CONTENT_CHARS);
                        resolve_type = "vision".to_string();
                    }
                }
                Err(e) => {
                    backend_warn(format!("Tier 3: Vision LLM failed: {}", e));
                }
            }
        } else {
            backend_warn("Tier 3: Skipped — OPENROUTER_API_KEY not set");
        }
    }

    backend_info(format!(
        "Content extracted for {} (title_len={}, content_len={}, method={})",
        final_url,
        final_title.len(),
        final_content.len(),
        resolve_type
    ));

    Ok(BrowseResult {
        url: final_url,
        title: final_title,
        content: final_content,
        resolve_type,
        suggestions: vec![],
        screenshot_base64,
        rss_url: action_links.rss_url,
        contact_url: action_links.contact_url,
        phone_url: action_links.phone_url,
    })
}



fn main() {
    init_logging();
    backend_info("Booting Broxeen Tauri backend...");

    let tts_engine = tts_backend::detect_tts_engine();
    backend_info(format!("Detected native backend TTS engine: {:?}", tts_engine));

    if let Some(instructions) = tts_backend::piper_setup_instructions() {
        backend_warn("Piper TTS not found. Falling back to espeak-ng/espeak when available.");
        backend_info(format!("Piper setup hint:\n{}", instructions));
    }

    backend_info(
        "Registering command handlers: get_app_version, get_settings, save_settings, browse, llm_chat, stt_transcribe, stt_start, stt_stop, stt_status, backend_tts_speak, backend_tts_speak_base64, backend_tts_info, backend_audio_devices, tts_is_available, tts_speak, tts_stop, ping_host, scan_ports, arp_scan, discover_onvif_cameras, discover_mdns, scan_network, get_disk_info, get_disk_usage, ssh_execute, ssh_test_connection, ssh_list_known_hosts",
    );

    let recording_state: SharedRecordingState = Arc::new(Mutex::new(audio_capture::RecordingState::new()));
    let active_stream = audio_commands::ActiveStream(Arc::new(Mutex::new(None)));
    let active_tts = audio_commands::ActiveTts(Arc::new(Mutex::new(None)));

    if let Err(err) = tauri::Builder::default()
        .manage(recording_state)
        .manage(active_stream)
        .manage(active_tts)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            settings::get_settings,
            settings::save_settings,
            browse,
            llm::llm_chat,
            stt::stt_transcribe,
            audio_commands::stt_start,
            audio_commands::stt_stop,
            audio_commands::stt_status,
            audio_commands::backend_tts_speak,
            audio_commands::backend_tts_stop,
            audio_commands::backend_tts_pause,
            audio_commands::backend_tts_resume,
            audio_commands::backend_tts_speak_base64,
            audio_commands::backend_tts_info,
            audio_commands::backend_audio_devices,
            audio_commands::piper_install,
            audio_commands::piper_is_installed,
            tts::tts_is_available,
            tts::tts_speak,
            tts::tts_stop,
            network_scan::ping_host,
            network_scan::scan_ports,
            network_scan::arp_scan,
            network_scan::discover_onvif_cameras,
            network_scan::discover_mdns,
            network_scan::scan_network,
            network_info::get_local_network_info,
            network_info::list_network_interfaces,
            disk_info::get_disk_info,
            disk_info::get_disk_usage,
            ssh::ssh_execute,
            ssh::ssh_test_connection,
            ssh::ssh_list_known_hosts,
            network::rtsp_capture_frame,
            network::http_fetch_base64,
        ])
        .run(tauri::generate_context!())
    {
        backend_error(format!("Error while running Broxeen: {}", err));
        panic!("error while running broxeen");
    }

    backend_info("Broxeen backend stopped gracefully");
}

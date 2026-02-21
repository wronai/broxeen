#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod llm;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioSettings {
    pub tts_enabled: bool,
    pub tts_rate: f32,
    pub tts_pitch: f32,
    pub tts_volume: f32,
    pub tts_voice: String,
    pub tts_lang: String,
    pub mic_enabled: bool,
    pub mic_device_id: String,
    pub speaker_device_id: String,
    pub auto_listen: bool,
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
}

const MIN_READABLE_CONTENT_LENGTH: usize = 120;
const MAX_BACKEND_CONTENT_CHARS: usize = 20_000;

fn backend_info(message: impl AsRef<str>) {
    println!("[backend][INFO] {}", message.as_ref());
}

fn backend_warn(message: impl AsRef<str>) {
    println!("[backend][WARN] {}", message.as_ref());
}

fn backend_error(message: impl AsRef<str>) {
    eprintln!("[backend][ERROR] {}", message.as_ref());
}

fn truncate_to_chars(text: &str, max_chars: usize) -> String {
    let mut iter = text.chars();
    let truncated: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        backend_warn(format!(
            "Extracted content exceeded {} chars and was truncated",
            max_chars
        ));
    }
    truncated
}

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("broxeen");
    if let Err(err) = fs::create_dir_all(&config_dir) {
        backend_warn(format!(
            "Failed to create config directory {}: {}",
            config_dir.display(),
            err
        ));
    }
    let path = config_dir.join("settings.json");
    backend_info(format!("Resolved settings path: {}", path.display()));
    path
}

#[tauri::command]
fn get_settings() -> AudioSettings {
    backend_info("Command get_settings invoked");
    let path = settings_path();

    if !path.exists() {
        backend_warn(format!(
            "Settings file not found at {}. Using defaults.",
            path.display()
        ));
        return AudioSettings::default();
    }

    let data = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) => {
            backend_error(format!(
                "Failed to read settings file {}: {}",
                path.display(),
                err
            ));
            return AudioSettings::default();
        }
    };

    match serde_json::from_str::<AudioSettings>(&data) {
        Ok(settings) => {
            backend_info("Settings loaded successfully from disk");
            settings
        }
        Err(err) => {
            backend_error(format!(
                "Failed to parse settings JSON from {}: {}",
                path.display(),
                err
            ));
            AudioSettings::default()
        }
    }
}

#[tauri::command]
fn save_settings(settings: AudioSettings) -> Result<(), String> {
    backend_info("Command save_settings invoked");
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| {
        backend_error(format!("Failed to serialize settings: {}", e));
        e.to_string()
    })?;
    fs::write(&path, json).map_err(|e| {
        backend_error(format!("Failed to write settings file {}: {}", path.display(), e));
        e.to_string()
    })?;
    backend_info(format!("Settings saved to {}", path.display()));
    Ok(())
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

    let (title, content) = match readability::extractor::extract(&mut cursor, &parsed_url) {
        Ok(product) => {
            let readable_title = normalize_whitespace(&product.title);
            let readable_content = normalize_whitespace(&product.text);

            if readable_content.len() >= MIN_READABLE_CONTENT_LENGTH {
                backend_info("Readability extraction successful");
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

    let final_title = if title.trim().is_empty() {
        final_url.clone()
    } else {
        title
    };
    let final_content = truncate_to_chars(&content, MAX_BACKEND_CONTENT_CHARS);

    backend_info(format!(
        "Content extracted for {} (title_len={}, content_len={})",
        final_url,
        final_title.len(),
        final_content.len()
    ));

    Ok(BrowseResult {
        url: final_url,
        title: final_title,
        content: final_content,
        resolve_type: "exact".to_string(),
        suggestions: vec![],
    })
}

fn extract_content(document: &scraper::Html) -> String {
    // Try to find article content first
    let selectors = [
        "article",
        "main",
        "[role=\"main\"]",
        ".content",
        "#content",
        ".article-body",
        ".post-content",
    ];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if let Some(element) = document.select(&selector).next() {
                let text = normalize_whitespace(&element.text().collect::<Vec<_>>().join(" "));
                if text.len() >= MIN_READABLE_CONTENT_LENGTH {
                    return text;
                }
            }
        }
    }

    // Fallback: collect all paragraph text
    if let Ok(p_selector) = scraper::Selector::parse("p") {
        let paragraphs: Vec<String> = document
            .select(&p_selector)
            .map(|el| normalize_whitespace(&el.text().collect::<Vec<_>>().join(" ")))
            .filter(|t| t.len() > 40)
            .collect();
        if !paragraphs.is_empty() {
            return paragraphs.join("\n\n");
        }
    }

    "Nie udało się wyodrębnić treści ze strony.".to_string()
}

fn extract_with_scraper(html: &str, url: &str) -> (String, String) {
    let document = scraper::Html::parse_document(html);

    let title_selector = scraper::Selector::parse("title").unwrap();
    let title = document
        .select(&title_selector)
        .next()
        .map(|el| normalize_whitespace(&el.text().collect::<Vec<_>>().join(" ")))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| url.to_string());

    let content = extract_content(&document);

    (title, content)
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn main() {
    backend_info("Booting Broxeen Tauri backend...");
    backend_info("Registering command handlers: get_settings, save_settings, browse, llm_chat");

    if let Err(err) = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            browse,
            llm::llm_chat,
        ])
        .run(tauri::generate_context!())
    {
        backend_error(format!("Error while running Broxeen: {}", err));
        panic!("error while running Broxeen");
    }

    backend_info("Broxeen backend stopped gracefully");
}

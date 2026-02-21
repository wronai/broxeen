#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

fn settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("broxeen");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("settings.json")
}

#[tauri::command]
fn get_settings() -> AudioSettings {
    let path = settings_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AudioSettings>(&data) {
                return settings;
            }
        }
    }
    AudioSettings::default()
}

#[tauri::command]
fn save_settings(settings: AudioSettings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn browse(url: String) -> Result<BrowseResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("Broxeen/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let html = response.text().await.map_err(|e| e.to_string())?;

    let document = scraper::Html::parse_document(&html);

    // Extract title
    let title_selector = scraper::Selector::parse("title").unwrap();
    let title = document
        .select(&title_selector)
        .next()
        .map(|el| el.inner_html())
        .unwrap_or_else(|| url.clone());

    // Extract main content - try article, main, then body
    let content = extract_content(&document);

    Ok(BrowseResult {
        url,
        title,
        content,
        resolve_type: "exact".to_string(),
        suggestions: vec![],
    })
}

fn extract_content(document: &scraper::Html) -> String {
    // Try to find article content first
    let selectors = ["article", "main", "[role=\"main\"]", ".content", "#content", "body"];

    for sel_str in &selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if let Some(element) = document.select(&selector).next() {
                let text = element
                    .text()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                if text.len() > 100 {
                    return text;
                }
            }
        }
    }

    // Fallback: collect all paragraph text
    if let Ok(p_selector) = scraper::Selector::parse("p") {
        let paragraphs: Vec<String> = document
            .select(&p_selector)
            .map(|el| el.text().collect::<Vec<_>>().join(" "))
            .filter(|t| t.len() > 20)
            .collect();
        if !paragraphs.is_empty() {
            return paragraphs.join("\n\n");
        }
    }

    "Nie udało się wyodrębnić treści ze strony.".to_string()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            browse,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Broxeen");
}

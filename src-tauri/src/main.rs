#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_capture;
mod audio_commands;
mod llm;
mod stt;
mod tts;
mod tts_backend;

use audio_capture::SharedRecordingState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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

fn strip_cookie_banner_text(text: &str) -> String {
    let raw = text.trim();
    if raw.is_empty() {
        return String::new();
    }

    let lower = raw.to_lowercase();
    let has_cookie_word = lower.contains("ciasteczk") || lower.contains("cookie") || lower.contains("cookies");
    if !has_cookie_word {
        return raw.to_string();
    }

    let mut score = 0;
    if lower.contains("polityk") || lower.contains("privacy policy") {
        score += 1;
    }
    if lower.contains("akcept") || lower.contains("zgadzam") || lower.contains("consent") {
        score += 1;
    }
    if lower.contains("przegl") || lower.contains("browser") {
        score += 1;
    }
    if lower.contains("użytkownik") || lower.contains("user") {
        score += 1;
    }
    if lower.contains("zapisywan") || lower.contains("stored") {
        score += 1;
    }
    if lower.contains("najlepsz") || lower.contains("best experience") {
        score += 1;
    }

    let looks_like_banner = score >= 2 || lower.contains("strona korzysta z plik");
    if !looks_like_banner {
        return raw.to_string();
    }

    // Try to strip common boilerplate segment while keeping real content.
    let mut stripped = raw.to_string();

    // Polish: "Strona korzysta ... akceptację tych mechanizmów."
    let stripped_lower = stripped.to_lowercase();
    if let Some(start) = stripped_lower.find("strona korzysta") {
        let end_candidates = [
            "akceptację tych mechanizm",
            "akceptacje tych mechanizm",
            "akceptacją tych mechanizm",
            "akceptacja tych mechanizm",
        ];

        let mut end: Option<usize> = None;
        for needle in end_candidates {
            if let Some(idx) = stripped_lower[start..].find(needle) {
                end = Some(start + idx + needle.len());
                break;
            }
        }

        if let Some(mut end_idx) = end {
            // Extend to next period if possible.
            if let Some(dot_rel) = stripped_lower[end_idx..].find('.') {
                end_idx = end_idx + dot_rel + 1;
            }

            stripped.replace_range(start..end_idx, " ");
        }
    }

    // English: "We use cookies ..."
    let stripped_lower = stripped.to_lowercase();
    if let Some(start) = stripped_lower.find("we use cookies") {
        let mut end_idx = stripped_lower.len();
        for needle in ["privacy policy", "accept", "consent"] {
            if let Some(idx) = stripped_lower[start..].find(needle) {
                end_idx = start + idx + needle.len();
                break;
            }
        }

        if end_idx < stripped_lower.len() {
            if let Some(dot_rel) = stripped_lower[end_idx..].find('.') {
                end_idx = end_idx + dot_rel + 1;
            }
        }

        stripped.replace_range(start..end_idx, " ");
    }

    let normalized = normalize_whitespace(&stripped);
    if normalized.len() >= MIN_READABLE_CONTENT_LENGTH {
        normalized
    } else {
        raw.to_string()
    }
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

    // Try to parse as current AudioSettings, if fails try legacy and migrate
    match serde_json::from_str::<AudioSettings>(&data) {
        Ok(settings) => {
            backend_info("Settings loaded successfully from disk");
            settings
        }
        Err(_) => {
            // Try legacy format (without new fields)
            #[derive(Deserialize)]
            struct LegacyAudioSettings {
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

            match serde_json::from_str::<LegacyAudioSettings>(&data) {
                Ok(legacy) => {
                    backend_info("Migrating legacy settings to new format");
                    let migrated = AudioSettings {
                        tts_enabled: legacy.tts_enabled,
                        tts_rate: legacy.tts_rate,
                        tts_pitch: legacy.tts_pitch,
                        tts_volume: legacy.tts_volume,
                        tts_voice: legacy.tts_voice,
                        tts_lang: legacy.tts_lang,
                        tts_engine: "auto".to_string(),
                        stt_enabled: true,
                        stt_engine: "openrouter".to_string(),
                        stt_model: "whisper-1".to_string(),
                        mic_enabled: legacy.mic_enabled,
                        mic_device_id: legacy.mic_device_id,
                        speaker_device_id: legacy.speaker_device_id,
                        auto_listen: legacy.auto_listen,
                    };
                    // Save migrated settings immediately
                    if let Err(e) = save_settings(migrated.clone()) {
                        backend_error(format!("Failed to save migrated settings: {}", e));
                    }
                    migrated
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

    let cookie_stripped = strip_cookie_banner_text(&content);
    if cookie_stripped.len() != content.len() {
        backend_info(format!(
            "Cookie banner-like content stripped (original_len={}, stripped_len={})",
            content.len(),
            cookie_stripped.len()
        ));
    }

    let final_content = truncate_to_chars(&cookie_stripped, MAX_BACKEND_CONTENT_CHARS);

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

    let tts_engine = tts_backend::detect_tts_engine();
    backend_info(format!("Detected native backend TTS engine: {:?}", tts_engine));

    if let Some(instructions) = tts_backend::piper_setup_instructions() {
        backend_warn("Piper TTS not found. Falling back to espeak-ng/espeak when available.");
        backend_info(format!("Piper setup hint:\n{}", instructions));
    }

    backend_info(
        "Registering command handlers: get_settings, save_settings, browse, llm_chat, stt_transcribe, stt_start, stt_stop, stt_status, backend_tts_speak, backend_tts_speak_base64, backend_tts_info, backend_audio_devices, tts_is_available, tts_speak, tts_stop",
    );

    let recording_state: SharedRecordingState = Arc::new(Mutex::new(audio_capture::RecordingState::new()));
    let active_stream = audio_commands::ActiveStream(Arc::new(Mutex::new(None)));

    if let Err(err) = tauri::Builder::default()
        .manage(recording_state)
        .manage(active_stream)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            browse,
            llm::llm_chat,
            stt::stt_transcribe,
            audio_commands::stt_start,
            audio_commands::stt_stop,
            audio_commands::stt_status,
            audio_commands::backend_tts_speak,
            audio_commands::backend_tts_speak_base64,
            audio_commands::backend_tts_info,
            audio_commands::backend_audio_devices,
            tts::tts_is_available,
            tts::tts_speak,
            tts::tts_stop,
        ])
        .run(tauri::generate_context!())
    {
        backend_error(format!("Error while running Broxeen: {}", err));
        panic!("error while running Broxeen");
    }

    backend_info("Broxeen backend stopped gracefully");
}

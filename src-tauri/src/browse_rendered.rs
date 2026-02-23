//! browse_rendered.rs — Headless Chrome rendering for JS-heavy websites.
//! Tier 2: Chrome `--dump-dom` (JS-rendered DOM → text extraction)
//! Tier 3: Chrome `--screenshot` → Vision LLM (image → text description)

use std::process::Command;
use std::env;

// ── Chrome Detection ─────────────────────────────────

const CHROME_CANDIDATES: &[&str] = &[
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
];

/// Find the first available Chrome/Chromium binary.
fn detect_chrome_binary() -> Option<String> {
    for candidate in CHROME_CANDIDATES {
        if Command::new(candidate)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Some(candidate.to_string());
        }
    }
    None
}

/// Check if headless Chrome is available.
pub fn is_available() -> bool {
    detect_chrome_binary().is_some()
}

// ── Tier 2: dump-dom ─────────────────────────────────

/// Render page with headless Chrome and extract text content from rendered DOM.
/// Returns (title, text_content).
pub fn render_and_extract(url: &str, timeout_secs: u64) -> Result<(String, String), String> {
    let chrome = detect_chrome_binary()
        .ok_or_else(|| "No Chrome/Chromium browser found for rendering".to_string())?;

    crate::backend_info(format!(
        "[browse:rendered] Rendering with {} --dump-dom: {}",
        chrome, url
    ));

    let output = Command::new(&chrome)
        .arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--disable-dev-shm-usage")
        .arg("--disable-extensions")
        .arg("--disable-background-networking")
        .arg(format!("--timeout={}", timeout_secs * 1000))
        .arg("--dump-dom")
        .arg(url)
        .output()
        .map_err(|e| format!("Chrome execution failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Chrome dump-dom failed: {stderr}"));
    }

    let html = String::from_utf8_lossy(&output.stdout).to_string();
    crate::backend_info(format!(
        "[browse:rendered] Got rendered DOM ({} bytes)",
        html.len()
    ));

    if html.is_empty() {
        return Err("Chrome returned empty DOM".into());
    }

    // Parse rendered HTML and extract text
    let document = scraper::Html::parse_document(&html);

    // Extract title
    let title = scraper::Selector::parse("title")
        .ok()
        .and_then(|sel| document.select(&sel).next())
        .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .unwrap_or_default();

    // Extract main body text, removing scripts/styles/nav
    let text = extract_visible_text(&document);

    crate::backend_info(format!(
        "[browse:rendered] Extracted: title_len={}, text_len={}",
        title.len(),
        text.len()
    ));

    Ok((title, text))
}

/// Extract visible text from parsed HTML, skipping scripts, styles, nav, footer, etc.
fn extract_visible_text(document: &scraper::Html) -> String {
    // Junk elements to subtract from any matched container
    let junk_sel = scraper::Selector::parse(
        "script, style, noscript, nav, footer, header, aside, form, button, select, input, \
         [role=\"navigation\"], [role=\"banner\"], [role=\"contentinfo\"], \
         .cookie-banner, .cookie-consent, .ad, .advertisement, .sidebar, \
         .menu, .nav, .footer, .header"
    ).unwrap();

    // Try priority selectors first (article, main content)
    let priority_selectors = [
        "article",
        "main",
        "[role=\"main\"]",
        ".content",
        "#content",
        ".article-body",
        ".post-content",
    ];

    for sel_str in &priority_selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            if let Some(element) = document.select(&selector).next() {
                // Collect full text, then subtract junk element text
                let full_text: String = element.text().collect::<Vec<_>>().join(" ");
                let junk_text: String = element
                    .select(&junk_sel)
                    .flat_map(|el| el.text())
                    .collect::<Vec<_>>()
                    .join(" ");

                let clean = if junk_text.len() > 30 {
                    full_text.replace(&junk_text, " ")
                } else {
                    full_text
                };

                let text = normalize_text(&clean);
                if text.len() >= 120 {
                    return text;
                }
            }
        }
    }

    // Fallback: get body text, excluding junk elements
    let body_sel = scraper::Selector::parse("body").unwrap();

    if let Some(body) = document.select(&body_sel).next() {
        // Collect all text nodes from body
        let full_text: String = body.text().collect::<Vec<_>>().join(" ");
        
        // Collect text from junk elements to subtract
        let junk_text: String = body
            .select(&junk_sel)
            .flat_map(|el| el.text())
            .collect::<Vec<_>>()
            .join(" ");

        // Simple subtraction: remove junk text occurrences
        let clean = if junk_text.len() > 50 {
            full_text.replace(&junk_text, " ")
        } else {
            full_text
        };

        return normalize_text(&clean);
    }

    // Last resort: all paragraphs
    if let Ok(p_sel) = scraper::Selector::parse("p") {
        let paragraphs: Vec<String> = document
            .select(&p_sel)
            .map(|el| normalize_text(&el.text().collect::<Vec<_>>().join(" ")))
            .filter(|t| t.len() > 30)
            .collect();
        if !paragraphs.is_empty() {
            return paragraphs.join("\n\n");
        }
    }

    String::new()
}

// ── Tier 3: Screenshot + Vision LLM ─────────────────

/// Take a screenshot with headless Chrome and return it as a base64 string.
pub fn capture_screenshot(
    url: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let chrome = detect_chrome_binary()
        .ok_or_else(|| "No Chrome/Chromium browser found for screenshots".to_string())?;

    // Create temp file for screenshot
    let tmp_dir = std::env::temp_dir();
    let screenshot_path = tmp_dir.join(format!("broxeen_screenshot_{}.png", std::process::id()));

    crate::backend_info(format!(
        "[browse:screenshot] Taking screenshot of {} → {}",
        url,
        screenshot_path.display()
    ));

    let output = Command::new(&chrome)
        .arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--disable-dev-shm-usage")
        .arg(format!("--screenshot={}", screenshot_path.display()))
        .arg("--window-size=1280,900")
        .arg("--hide-scrollbars")
        .arg(format!("--timeout={}", timeout_secs * 1000))
        .arg(url)
        .output()
        .map_err(|e| format!("Chrome screenshot failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        std::fs::remove_file(&screenshot_path).ok();
        return Err(format!("Chrome screenshot failed: {stderr}"));
    }

    if !screenshot_path.exists() {
        return Err("Screenshot file not created".into());
    }

    let img_bytes = std::fs::read(&screenshot_path)
        .map_err(|e| format!("Cannot read screenshot: {e}"))?;

    // Clean up screenshot file
    std::fs::remove_file(&screenshot_path).ok();

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    Ok(STANDARD.encode(&img_bytes))
}

/// Take a screenshot with headless Chrome and send to Vision LLM for description.
/// Returns (title_from_vision, description).
pub async fn screenshot_and_describe(
    url: &str,
    api_key: &str,
    timeout_secs: u64,
) -> Result<(String, String), String> {
    let chrome = detect_chrome_binary()
        .ok_or_else(|| "No Chrome/Chromium browser found for screenshots".to_string())?;

    // Create temp file for screenshot
    let tmp_dir = std::env::temp_dir();
    let screenshot_path = tmp_dir.join(format!("broxeen_screenshot_{}.png", std::process::id()));

    crate::backend_info(format!(
        "[browse:vision] Taking screenshot of {} → {}",
        url,
        screenshot_path.display()
    ));

    let output = Command::new(&chrome)
        .arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--disable-dev-shm-usage")
        .arg(format!("--screenshot={}", screenshot_path.display()))
        .arg("--window-size=1280,900")
        .arg("--hide-scrollbars")
        .arg(format!("--timeout={}", timeout_secs * 1000))
        .arg(url)
        .output()
        .map_err(|e| format!("Chrome screenshot failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        std::fs::remove_file(&screenshot_path).ok();
        return Err(format!("Chrome screenshot failed: {stderr}"));
    }

    if !screenshot_path.exists() {
        return Err("Screenshot file not created".into());
    }

    let img_bytes = std::fs::read(&screenshot_path)
        .map_err(|e| format!("Cannot read screenshot: {e}"))?;

    crate::backend_info(format!(
        "[browse:vision] Screenshot captured ({} KB). Sending to Vision LLM...",
        img_bytes.len() / 1024
    ));

    // Clean up screenshot file
    std::fs::remove_file(&screenshot_path).ok();

    // Send to Vision LLM
    let description = describe_image_with_vision(&img_bytes, url, api_key).await?;

    Ok((format!("Screenshot: {}", url), description))
}

/// Send image to Gemini Vision via OpenRouter for description.
async fn describe_image_with_vision(
    img_bytes: &[u8],
    url: &str,
    api_key: &str,
) -> Result<String, String> {
    use base64::Engine;
    let img_base64 = base64::engine::general_purpose::STANDARD.encode(img_bytes);

    let payload = serde_json::json!({
        "model": env::var("BROWSE_LLM_MODEL").unwrap_or_else(|_| {
            env::var("VITE_BROWSE_LLM_MODEL")
                .unwrap_or_else(|_| "google/gemini-2.0-flash-001".to_string())
        }),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": format!(
                            "To jest zrzut ekranu strony {}. \
                             Opisz dokładnie treść widoczną na stronie po polsku. \
                             Skup się na głównej treści (środek strony), pomiń nagłówki nawigacyjne, \
                             stopki, banery cookies i reklamy. \
                             Podaj tylko treść merytoryczną, bez komentarzy o layoucie.",
                            url
                        )
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:image/png;base64,{}", img_base64)
                        }
                    }
                ]
            }
        ],
        "max_tokens": 2048,
        "temperature": 0.3,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Vision LLM request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let truncated = &body[..body.len().min(300)];
        return Err(format!("Vision LLM HTTP {status}: {truncated}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Vision LLM JSON parse error: {e}"))?;

    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    crate::backend_info(format!(
        "[browse:vision] Vision LLM response: {} chars",
        text.len()
    ));

    if text.is_empty() {
        return Err("Vision LLM returned empty response".into());
    }

    Ok(text)
}

// ── Helpers ──────────────────────────────────────────

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

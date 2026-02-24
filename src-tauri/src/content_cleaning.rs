/// Content cleaning utilities.
///
/// Handles cookie banner stripping, whitespace normalization,
/// and content truncation.

use crate::logging::{backend_warn};
use regex_lite::Regex;

pub const MIN_READABLE_CONTENT_LENGTH: usize = 120;
pub const MAX_BACKEND_CONTENT_CHARS: usize = 20_000;

pub fn filter_anti_scraping_notices(text: &str) -> String {
    let mut cleaned = text.to_string();
    
    // Remove CSS class definitions (basic pattern)
    // Note: regex-lite has limited regex support, so we'll use simple string operations
    let lines: Vec<&str> = cleaned.lines().collect();
    let mut filtered_lines = Vec::new();
    
    for line in lines {
        let trimmed = line.trim();
        // Skip lines that look like CSS class definitions
        if trimmed.starts_with('.') && trimmed.contains('{') {
            continue;
        }
        // Skip lines that contain CSS properties
        if trimmed.contains("background-color:") || 
           trimmed.contains("border:") || 
           trimmed.contains("color:") ||
           trimmed.contains("display:") ||
           trimmed.contains("font-size:") ||
           trimmed.contains("padding:") ||
           trimmed.contains("margin:") ||
           trimmed.contains("position:") ||
           trimmed.contains("width:") ||
           trimmed.contains("height:") ||
           trimmed.contains("transform:") ||
           trimmed.contains("opacity:") ||
           trimmed.contains("visibility:") ||
           trimmed.contains("z-index:") ||
           trimmed.contains("flex:") ||
           trimmed.contains("grid:") ||
           trimmed.contains("align-items:") ||
           trimmed.contains("justify-content:") ||
           trimmed.contains("text-decoration:") ||
           trimmed.contains("border-radius:") ||
           trimmed.contains("box-shadow:") ||
           trimmed.contains("cursor:") ||
           trimmed.contains("outline:") ||
           trimmed.contains("overflow:") ||
           trimmed.contains("white-space:") ||
           trimmed.contains("text-overflow:") ||
           trimmed.contains("line-height:") ||
           trimmed.contains("letter-spacing:") ||
           trimmed.contains("font-weight:") ||
           trimmed.contains("text-transform:") ||
           trimmed.contains("transition:") ||
           trimmed.contains("animation:") {
            continue;
        }
        
        filtered_lines.push(line);
    }
    
    cleaned = filtered_lines.join("\n");
    
    // Remove CSS class names that are UI components
    let lower = cleaned.to_lowercase();
    let css_classes = ["olwg__", "wp__", "ui__", "btn__", "nav__"];
    for class_prefix in css_classes {
        // Simple replacement for CSS class names
        cleaned = cleaned.replace(&format!("{} ", class_prefix), " ");
        cleaned = cleaned.replace(&format!(" {}", class_prefix), " ");
    }
    
    // Simple string replacement for WP.pl - find and replace entire sentence
    if let Some(start) = lower.find("pobieranie, zwielokrotnianie, przechowywanie") {
        if let Some(end) = lower[start..].find('.') {
            let end_pos = start + end + 1;
            cleaned.replace_range(start..end_pos, " ");
        }
    }
    
    // Simple string replacement for Onet.pl - find and replace entire sentence
    if let Some(start) = lower.find("systematyczne pobieranie treści, danych lub informacji z tej strony internetowej") {
        if let Some(end) = lower[start..].find('.') {
            let end_pos = start + end + 1;
            cleaned.replace_range(start..end_pos, " ");
        }
    }
    
    cleaned
}

pub fn strip_cookie_banner_text(text: &str) -> String {
    let text = filter_anti_scraping_notices(text);
    let raw = text.trim();
    if raw.is_empty() {
        return String::new();
    }

    // Filter out legal disclaimer blocks first
    let lower = raw.to_lowercase();
    let is_legal_disclaimer = lower.contains("pobieranie") 
        || lower.contains("zwielokrotnianie") 
        || lower.contains("przechowywanie") 
        || lower.contains("wykorzystywanie") 
        || lower.contains("wirtualna polska") 
        || lower.contains("media spółka") 
        || lower.contains("akcyjna") 
        || lower.contains("siedzibą") 
        || lower.contains("właścicielem") 
        || lower.contains("niniejszego") 
        || lower.contains("serwisu") 
        || lower.contains("bez względu") 
        || lower.contains("sposób") 
        || lower.contains("eksploracji") 
        || lower.contains("wykorzystaną") 
        || lower.contains("metodę") 
        || lower.contains("manualną") 
        || lower.contains("zautomatyzowaną") 
        || lower.contains("technikę") 
        || lower.contains("programów") 
        || lower.contains("uczenia") 
        || lower.contains("maszynowego") 
        || lower.contains("sztucznej") 
        || lower.contains("inteligencji") 
        || lower.contains("powyższe") 
        || lower.contains("zastrzeżenie") 
        || lower.contains("dotyczy") 
        || lower.contains("wykorzystywania") 
        || lower.contains("jedynie") 
        || lower.contains("celu") 
        || lower.contains("ułatwienia") 
        || lower.contains("wyszukiwania") 
        || lower.contains("przez") 
        || lower.contains("wyszukiwarki") 
        || lower.contains("internetowe") 
        || lower.contains("korzystania") 
        || lower.contains("ramach") 
        || lower.contains("stosunków") 
        || lower.contains("umownych") 
        || lower.contains("dozwolonego") 
        || lower.contains("użytku") 
        || lower.contains("określonego") 
        || lower.contains("właściwe") 
        || lower.contains("przepisy") 
        || lower.contains("prawa") 
        || lower.contains("szczegółowa") 
        || lower.contains("treść") 
        || lower.contains("dotycząca") 
        || lower.contains("niniejszego") 
        || lower.contains("zastrzeżenia") 
        || lower.contains("znajduje") 
        || lower.contains("tutaj")
        // Onet.pl Ringier Axel Springer Polska
        || lower.contains("systematyczne")
        || lower.contains("pobieranie")
        || lower.contains("danych")
        || lower.contains("informacji")
        || lower.contains("strony")
        || lower.contains("internetowej")
        || lower.contains("web scraping")
        || lower.contains("eksploracja")
        || lower.contains("tekstu")
        || lower.contains("indeksowanie")
        || lower.contains("przeszukiwanie")
        || lower.contains("pobieraniem")
        || lower.contains("roboty")
        || lower.contains("crawlers")
        || lower.contains("oprogramowanie")
        || lower.contains("narzędzia")
        || lower.contains("tworzenia")
        || lower.contains("rozwoju")
        || lower.contains("szkolenia")
        || lower.contains("systemów")
        || lower.contains("ai")
        || lower.contains("ringier")
        || lower.contains("axel")
        || lower.contains("springer")
        || lower.contains("polska")
        || lower.contains("rasp")
        || lower.contains("zabronione")
        || lower.contains("wyjątek")
        || lower.contains("stanowią")
        || lower.contains("sytuacje")
        || lower.contains("których")
        || lower.contains("ulepszenia")
        || lower.contains("wyszukiwania")
        || lower.contains("wyszukiwarki");

    if is_legal_disclaimer {
        return String::new(); // Remove entire legal disclaimer block
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

    let looks_like_banner = score >= 2 || lower.contains("strona korzysta z plik") || lower.contains("plików tekstowych zwanych ciasteczkami");
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

pub fn truncate_to_chars(text: &str, max_chars: usize) -> String {
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

pub fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

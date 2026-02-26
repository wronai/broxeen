/// Content cleaning utilities.
///
/// Handles cookie banner stripping, whitespace normalization,
/// and content truncation.

use crate::logging::{backend_warn};

pub const MIN_READABLE_CONTENT_LENGTH: usize = 120;
pub const MAX_BACKEND_CONTENT_CHARS: usize = 20_000;

pub fn strip_cookie_banner_text(text: &str) -> String {
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

#[allow(dead_code)]
pub fn is_bot_protection_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    
    let bot_phrases = [
        "pobieranie, zwielokrotnianie, przechowywanie",
        "czy jesteś robotem",
        "czy jestes robotem",
        "włącz javascript",
        "enable javascript",
        "verify you are human",
        "please verify you are a human",
        "checking your browser before accessing",
        "attention required! | cloudflare",
        "potwierdź, że jesteś człowiekiem",
    ];

    for phrase in bot_phrases {
        if lower.contains(phrase) {
            return true;
        }
    }
    
    false
}

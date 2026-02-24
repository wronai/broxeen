/// Content extraction from HTML documents.
///
/// Handles structured extraction from HTML using CSS selectors,
/// DuckDuckGo search result parsing, and scraper-based fallbacks.

use crate::content_cleaning::{normalize_whitespace, MIN_READABLE_CONTENT_LENGTH, MAX_BACKEND_CONTENT_CHARS, truncate_to_chars};
use crate::logging::backend_info;

/// Extract search results from DuckDuckGo HTML-only page.
/// Returns formatted search results as text, or None if not a DuckDuckGo page.
pub fn extract_search_results(html: &str, url: &str) -> Option<String> {
    // Only handle DuckDuckGo HTML search pages
    if !url.contains("html.duckduckgo.com") && !url.contains("duckduckgo.com/?q=") {
        return None;
    }

    let document = scraper::Html::parse_document(html);

    // DuckDuckGo HTML results are in <div class="result"> or <div class="links_main">
    let result_selectors = [
        ".result",
        ".links_main",
        ".result__body",
    ];

    let mut results: Vec<String> = Vec::new();

    for sel_str in &result_selectors {
        if let Ok(selector) = scraper::Selector::parse(sel_str) {
            let elements: Vec<_> = document.select(&selector).collect();
            if elements.is_empty() {
                continue;
            }

            for element in elements.iter().take(10) {
                // Extract title from <a class="result__a"> or first <a>
                let title = scraper::Selector::parse("a.result__a, .result__title a, a")
                    .ok()
                    .and_then(|sel| element.select(&sel).next())
                    .map(|a| a.text().collect::<Vec<_>>().join(" ").trim().to_string())
                    .unwrap_or_default();

                // Extract snippet from <a class="result__snippet"> or <div class="result__snippet">
                let snippet = scraper::Selector::parse(".result__snippet, .snippet")
                    .ok()
                    .and_then(|sel| element.select(&sel).next())
                    .map(|s| s.text().collect::<Vec<_>>().join(" ").trim().to_string())
                    .unwrap_or_default();

                // Extract URL from <a class="result__url"> or href
                let result_url = scraper::Selector::parse("a.result__url, .result__extras__url a")
                    .ok()
                    .and_then(|sel| element.select(&sel).next())
                    .map(|a| a.text().collect::<Vec<_>>().join(" ").trim().to_string())
                    .unwrap_or_default();

                if title.is_empty() && snippet.is_empty() {
                    continue;
                }

                let mut entry = String::new();
                if !title.is_empty() {
                    entry.push_str(&format!("• {}", title));
                }
                if !result_url.is_empty() {
                    entry.push_str(&format!(" ({})", result_url));
                }
                if !snippet.is_empty() {
                    entry.push_str(&format!("\n  {}", snippet));
                }
                results.push(entry);
            }

            if !results.is_empty() {
                break;
            }
        }
    }

    if results.is_empty() {
        // Fallback: try to get any text from the body that looks like results
        return None;
    }

    backend_info(format!(
        "Extracted {} search results from DuckDuckGo HTML page",
        results.len()
    ));

    Some(format!("Wyniki wyszukiwania:\n\n{}", results.join("\n\n")))
}

/// Extract meaningful content from an HTML document using priority selectors.
pub fn extract_content(document: &scraper::Html) -> String {
    // Junk elements to subtract from any matched container
    let junk_sel = scraper::Selector::parse(
        "script, style, noscript, nav, footer, header, aside, form, button, select, \
         [role=\"navigation\"], [role=\"banner\"], [role=\"contentinfo\"], \
         .cookie-banner, .cookie-consent, .ad, .advertisement, .sidebar, \
         .menu, .nav, .footer, .header"
    ).unwrap();

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

                let text = normalize_whitespace(&clean);
                if text.len() >= MIN_READABLE_CONTENT_LENGTH {
                    return text;
                }
            }
        }
    }

    // Fallback: collect all paragraph text (skip paragraphs inside junk containers)
    if let Ok(p_selector) = scraper::Selector::parse("p") {
        let paragraphs: Vec<String> = document
            .select(&p_selector)
            .filter(|el| {
                // Skip paragraphs that are inside nav/footer/aside/form
                let mut parent = el.parent();
                while let Some(p) = parent {
                    if let Some(p_el) = p.value().as_element() {
                        let tag = p_el.name();
                        if matches!(tag, "nav" | "footer" | "header" | "aside" | "form") {
                            return false;
                        }
                    }
                    parent = p.parent();
                }
                true
            })
            .map(|el| normalize_whitespace(&el.text().collect::<Vec<_>>().join(" ")))
            .filter(|t| t.len() > 40)
            .collect();
        if !paragraphs.is_empty() {
            return paragraphs.join("\n\n");
        }
    }

    "Nie udało się wyodrębnić treści ze strony.".to_string()
}

/// Extract title and content from raw HTML using scraper.
pub fn extract_with_scraper(html: &str, url: &str) -> (String, String) {
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

/// Build a search result BrowseResult if the URL is a DuckDuckGo search.
#[allow(dead_code)]
pub fn try_extract_search(html: &str, url: &str, _final_url: &str) -> Option<(String, String)> {
    let search_content = extract_search_results(html, url)?;

    backend_info("Detected DuckDuckGo search results page, extracting results directly");
    let search_title = format!("Wyniki wyszukiwania: {}",
        url::Url::parse(url)
            .ok()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "q").map(|(_, v)| v.to_string()))
            .unwrap_or_else(|| url.to_string())
    );
    let final_content = truncate_to_chars(&search_content, MAX_BACKEND_CONTENT_CHARS);

    Some((search_title, final_content))
}

#[derive(Debug, Default, Clone)]
pub struct ActionLinks {
    pub rss_url: Option<String>,
    pub contact_url: Option<String>,
    pub phone_url: Option<String>,
    pub sitemap_url: Option<String>,
    pub blog_url: Option<String>,
    pub linkedin_url: Option<String>,
    pub facebook_url: Option<String>,
    pub twitter_url: Option<String>,
    pub github_url: Option<String>,
    pub youtube_url: Option<String>,
    pub instagram_url: Option<String>,
}

/// Extract quick action links (RSS, Contact, Phone, Social Media, etc.) from parsed HTML
pub fn extract_action_links(document: &scraper::Html) -> ActionLinks {
    let mut links = ActionLinks::default();

    // RSS
    if let Ok(sel) = scraper::Selector::parse("link[type='application/rss+xml'], link[type='application/atom+xml']") {
        if let Some(el) = document.select(&sel).next() {
            links.rss_url = el.value().attr("href").map(|s| s.to_string());
        }
    }
    if links.rss_url.is_none() {
        if let Ok(sel) = scraper::Selector::parse("a[href*='rss'], a[href*='feed']") {
            if let Some(el) = document.select(&sel).next() {
                links.rss_url = el.value().attr("href").map(|s| s.to_string());
            }
        }
    }

    // Sitemap
    if let Ok(sel) = scraper::Selector::parse("link[type='application/xml'][rel='sitemap'], a[href*='sitemap']") {
        if let Some(el) = document.select(&sel).next() {
            links.sitemap_url = el.value().attr("href").map(|s| s.to_string());
        }
    }
    if links.sitemap_url.is_none() {
        if let Ok(sel) = scraper::Selector::parse("a[href*='sitemap.xml'], a[href*='mapa-strony']") {
            if let Some(el) = document.select(&sel).next() {
                links.sitemap_url = el.value().attr("href").map(|s| s.to_string());
            }
        }
    }

    // Blog
    if let Ok(sel) = scraper::Selector::parse("a[href*='blog'], a[href*='wpis'], a[href*='artykul']") {
        if let Some(el) = document.select(&sel).next() {
            links.blog_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Contact
    if let Ok(sel) = scraper::Selector::parse("a[href^='mailto:'], a[href*='kontakt'], a[href*='contact']") {
        for el in document.select(&sel) {
            let href = el.value().attr("href").unwrap_or_default();
            if href.starts_with("mailto:") || href.contains("kontakt") || href.contains("contact") {
                // Ensure it's not a generic relative link that just happens to have contact in text unless it's a real link
                links.contact_url = Some(href.to_string());
                break;
            }
        }
    }

    // Phone
    if let Ok(sel) = scraper::Selector::parse("a[href^='tel:']") {
        if let Some(el) = document.select(&sel).next() {
            links.phone_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - LinkedIn
    if let Ok(sel) = scraper::Selector::parse("a[href*='linkedin.com'], a[href*='linkedin']") {
        if let Some(el) = document.select(&sel).next() {
            links.linkedin_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - Facebook
    if let Ok(sel) = scraper::Selector::parse("a[href*='facebook.com'], a[href*='facebook']") {
        if let Some(el) = document.select(&sel).next() {
            links.facebook_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - Twitter/X
    if let Ok(sel) = scraper::Selector::parse("a[href*='twitter.com'], a[href*='x.com'], a[href*='twitter']") {
        if let Some(el) = document.select(&sel).next() {
            links.twitter_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - GitHub
    if let Ok(sel) = scraper::Selector::parse("a[href*='github.com'], a[href*='github']") {
        if let Some(el) = document.select(&sel).next() {
            links.github_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - YouTube
    if let Ok(sel) = scraper::Selector::parse("a[href*='youtube.com'], a[href*='youtube']") {
        if let Some(el) = document.select(&sel).next() {
            links.youtube_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    // Social Media - Instagram
    if let Ok(sel) = scraper::Selector::parse("a[href*='instagram.com'], a[href*='instagram']") {
        if let Some(el) = document.select(&sel).next() {
            links.instagram_url = el.value().attr("href").map(|s| s.to_string());
        }
    }

    links
}


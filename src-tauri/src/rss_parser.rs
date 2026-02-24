/// RSS/Atom feed parsing for Broxeen.
///
/// Provides structured extraction from RSS 2.0 and Atom feeds
/// with proper XML parsing and article formatting.

use crate::logging::{backend_info, backend_warn};
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssItem {
    pub title: String,
    pub link: Option<String>,
    pub description: Option<String>,
    pub pub_date: Option<String>,
    pub guid: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssFeed {
    pub title: String,
    pub description: Option<String>,
    pub link: Option<String>,
    pub language: Option<String>,
    pub last_build_date: Option<String>,
    pub items: Vec<RssItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtomEntry {
    pub title: String,
    pub link: Option<String>,
    pub summary: Option<String>,
    pub content: Option<String>,
    pub published: Option<String>,
    pub updated: Option<String>,
    pub id: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtomFeed {
    pub title: String,
    pub subtitle: Option<String>,
    pub link: Option<String>,
    pub updated: Option<String>,
    pub language: Option<String>,
    pub entries: Vec<AtomEntry>,
}

/// Parse RSS 2.0 feed from XML content
pub fn parse_rss_feed(xml_content: &str) -> Result<RssFeed, String> {
    let document = roxmltree::Document::parse(xml_content)
        .map_err(|e| format!("Failed to parse XML: {}", e))?;

    let root = document.root_element();
    
    // Check if this is RSS
    if root.tag_name().name() != "rss" {
        return Err("Not an RSS feed".to_string());
    }

    let channel = root.children()
        .find(|n| n.tag_name().name() == "channel")
        .ok_or("RSS channel not found")?;

    // Extract feed metadata
    let title = extract_text(&channel, "title").unwrap_or_else(|| "Untitled RSS Feed".to_string());
    let description = extract_text(&channel, "description");
    let link = extract_text(&channel, "link");
    let language = extract_text(&channel, "language");
    let last_build_date = extract_text(&channel, "lastBuildDate");

    // Extract items
    let mut items = Vec::new();
    for item_node in channel.children().filter(|n| n.tag_name().name() == "item") {
        let item = RssItem {
            title: extract_text(&item_node, "title").unwrap_or_else(|| "Untitled".to_string()),
            link: extract_text(&item_node, "link"),
            description: extract_text(&item_node, "description"),
            pub_date: extract_text(&item_node, "pubDate"),
            guid: extract_text(&item_node, "guid"),
            author: extract_text(&item_node, "author"),
        };
        items.push(item);
    }

    backend_info(format!("Parsed RSS feed: {} with {} items", title, items.len()));

    Ok(RssFeed {
        title,
        description,
        link,
        language,
        last_build_date,
        items,
    })
}

/// Parse Atom feed from XML content
pub fn parse_atom_feed(xml_content: &str) -> Result<AtomFeed, String> {
    let document = roxmltree::Document::parse(xml_content)
        .map_err(|e| format!("Failed to parse XML: {}", e))?;

    let root = document.root_element();
    
    // Check if this is Atom (could be feed or entry)
    if root.tag_name().name() != "feed" {
        return Err("Not an Atom feed".to_string());
    }

    // Extract feed metadata
    let title = extract_text(&root, "title").unwrap_or_else(|| "Untitled Atom Feed".to_string());
    let subtitle = extract_text(&root, "subtitle");
    let link = extract_atom_link(&root);
    let updated = extract_text(&root, "updated");
    let language = root.attribute("xml:lang").map(|s| s.to_string());

    // Extract entries
    let mut entries = Vec::new();
    for entry_node in root.children().filter(|n| n.tag_name().name() == "entry") {
        let entry = AtomEntry {
            title: extract_text(&entry_node, "title").unwrap_or_else(|| "Untitled".to_string()),
            link: extract_atom_link(&entry_node),
            summary: extract_text(&entry_node, "summary"),
            content: extract_text(&entry_node, "content"),
            published: extract_text(&entry_node, "published"),
            updated: extract_text(&entry_node, "updated"),
            id: extract_text(&entry_node, "id"),
            author: extract_atom_author(&entry_node),
        };
        entries.push(entry);
    }

    backend_info(format!("Parsed Atom feed: {} with {} entries", title, entries.len()));

    Ok(AtomFeed {
        title,
        subtitle,
        link,
        updated,
        language,
        entries,
    })
}

/// Extract text content from a child element
fn extract_text(parent: &roxmltree::Node, tag_name: &str) -> Option<String> {
    parent.children()
        .find(|n| n.tag_name().name() == tag_name)
        .and_then(|n| {
            n.text()
                .map(|t| t.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

/// Extract Atom link (href attribute)
fn extract_atom_link(parent: &roxmltree::Node) -> Option<String> {
    parent.children()
        .find(|n| n.tag_name().name() == "link")
        .and_then(|n| n.attribute("href"))
        .map(|s| s.to_string())
}

/// Extract Atom author name
fn extract_atom_author(parent: &roxmltree::Node) -> Option<String> {
    parent.children()
        .find(|n| n.tag_name().name() == "author")
        .and_then(|author_node| extract_text(&author_node, "name"))
}

/// Format RSS feed as readable text
pub fn format_rss_feed(feed: &RssFeed, max_items: usize) -> String {
    let mut result = String::new();
    
    result.push_str(&format!("📰 **{}**\n\n", feed.title));
    
    if let Some(description) = &feed.description {
        result.push_str(&format!("{}\n\n", description));
    }
    
    if let Some(link) = &feed.link {
        result.push_str(&format!("🔗 {}\n\n", link));
    }

    let items_to_show = feed.items.iter().take(max_items);
    
    for (i, item) in items_to_show.enumerate() {
        result.push_str(&format!("**{}. {}**\n", i + 1, item.title));
        
        if let Some(link) = &item.link {
            result.push_str(&format!("🔗 {}\n", link));
        }
        
        if let Some(pub_date) = &item.pub_date {
            result.push_str(&format!("📅 {}\n", pub_date));
        }
        
        if let Some(author) = &item.author {
            result.push_str(&format!("✍️ {}\n", author));
        }
        
        if let Some(description) = &item.description {
            // Clean up HTML tags and truncate
            let clean_desc = clean_html_text(description);
            let truncated = if clean_desc.len() > 300 {
                format!("{}...", &clean_desc[..300])
            } else {
                clean_desc
            };
            result.push_str(&format!("{}\n", truncated));
        }
        
        result.push('\n');
    }
    
    if feed.items.len() > max_items {
        result.push_str(&format!("... i {} więcej artykułów\n", feed.items.len() - max_items));
    }
    
    result
}

/// Format Atom feed as readable text
pub fn format_atom_feed(feed: &AtomFeed, max_items: usize) -> String {
    let mut result = String::new();
    
    result.push_str(&format!("🗞️ **{}**\n\n", feed.title));
    
    if let Some(subtitle) = &feed.subtitle {
        result.push_str(&format!("{}\n\n", subtitle));
    }
    
    if let Some(link) = &feed.link {
        result.push_str(&format!("🔗 {}\n\n", link));
    }

    let entries_to_show = feed.entries.iter().take(max_items);
    
    for (i, entry) in entries_to_show.enumerate() {
        result.push_str(&format!("**{}. {}**\n", i + 1, entry.title));
        
        if let Some(link) = &entry.link {
            result.push_str(&format!("🔗 {}\n", link));
        }
        
        // Use published or updated date
        if let Some(date) = entry.published.as_ref().or(entry.updated.as_ref()) {
            result.push_str(&format!("📅 {}\n", date));
        }
        
        if let Some(author) = &entry.author {
            result.push_str(&format!("✍️ {}\n", author));
        }
        
        // Use summary or content
        if let Some(content) = entry.summary.as_ref().or(entry.content.as_ref()) {
            let clean_desc = clean_html_text(content);
            let truncated = if clean_desc.len() > 300 {
                format!("{}...", &clean_desc[..300])
            } else {
                clean_desc
            };
            result.push_str(&format!("{}\n", truncated));
        }
        
        result.push('\n');
    }
    
    if feed.entries.len() > max_items {
        result.push_str(&format!("... i {} więcej wpisów\n", feed.entries.len() - max_items));
    }
    
    result
}

/// Clean HTML tags from text (basic implementation)
fn clean_html_text(html: &str) -> String {
    // Simple regex-based HTML tag removal using regex_lite
    let clean = regex_lite::Regex::new(r"<[^>]*>")
        .map(|re| re.replace_all(html, " ").to_string())
        .unwrap_or_else(|_| html.to_string());
    
    // Normalize whitespace
    clean.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Detect if content is RSS or Atom feed
pub fn detect_feed_type(content: &str) -> Option<&'static str> {
    let content_lower = content.to_lowercase();
    
    if content_lower.contains("<rss") && content_lower.contains("<channel>") {
        Some("rss")
    } else if content_lower.contains("<feed") && content_lower.contains("xmlns=") {
        Some("atom")
    } else {
        None
    }
}

/// Parse any feed (RSS or Atom) and return formatted text
pub fn parse_and_format_feed(content: &str, max_items: usize) -> Result<String, String> {
    let feed_type = detect_feed_type(content)
        .ok_or_else(|| "Content does not appear to be RSS or Atom feed".to_string())?;
    
    match feed_type {
        "rss" => {
            let feed = parse_rss_feed(content)?;
            Ok(format_rss_feed(&feed, max_items))
        }
        "atom" => {
            let feed = parse_atom_feed(content)?;
            Ok(format_atom_feed(&feed, max_items))
        }
        _ => Err("Unsupported feed type".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_feed_type() {
        let rss_content = r#"<rss version="2.0"><channel><title>Test</title></channel></rss>"#;
        let atom_content = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Test</title></feed>"#;
        let html_content = r#"<html><head><title>Test</title></head></html>"#;
        
        assert_eq!(detect_feed_type(rss_content), Some("rss"));
        assert_eq!(detect_feed_type(atom_content), Some("atom"));
        assert_eq!(detect_feed_type(html_content), None);
    }

    #[test]
    fn test_clean_html_text() {
        let html = "<p>Hello <strong>world</strong>!</p>";
        let cleaned = clean_html_text(html);
        assert_eq!(cleaned, "Hello world!");
    }
}

/// Tauri command to parse RSS/Atom feed
#[command]
pub fn parse_rss_feed_command(url: String, content: String, max_items: Option<usize>) -> Result<String, String> {
    let max_items = max_items.unwrap_or(10);
    
    backend_info(format!("Parsing feed: {} (max_items: {})", url, max_items));
    
    match parse_and_format_feed(&content, max_items) {
        Ok(formatted_content) => {
            backend_info(format!("Successfully parsed feed: {} items extracted", 
                if formatted_content.matches("**").count() > 0 { 
                    (formatted_content.matches("**").count() - 1) / 2 
                } else { 
                    0 
                }
            ));
            Ok(formatted_content)
        }
        Err(error) => {
            backend_warn(format!("Failed to parse feed {}: {}", url, error));
            Err(error)
        }
    }
}

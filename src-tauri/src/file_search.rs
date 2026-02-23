use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use std::time::SystemTime;

use crate::logging::{backend_info, backend_warn, backend_error};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified: Option<String>,
    pub file_type: String,
    pub is_dir: bool,
    pub preview: Option<String>,
    pub mime_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileSearchResponse {
    pub results: Vec<FileSearchResult>,
    pub total_found: usize,
    pub search_path: String,
    pub query: String,
    pub duration_ms: u64,
    pub truncated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContentResponse {
    pub path: String,
    pub name: String,
    pub content: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub truncated: bool,
}

fn guess_mime_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "pdf" => "application/pdf",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        "ppt" | "pptx" => "application/vnd.ms-powerpoint",
        "txt" | "md" | "log" | "csv" | "tsv" => "text/plain",
        "html" | "htm" => "text/html",
        "xml" => "text/xml",
        "json" => "application/json",
        "yaml" | "yml" => "text/yaml",
        "toml" => "text/toml",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "rb" | "go" | "java" | "c" | "cpp" | "h" | "hpp" | "cs" | "swift" | "kt" => "text/x-source",
        "sh" | "bash" | "zsh" | "fish" => "text/x-shellscript",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" | "webm" | "avi" | "mkv" | "mov" => "video/*",
        "mp3" | "wav" | "ogg" | "flac" | "aac" => "audio/*",
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => "application/archive",
        "sql" => "text/x-sql",
        "ini" | "cfg" | "conf" => "text/x-config",
        _ => "application/octet-stream",
    }
}

fn classify_file_type(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "pdf" => "dokument PDF",
        "doc" | "docx" => "dokument Word",
        "xls" | "xlsx" => "arkusz Excel",
        "ppt" | "pptx" => "prezentacja PowerPoint",
        "txt" => "plik tekstowy",
        "md" => "dokument Markdown",
        "log" => "plik logów",
        "csv" | "tsv" => "dane tabelaryczne",
        "html" | "htm" => "strona HTML",
        "xml" => "plik XML",
        "json" => "plik JSON",
        "yaml" | "yml" => "plik YAML",
        "toml" => "plik TOML",
        "rs" => "kod Rust",
        "ts" | "tsx" => "kod TypeScript",
        "js" | "jsx" => "kod JavaScript",
        "py" => "kod Python",
        "rb" => "kod Ruby",
        "go" => "kod Go",
        "java" => "kod Java",
        "c" | "cpp" | "h" | "hpp" => "kod C/C++",
        "cs" => "kod C#",
        "swift" => "kod Swift",
        "kt" => "kod Kotlin",
        "sh" | "bash" | "zsh" => "skrypt shell",
        "jpg" | "jpeg" | "png" | "gif" | "svg" | "webp" | "bmp" => "obraz",
        "mp4" | "webm" | "avi" | "mkv" | "mov" => "wideo",
        "mp3" | "wav" | "ogg" | "flac" | "aac" => "audio",
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => "archiwum",
        "sql" => "skrypt SQL",
        "ini" | "cfg" | "conf" => "plik konfiguracyjny",
        _ => "plik",
    }
}

fn is_text_file(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "txt" | "md" | "log" | "csv" | "tsv" | "html" | "htm" | "xml" | "json" | "yaml" | "yml"
            | "toml" | "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "rb" | "go" | "java"
            | "c" | "cpp" | "h" | "hpp" | "cs" | "swift" | "kt" | "sh" | "bash" | "zsh"
            | "fish" | "sql" | "ini" | "cfg" | "conf" | "env" | "gitignore" | "dockerfile"
            | "makefile"
    )
}

fn format_time(time: SystemTime) -> Option<String> {
    let duration = time.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    let secs = duration.as_secs();
    let dt = chrono::NaiveDateTime::from_timestamp_opt(secs as i64, 0)?;
    Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | ".cache" | "__pycache__" | ".venv"
            | "venv" | ".env" | "dist" | "build" | ".next" | ".nuxt"
            | ".svelte-kit" | "coverage" | ".cargo" | ".rustup"
    )
}

fn walk_and_search(
    dir: &Path,
    query: &str,
    extensions: &[String],
    max_results: usize,
    max_depth: usize,
    current_depth: usize,
    results: &mut Vec<FileSearchResult>,
) {
    if current_depth > max_depth || results.len() >= max_results {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries {
        if results.len() >= max_results {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and known junk directories
        if name.starts_with('.') && name != ".env" {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            if should_skip_dir(&name) {
                continue;
            }
            // Recurse into subdirectories
            walk_and_search(&path, query, extensions, max_results, max_depth, current_depth + 1, results);
            continue;
        }

        // File matching
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();

        // Filter by extension if specified
        if !extensions.is_empty() && !extensions.iter().any(|e| e.eq_ignore_ascii_case(&ext)) {
            continue;
        }

        let name_lower = name.to_lowercase();
        let query_lower = query.to_lowercase();

        // Match by filename or path
        let matches = query_lower.is_empty()
            || name_lower.contains(&query_lower)
            || path.to_string_lossy().to_lowercase().contains(&query_lower);

        if !matches {
            continue;
        }

        let modified = metadata.modified().ok().and_then(format_time);
        let mime = guess_mime_type(&ext);
        let file_type = classify_file_type(&ext);

        // Generate preview for text files (first 500 chars)
        let preview = if is_text_file(&ext) && metadata.len() < 1_000_000 {
            fs::read_to_string(&path)
                .ok()
                .map(|content| {
                    let trimmed: String = content.chars().take(500).collect();
                    if content.len() > 500 {
                        format!("{}...", trimmed)
                    } else {
                        trimmed
                    }
                })
        } else {
            None
        };

        results.push(FileSearchResult {
            path: path.to_string_lossy().to_string(),
            name,
            extension: ext,
            size_bytes: metadata.len(),
            modified,
            file_type: file_type.to_string(),
            is_dir: false,
            preview,
            mime_type: mime.to_string(),
        });
    }
}

#[tauri::command]
pub async fn file_search(
    query: String,
    search_path: Option<String>,
    extensions: Option<Vec<String>>,
    max_results: Option<usize>,
    max_depth: Option<usize>,
) -> Result<FileSearchResponse, String> {
    let start = std::time::Instant::now();
    backend_info(format!(
        "Command file_search invoked: query='{}', path={:?}, extensions={:?}",
        query, search_path, extensions
    ));

    let base_path = search_path
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
        });

    if !base_path.exists() {
        return Err(format!("Ścieżka nie istnieje: {}", base_path.display()));
    }

    let max = max_results.unwrap_or(50);
    let depth = max_depth.unwrap_or(8);
    let exts = extensions.unwrap_or_default();

    let mut results = Vec::new();
    walk_and_search(&base_path, &query, &exts, max, depth, 0, &mut results);

    // Sort by modification date (newest first)
    results.sort_by(|a, b| b.modified.cmp(&a.modified));

    let total = results.len();
    let truncated = total >= max;

    backend_info(format!(
        "file_search completed: {} results in {}ms (truncated={})",
        total,
        start.elapsed().as_millis(),
        truncated,
    ));

    Ok(FileSearchResponse {
        total_found: total,
        results,
        search_path: base_path.to_string_lossy().to_string(),
        query,
        duration_ms: start.elapsed().as_millis() as u64,
        truncated,
    })
}

#[tauri::command]
pub async fn file_read_content(
    path: String,
    max_chars: Option<usize>,
) -> Result<FileContentResponse, String> {
    backend_info(format!("Command file_read_content invoked: path='{}'", path));

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("Plik nie istnieje: {}", path));
    }

    let metadata = fs::metadata(file_path).map_err(|e| format!("Nie można odczytać metadanych: {}", e))?;
    if metadata.is_dir() {
        return Err("Podana ścieżka jest katalogiem, nie plikiem.".to_string());
    }

    let ext = file_path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let mime = guess_mime_type(&ext);
    let max = max_chars.unwrap_or(10_000);

    // For binary files, return base64
    let (content, truncated) = if is_text_file(&ext) {
        let full = fs::read_to_string(file_path)
            .map_err(|e| format!("Nie można odczytać pliku: {}", e))?;
        let trunc = full.len() > max;
        let text: String = full.chars().take(max).collect();
        (text, trunc)
    } else if mime.starts_with("image/") && metadata.len() < 10_000_000 {
        // Return base64 for images
        let bytes = fs::read(file_path)
            .map_err(|e| format!("Nie można odczytać pliku: {}", e))?;
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        (format!("data:{};base64,{}", mime, b64), false)
    } else {
        (format!("[Plik binarny: {} — {} bajtów]", mime, metadata.len()), false)
    };

    Ok(FileContentResponse {
        path,
        name,
        content,
        size_bytes: metadata.len(),
        mime_type: mime.to_string(),
        truncated,
    })
}

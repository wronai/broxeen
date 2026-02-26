use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use broxeen::file_search::{file_search, file_read_content};

#[tokio::test]
async fn test_rust_search_performance() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    // Create a larger set of test files for performance testing
    for i in 0..1000 {
        let file_path = temp_dir.path().join(format!("file_{}.txt", i));
        fs::write(&file_path, format!("Content for file {}", i)).unwrap();
        
        if i % 10 == 0 {
            let sub_dir = temp_dir.path().join(format!("subdir_{}", i / 10));
            fs::create_dir_all(&sub_dir).unwrap();
            let nested_file = sub_dir.join(format!("nested_{}.rs", i));
            fs::write(&nested_file, format!("fn test_{}() {{}}", i)).unwrap();
        }
    }
    
    let start = Instant::now();
    let result = file_search(
        "file".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(100),
        Some(10),
    ).await.unwrap();
    
    let duration = start.elapsed();
    
    // Performance assertion - should complete within reasonable time
    assert!(duration.as_millis() < 1000, "Search took too long: {}ms", duration.as_millis());
    assert!(result.total_found > 900, "Should find most files: {}", result.total_found);
    assert!(result.duration_ms < 1000, "Reported duration should be under 1s");
    
    println!("Performance test: {} files found in {}ms", result.total_found, duration.as_millis());
}

#[tokio::test]
async fn test_rust_search_vs_standard_fs() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    // Create test files with nested structure
    let test_files = vec![
        ("src/main.rs", "fn main() {}"),
        ("src/utils/helper.rs", "pub fn helper() {}"),
        ("tests/integration_test.rs", "#[test] fn test_integration() {}"),
        ("Cargo.toml", "[package]\nname = \"test\""),
        ("README.md", "# Test Project"),
        ("docs/guide.md", "# Guide"),
        ("target/release/app", "binary content"),
        ("node_modules/package/index.js", "module code"),
        (".git/config", "git config"),
        ("examples/basic.rs", "example code"),
    ];
    
    for (path, content) in test_files {
        let full_path = temp_dir.path().join(path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&full_path, content).unwrap();
    }
    
    // Test rust_search with different patterns
    let patterns = vec![
        ("*.rs", "Rust files"),
        ("src", "Source directory"),
        ("test", "Test-related files"),
        ("", "All files"),
    ];
    
    for (pattern, description) in patterns {
        let start = Instant::now();
        let result = file_search(
            pattern.to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(50),
            Some(8),
        ).await.unwrap();
        
        let duration = start.elapsed();
        
        println!("{}: {} files in {}ms", description, result.total_found, duration.as_millis());
        
        // Verify results are reasonable
        assert!(result.total_found > 0, "Should find files for pattern: {}", pattern);
        assert!(duration.as_millis() < 500, "Pattern '{}' search too slow: {}ms", pattern, duration.as_millis());
    }
}

#[tokio::test]
async fn test_file_content_reading_integration() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    // Create various file types for content reading
    let files = vec![
        ("simple.txt", "Hello World\nThis is a test file."),
        ("large.txt", &"A".repeat(10000)), // Large file
        ("unicode.txt", "Hello 世界 🌍"),
        ("config.json", "{\"key\": \"value\", \"number\": 42}"),
        ("script.py", "#!/usr/bin/env python3\nprint('Hello')\n"),
    ];
    
    for (path, content) in files {
        let full_path = temp_dir.path().join(path);
        fs::write(&full_path, content).unwrap();
    }
    
    // Test reading each file
    for (path, expected_content) in files.iter() {
        let full_path = temp_dir.path().join(path);
        let result = file_read_content(
            full_path.to_str().unwrap().to_string(),
            Some(1000),
        ).await.unwrap();
        
        assert_eq!(result.name, path);
        assert!(result.content.len() > 0);
        assert!(!result.truncated || expected_content.len() > 1000);
        
        if path.ends_with(".txt") {
            assert_eq!(result.mime_type, "text/plain");
        } else if path.ends_with(".json") {
            assert_eq!(result.mime_type, "application/json");
        } else if path.ends_with(".py") {
            assert_eq!(result.mime_type, "text/x-source");
        }
    }
}

#[tokio::test]
async fn test_search_with_special_characters() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    let special_files = vec![
        ("file with spaces.txt", "content with spaces"),
        ("file-with-dashes.txt", "content with dashes"),
        ("file_with_underscores.txt", "content with underscores"),
        ("file.with.dots.txt", "content with dots"),
        ("file(1).txt", "content with parentheses"),
        ("file[1].txt", "content with brackets"),
        ("file'1'.txt", "content with quotes"),
        ("file@1.txt", "content with at symbol"),
    ];
    
    for (path, content) in special_files {
        fs::write(temp_dir.path().join(path), content).unwrap();
    }
    
    // Test searching for files with special characters
    let test_cases = vec![
        ("spaces", 1),
        ("dashes", 1),
        ("underscores", 1),
        ("dots", 1),
        ("file", 8), // Should match all files
    ];
    
    for (query, expected_count) in test_cases {
        let result = file_search(
            query.to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(20),
            Some(5),
        ).await.unwrap();
        
        assert_eq!(result.total_found, expected_count, 
            "Query '{}' should find {} files, found {}", query, expected_count, result.total_found);
    }
}

#[tokio::test]
async fn test_deep_directory_structure() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    // Create a deep nested structure
    let mut current_path = temp_dir.path().to_path_buf();
    for depth in 0..20 {
        current_path = current_path.join(format!("level_{}", depth));
        fs::create_dir_all(&current_path).unwrap();
        
        let file_path = current_path.join(format!("file_{}.txt", depth));
        fs::write(&file_path, format!("Content at depth {}", depth)).unwrap();
    }
    
    // Test with different depth limits
    let depth_tests = vec![
        (5, 6),   // Should find files from levels 0-5
        (10, 11), // Should find files from levels 0-10
        (25, 20), // Should find all files (max depth is 20)
    ];
    
    for (max_depth, expected_count) in depth_tests {
        let result = file_search(
            "file".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(50),
            Some(max_depth),
        ).await.unwrap();
        
        assert_eq!(result.total_found, expected_count, 
            "Depth {} should find {} files, found {}", max_depth, expected_count, result.total_found);
    }
}

#[tokio::test]
async fn test_concurrent_search_safety() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    
    // Create test files
    for i in 0..100 {
        let file_path = temp_dir.path().join(format!("file_{}.txt", i));
        fs::write(&file_path, format!("Content {}", i)).unwrap();
    }
    
    // Run multiple searches concurrently
    let search_futures = vec![
        file_search("file".to_string(), Some(temp_dir.path().to_str().unwrap().to_string()), None, Some(50), Some(5)),
        file_search("".to_string(), Some(temp_dir.path().to_str().unwrap().to_string()), Some(vec!["txt".to_string()]), Some(50), Some(5)),
        file_search("Content".to_string(), Some(temp_dir.path().to_str().unwrap().to_string()), None, Some(50), Some(5)),
    ];
    
    let results = futures::future::join_all(search_futures).await;
    
    // All searches should complete successfully
    for result in results {
        assert!(result.is_ok(), "Concurrent search should succeed");
        let search_result = result.unwrap();
        assert!(search_result.total_found > 0, "Should find files");
    }
}

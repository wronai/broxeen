use std::fs;
use std::path::PathBuf;
use broxeen::file_search::{file_search, file_read_content};
use tempfile::TempDir;

#[tokio::test]
async fn test_edge_case_empty_directory() {
    let temp_dir = TempDir::new().unwrap();
    
    // Test search in empty directory
    let result = file_search(
        "test".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 0);
    assert_eq!(result.results.len(), 0);
    assert!(!result.truncated);
    assert_eq!(result.search_path, temp_dir.path().to_str().unwrap());
}

#[tokio::test]
async fn test_edge_case_permission_denied() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create a file with restricted permissions (if possible on the system)
    let restricted_file = temp_dir.path().join("restricted.txt");
    fs::write(&restricted_file, "restricted content").unwrap();
    
    // Try to remove read permissions (may not work on all systems)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&restricted_file).unwrap().permissions();
        perms.set_mode(0o000); // No permissions
        fs::set_permissions(&restricted_file, perms).unwrap();
    }
    
    // Search should still work, just skip the restricted file
    let result = file_search(
        "restricted".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    // Should not crash, may or may not find the file depending on system
    assert!(result.total_found >= 0);
}

#[tokio::test]
async fn test_edge_case_very_long_filenames() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create file with very long name
    let long_name = "a".repeat(200) + ".txt";
    let long_file = temp_dir.path().join(&long_name);
    fs::write(&long_file, "long filename content").unwrap();
    
    let result = file_search(
        "a".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 1);
    assert_eq!(result.results[0].name, long_name);
    assert_eq!(result.results[0].extension, "txt");
}

#[tokio::test]
async fn test_edge_case_unicode_filenames() {
    let temp_dir = TempDir::new().unwrap();
    
    let unicode_files = vec![
        ("plik_ze_żółcią.txt", "Content with żółć"),
        ("файл.txt", "Content with Cyrillic"),
        ("ファイル.txt", "Content with Japanese"),
        ("🚀rocket.txt", "Content with emoji"),
        ("测试.txt", "Content with Chinese"),
    ];
    
    for (filename, content) in unicode_files {
        let file_path = temp_dir.path().join(filename);
        fs::write(&file_path, content).unwrap();
    }
    
    let result = file_search(
        "rocket".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 1);
    assert!(result.results[0].name.contains("rocket"));
    assert!(result.results[0].path.contains("🚀rocket"));
}

#[tokio::test]
async fn test_edge_case_special_characters_in_paths() {
    let temp_dir = TempDir::new().unwrap();
    
    let special_dirs = vec![
        ("dir with spaces", "file in spaces.txt"),
        ("dir-with-dashes", "file-with-dashes.txt"),
        ("dir_with_underscores", "file_with_underscores.txt"),
        ("dir.with.dots", "file.with.dots.txt"),
        ("dir(parentheses)", "file(parentheses).txt"),
        ("dir[brackets]", "file[brackets].txt"),
        ("dir'quotes'", "file'quotes'.txt"),
        ("dir@symbol", "file@symbol.txt"),
    ];
    
    for (dir_name, file_name) in special_dirs {
        let dir_path = temp_dir.path().join(dir_name);
        fs::create_dir_all(&dir_path).unwrap();
        let file_path = dir_path.join(file_name);
        fs::write(&file_path, format!("Content in {}", dir_name)).unwrap();
    }
    
    let result = file_search(
        "file".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(20),
        Some(8),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 8);
    
    // Verify all special characters are handled correctly
    for file_result in &result.results {
        assert!(!file_result.path.is_empty());
        assert!(!file_result.name.is_empty());
        assert!(file_result.size_bytes > 0);
    }
}

#[tokio::test]
async fn test_edge_case_binary_files_with_null_bytes() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create binary file with null bytes
    let binary_data = vec![0x00, 0x01, 0x02, 0x00, 0xFF, 0xFE, 0x00];
    let binary_file = temp_dir.path().join("binary.bin");
    fs::write(&binary_file, binary_data).unwrap();
    
    let result = file_search(
        "binary".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 1);
    assert_eq!(result.results[0].name, "binary.bin");
    assert_eq!(result.results[0].mime_type, "application/octet-stream");
}

#[tokio::test]
async fn test_edge_case_very_large_file() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create a large file (> 1MB)
    let large_content = "A".repeat(2_000_000); // 2MB
    let large_file = temp_dir.path().join("large.txt");
    fs::write(&large_file, large_content).unwrap();
    
    let result = file_search(
        "large".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 1);
    assert_eq!(result.results[0].name, "large.txt");
    assert_eq!(result.results[0].size_bytes, 2_000_000);
    
    // Preview should be None for files > 1MB
    assert!(result.results[0].preview.is_none());
}

#[tokio::test]
async fn test_edge_case_symlink_handling() {
    let temp_dir = TempDir::new().unwrap();
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        
        // Create a regular file
        let target_file = temp_dir.path().join("target.txt");
        fs::write(&target_file, "target content").unwrap();
        
        // Create a symlink to it
        let symlink_file = temp_dir.path().join("symlink.txt");
        symlink(&target_file, &symlink_file).unwrap();
        
        let result = file_search(
            "symlink".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(10),
            Some(5),
        ).await.unwrap();
        
        // Should find the symlink
        assert_eq!(result.total_found, 1);
        assert!(result.results[0].name.contains("symlink"));
    }
}

#[tokio::test]
async fn test_edge_case_hidden_files() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create hidden files (starting with .)
    let hidden_files = vec![
        ".hidden.txt",
        ".config.json",
        ".env",
        ".gitignore",
    ];
    
    for filename in hidden_files {
        let file_path = temp_dir.path().join(filename);
        fs::write(&file_path, format!("Content of {}", filename)).unwrap();
    }
    
    // Also create .env which should be allowed
    let result = file_search(
        ".env".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    // Should find .env (it's explicitly allowed)
    assert_eq!(result.total_found, 1);
    assert_eq!(result.results[0].name, ".env");
    
    // Should not find other hidden files
    let result2 = file_search(
        "hidden".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result2.total_found, 0);
}

#[tokio::test]
async fn test_edge_case_circular_symlinks() {
    let temp_dir = TempDir::new().unwrap();
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        
        // Create circular symlinks
        let symlink1 = temp_dir.path().join("link1");
        let symlink2 = temp_dir.path().join("link2");
        
        // Create circular references
        symlink(&symlink2, &symlink1).unwrap();
        symlink(&symlink1, &symlink2).unwrap();
        
        // Search should not hang or crash
        let start = std::time::Instant::now();
        let result = file_search(
            "link".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(10),
            Some(5),
        ).await.unwrap();
        let duration = start.elapsed();
        
        // Should complete quickly and not crash
        assert!(duration.as_millis() < 1000, "Search with circular symlinks should not hang");
        assert!(result.total_found >= 0); // May find 0 or some files, but shouldn't crash
    }
}

#[tokio::test]
async fn test_edge_case_file_read_nonexistent() {
    let result = file_read_content(
        "/nonexistent/path/file.txt".to_string(),
        Some(100),
    ).await;
    
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("nie istnieje"));
}

#[tokio::test]
async fn test_edge_case_file_read_directory() {
    let temp_dir = TempDir::new().unwrap();
    
    let result = file_read_content(
        temp_dir.path().to_str().unwrap().to_string(),
        Some(100),
    ).await;
    
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("katalogiem"));
}

#[tokio::test]
async fn test_edge_case_file_read_permission_denied() {
    let temp_dir = TempDir::new().unwrap();
    let test_file = temp_dir.path().join("test.txt");
    fs::write(&test_file, "test content").unwrap();
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&test_file).unwrap().permissions();
        perms.set_mode(0o000); // No permissions
        fs::set_permissions(&test_file, perms).unwrap();
        
        let result = file_read_content(
            test_file.to_str().unwrap().to_string(),
            Some(100),
        ).await;
        
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Nie można odczytać"));
    }
}

#[tokio::test]
async fn test_edge_case_zero_length_files() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create empty files
    let empty_files = vec!["empty.txt", "empty.json", "empty.md"];
    
    for filename in empty_files {
        let file_path = temp_dir.path().join(filename);
        fs::write(&file_path, "").unwrap();
    }
    
    let result = file_search(
        "empty".to_string(),
        Some(temp_dir.path().to_str().unwrap().to_string()),
        None,
        Some(10),
        Some(5),
    ).await.unwrap();
    
    assert_eq!(result.total_found, 3);
    
    for file_result in &result.results {
        assert_eq!(file_result.size_bytes, 0);
        assert!(file_result.preview.is_some()); // Empty files should have preview
        assert_eq!(file_result.preview.unwrap(), ""); // But preview should be empty
    }
}

#[tokio::test]
async fn test_edge_case_invalid_search_path() {
    let invalid_paths = vec![
        "",
        "/nonexistent",
        "/root/nonexistent", // May not exist or be inaccessible
        "\0\0\0", // Null bytes
    ];
    
    for path in invalid_paths {
        let result = file_search(
            "test".to_string(),
            Some(path.to_string()),
            None,
            Some(10),
            Some(5),
        ).await;
        
        // Should handle gracefully
        assert!(result.is_err());
    }
}

#[tokio::test]
async fn test_edge_case_extreme_depth_limit() {
    let temp_dir = TempDir::new().unwrap();
    
    // Create a moderately deep structure
    let mut current_path = temp_dir.path().to_path_buf();
    for i in 0..5 {
        current_path = current_path.join(format!("level_{}", i));
        fs::create_dir_all(&current_path).unwrap();
        let file_path = current_path.join(format!("file_{}.txt", i));
        fs::write(&file_path, format!("Content at level {}", i)).unwrap();
    }
    
    // Test with extreme depth limits
    let test_cases = vec![
        (0, "zero depth"),
        (1, "depth 1"),
        (1000, "very large depth"),
        (usize::MAX, "maximum depth"),
    ];
    
    for (depth, description) in test_cases {
        let result = file_search(
            "file".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(10),
            Some(depth),
        ).await.unwrap();
        
        // Should not crash with extreme values
        assert!(result.total_found >= 0, "Search with {} should not crash", description);
        
        if depth == 0 {
            assert_eq!(result.total_found, 0, "Depth 0 should find no files");
        }
    }
}

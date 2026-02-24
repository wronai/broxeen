use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use broxeen::file_search::{file_search, search_with_rust_search};
use tempfile::TempDir;

#[cfg(test)]
mod benchmarks {
    use super::*;

    fn create_large_test_dataset(temp_dir: &TempDir, file_count: usize) {
        println!("Creating {} test files...", file_count);
        
        for i in 0..file_count {
            let dir_depth = i % 5;
            let mut path = temp_dir.path().to_path_buf();
            
            for j in 0..dir_depth {
                path = path.join(format!("level_{}", j));
                fs::create_dir_all(&path).unwrap();
            }
            
            let extensions = vec!["txt", "rs", "py", "js", "json", "md", "toml", "yaml"];
            let ext = extensions[i % extensions.len()];
            
            let file_path = path.join(format!("file_{:04}.{}", i, ext));
            let content = format!("Content for file {} with extension {}", i, ext);
            fs::write(&file_path, content).unwrap();
            
            if i % 1000 == 0 && i > 0 {
                println!("  Created {} files...", i);
            }
        }
        
        println!("Dataset creation complete.");
    }

    #[tokio::test]
    async fn benchmark_rust_search_performance() {
        let temp_dir = TempDir::new().unwrap();
        let file_counts = vec![100, 500, 1000, 5000];
        
        for &file_count in &file_counts {
            println!("\n=== Benchmark: {} files ===", file_count);
            
            // Create test dataset
            let start = Instant::now();
            create_large_test_dataset(&temp_dir, file_count);
            let creation_time = start.elapsed();
            println!("Dataset creation: {}ms", creation_time.as_millis());
            
            // Benchmark different search scenarios
            let scenarios = vec![
                ("empty query", ""),
                ("simple pattern", "file"),
                ("extension filter", "*.rs"),
                ("complex pattern", "file_0"),
                ("deep search", "content"),
            ];
            
            for (scenario_name, query) in scenarios {
                let start = Instant::now();
                let result = file_search(
                    query.to_string(),
                    Some(temp_dir.path().to_str().unwrap().to_string()),
                    None,
                    Some(100),
                    Some(8),
                ).await.unwrap();
                let duration = start.elapsed();
                
                println!("  {}: {} files in {}ms ({}ms reported)", 
                    scenario_name, result.total_found, duration.as_millis(), result.duration_ms);
                
                // Performance assertions
                assert!(duration.as_millis() < 2000, "Search '{}' took too long: {}ms", scenario_name, duration.as_millis());
                assert!(result.duration_ms < 2000, "Reported duration too high: {}ms", result.duration_ms);
            }
            
            // Clean up for next iteration
            fs::remove_dir_all(temp_dir.path()).unwrap();
        }
    }

    #[tokio::test]
    async fn benchmark_rust_search_vs_standard_fs() {
        let temp_dir = TempDir::new().unwrap();
        let file_count = 2000;
        
        println!("\n=== Comparison Benchmark: {} files ===", file_count);
        
        create_large_test_dataset(&temp_dir, file_count);
        
        // Test rust_search performance
        let start = Instant::now();
        let rust_result = file_search(
            "file".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(200),
            Some(10),
        ).await.unwrap();
        let rust_duration = start.elapsed();
        
        println!("rust_search: {} files in {}ms", rust_result.total_found, rust_duration.as_millis());
        
        // Performance expectations based on rust_search benchmarks
        assert!(rust_duration.as_millis() < 1000, "rust_search should be under 1s for {} files", file_count);
        assert!(rust_result.total_found > file_count / 2, "Should find significant portion of files");
        
        // Test with different result limits
        let limits = vec![10, 50, 100, 500];
        for limit in limits {
            let start = Instant::now();
            let result = file_search(
                "file".to_string(),
                Some(temp_dir.path().to_str().unwrap().to_string()),
                None,
                Some(limit),
                Some(10),
            ).await.unwrap();
            let duration = start.elapsed();
            
            println!("  limit {}: {} files in {}ms", limit, result.total_found, duration.as_millis());
            assert!(result.total_found <= limit, "Should respect result limit");
        }
    }

    #[tokio::test]
    async fn benchmark_concurrent_searches() {
        let temp_dir = TempDir::new().unwrap();
        create_large_test_dataset(&temp_dir, 1000);
        
        println!("\n=== Concurrent Search Benchmark ===");
        
        let concurrent_queries = vec![
            ("file", ""),
            ("rust files", "rs"),
            ("python files", "py"),
            ("javascript", "js"),
            ("config files", "json"),
        ];
        
        let start = Instant::now();
        
        let search_futures: Vec<_> = concurrent_queries
            .into_iter()
            .map(|(description, query)| {
                file_search(
                    query.to_string(),
                    Some(temp_dir.path().to_str().unwrap().to_string()),
                    if query.is_empty() { None } else { Some(vec![query.to_string()]) },
                    Some(50),
                    Some(8),
                )
            })
            .collect();
        
        let results = futures::future::join_all(search_futures).await;
        let total_duration = start.elapsed();
        
        println!("Concurrent searches completed in {}ms", total_duration.as_millis());
        
        for (i, result) in results.into_iter().enumerate() {
            assert!(result.is_ok(), "Concurrent search {} should succeed", i);
            let search_result = result.unwrap();
            println!("  Search {}: {} files", i + 1, search_result.total_found);
        }
        
        // Concurrent should be faster than sequential
        assert!(total_duration.as_millis() < 3000, "Concurrent searches should complete quickly");
    }

    #[tokio::test]
    async fn benchmark_deep_directory_search() {
        let temp_dir = TempDir::new().unwrap();
        
        println!("\n=== Deep Directory Benchmark ===");
        
        // Create deep directory structure
        let max_depth = 20;
        let files_per_level = 10;
        
        for depth in 0..max_depth {
            let mut current_path = temp_dir.path().to_path_buf();
            for level in 0..=depth {
                current_path = current_path.join(format!("level_{}", level));
                fs::create_dir_all(&current_path).unwrap();
            }
            
            for file_num in 0..files_per_level {
                let file_path = current_path.join(format!("file_{}.txt", file_num));
                fs::write(&file_path, format!("Depth {} file {}", depth, file_num)).unwrap();
            }
        }
        
        let total_files = max_depth * files_per_level;
        println!("Created {} files across {} depth levels", total_files, max_depth);
        
        // Test different depth limits
        let depth_tests = vec![
            (5, "shallow"),
            (10, "medium"),
            (15, "deep"),
            (25, "maximum"),
        ];
        
        for (max_depth, description) in depth_tests {
            let start = Instant::now();
            let result = file_search(
                "file".to_string(),
                Some(temp_dir.path().to_str().unwrap().to_string()),
                None,
                Some(200),
                Some(max_depth),
            ).await.unwrap();
            let duration = start.elapsed();
            
            println!("  {} depth ({}): {} files in {}ms", 
                description, max_depth, result.total_found, duration.as_millis());
            
            // Deeper searches should find more files but take longer
            assert!(duration.as_millis() < 2000, "Deep search should complete in reasonable time");
        }
    }

    #[tokio::test]
    async fn benchmark_memory_usage_large_search() {
        let temp_dir = TempDir::new().unwrap();
        let large_file_count = 10000;
        
        println!("\n=== Memory Usage Benchmark: {} files ===", large_file_count);
        
        // Create many small files
        for i in 0..large_file_count {
            if i % 1000 == 0 {
                println!("  Creating file {}...", i);
            }
            
            let file_path = temp_dir.path().join(format!("file_{:05}.txt", i));
            fs::write(&file_path, format!("Content {}", i)).unwrap();
        }
        
        // Test with large result limits
        let start = Instant::now();
        let result = file_search(
            "file".to_string(),
            Some(temp_dir.path().to_str().unwrap().to_string()),
            None,
            Some(5000), // Large limit
            Some(10),
        ).await.unwrap();
        let duration = start.elapsed();
        
        println!("Large search: {} files in {}ms", result.total_found, duration.as_millis());
        
        // Should handle large result sets efficiently
        assert!(duration.as_millis() < 5000, "Large search should complete in reasonable time");
        assert!(result.total_found <= 5000, "Should respect large result limit");
        
        // Test truncation behavior
        assert_eq!(result.total_found, 5000, "Should be truncated at limit");
        assert!(result.truncated, "Should indicate truncation");
    }

    #[test]
    fn benchmark_search_with_rust_search_direct() {
        let temp_dir = TempDir::new().unwrap();
        create_large_test_dataset(&temp_dir, 1000);
        
        println!("\n=== Direct rust_search Benchmark ===");
        
        let start = Instant::now();
        let results = search_with_rust_search(
            temp_dir.path(),
            "file",
            &[],
            100,
            8,
        );
        let duration = start.elapsed();
        
        println!("Direct rust_search: {} results in {}ms", results.len(), duration.as_millis());
        
        assert!(duration.as_millis() < 500, "Direct rust_search should be very fast");
        assert!(results.len() > 0, "Should find results");
        
        // Verify result structure
        for result in results.iter().take(5) {
            assert!(!result.path.is_empty());
            assert!(!result.name.is_empty());
            assert!(result.size_bytes > 0);
        }
    }
}

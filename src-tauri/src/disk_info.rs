/**
 * Disk information commands for Tauri backend.
 * Provides: get_disk_info, get_disk_partitions, get_disk_usage
 */

use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::logging::backend_info;

// ─── Disk Partition ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskPartition {
    pub device: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub use_percent: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiskInfo {
    pub hostname: String,
    pub partitions: Vec<DiskPartition>,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub use_percent: f32,
}

#[tauri::command]
pub async fn get_disk_info() -> Result<DiskInfo, String> {
    backend_info("Command get_disk_info invoked");

    let hostname = get_hostname();
    let partitions = parse_df_output()?;

    let total_bytes: u64 = partitions.iter().map(|p| p.total_bytes).sum();
    let used_bytes: u64 = partitions.iter().map(|p| p.used_bytes).sum();
    let available_bytes: u64 = partitions.iter().map(|p| p.available_bytes).sum();
    let use_percent = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64 * 100.0) as f32
    } else {
        0.0
    };

    backend_info(format!(
        "get_disk_info: {} partitions, total={}GB, used={}GB ({}%)",
        partitions.len(),
        total_bytes / 1_073_741_824,
        used_bytes / 1_073_741_824,
        use_percent as u32
    ));

    Ok(DiskInfo {
        hostname,
        partitions,
        total_bytes,
        used_bytes,
        available_bytes,
        use_percent,
    })
}

#[tauri::command]
pub async fn get_disk_usage(path: Option<String>) -> Result<DiskPartition, String> {
    let target = path.unwrap_or_else(|| "/".to_string());
    backend_info(format!("Command get_disk_usage invoked for path: {}", target));

    let output = Command::new("df")
        .args(["-B1", &target])
        .output()
        .map_err(|e| format!("Failed to run df: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("df failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let lines: Vec<&str> = stdout.lines().collect();

    if lines.len() < 2 {
        return Err("Unexpected df output format".to_string());
    }

    parse_df_line(lines[1])
}

fn parse_df_output() -> Result<Vec<DiskPartition>, String> {
    let output = Command::new("df")
        .args(["-B1", "--output=source,target,fstype,size,used,avail,pcent", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs", "-x", "overlay"])
        .output()
        .map_err(|e| format!("Failed to run df: {}", e))?;

    if !output.status.success() {
        // Fallback: simpler df
        return parse_df_simple();
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut partitions = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 7 {
            let device = parts[0].to_string();
            // Skip pseudo-filesystems
            if device.starts_with("/dev/") || device.starts_with("/") {
                let total_bytes = parts[3].parse::<u64>().unwrap_or(0);
                let used_bytes = parts[4].parse::<u64>().unwrap_or(0);
                let available_bytes = parts[5].parse::<u64>().unwrap_or(0);
                let use_pct_str = parts[6].trim_end_matches('%');
                let use_percent = use_pct_str.parse::<f32>().unwrap_or(0.0);

                partitions.push(DiskPartition {
                    device,
                    mount_point: parts[1].to_string(),
                    fs_type: parts[2].to_string(),
                    total_bytes,
                    used_bytes,
                    available_bytes,
                    use_percent,
                });
            }
        }
    }

    Ok(partitions)
}

fn parse_df_simple() -> Result<Vec<DiskPartition>, String> {
    let output = Command::new("df")
        .args(["-B1"])
        .output()
        .map_err(|e| format!("Failed to run df: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut partitions = Vec::new();

    for line in stdout.lines().skip(1) {
        if let Ok(p) = parse_df_line(line) {
            if p.device.starts_with("/dev/") {
                partitions.push(p);
            }
        }
    }

    Ok(partitions)
}

fn parse_df_line(line: &str) -> Result<DiskPartition, String> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 6 {
        return Err("Invalid df line format".to_string());
    }

    let total_bytes = parts[1].parse::<u64>().unwrap_or(0);
    let used_bytes = parts[2].parse::<u64>().unwrap_or(0);
    let available_bytes = parts[3].parse::<u64>().unwrap_or(0);
    let use_pct_str = parts[4].trim_end_matches('%');
    let use_percent = use_pct_str.parse::<f32>().unwrap_or(0.0);

    Ok(DiskPartition {
        device: parts[0].to_string(),
        mount_point: parts[5].to_string(),
        fs_type: "unknown".to_string(),
        total_bytes,
        used_bytes,
        available_bytes,
        use_percent,
    })
}

fn get_hostname() -> String {
    Command::new("hostname")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_df_line() {
        let line = "/dev/sda1   500107862016 234567890 265539972126  47% /";
        let result = parse_df_line(line);
        assert!(result.is_ok());
        let p = result.unwrap();
        assert_eq!(p.device, "/dev/sda1");
        assert_eq!(p.mount_point, "/");
        assert_eq!(p.use_percent, 47.0);
    }

    #[test]
    fn test_get_hostname() {
        let hostname = get_hostname();
        assert!(!hostname.is_empty());
    }
}

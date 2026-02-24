use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteMachine {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AuthType {
    Password { password: String },
    Key { private_key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteSystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub uptime: String,
    pub cpu_count: u32,
    pub memory_total: String,
    pub disk_usage: Vec<DiskUsage>,
    pub network_interfaces: Vec<NetworkInterface>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiskUsage {
    pub filesystem: String,
    pub size: String,
    pub used: String,
    pub available: String,
    pub usage_percent: u8,
    pub mountpoint: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip_addresses: Vec<String>,
    pub mac_address: Option<String>,
    pub is_up: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteProcess {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub status: String,
    pub user: String,
    pub command: String,
}

#[tauri::command]
pub async fn remote_test_connection(machine: RemoteMachine) -> Result<bool, String> {
    let mut cmd = Command::new("ssh");
    cmd.arg("-o")
        .arg("ConnectTimeout=5")
        .arg("-o")
        .arg("BatchMode=yes");

    match &machine.auth_type {
        AuthType::Password { .. } => {
            return Err("Password authentication not supported for connection test. Use SSH key authentication.".to_string());
        }
        AuthType::Key { private_key_path, passphrase: _ } => {
            cmd.arg("-i").arg(private_key_path);
        }
    }

    cmd.arg(format!("{}@{}", machine.username, machine.host))
        .arg("echo")
        .arg("connection_test");

    let output = cmd.output().map_err(|e| format!("SSH command failed: {}", e))?;

    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).contains("connection_test"))
}

#[tauri::command]
pub async fn remote_execute_command(
    machine: RemoteMachine,
    command: String,
) -> Result<RemoteCommandResult, String> {
    let mut cmd = Command::new("ssh");
    
    match &machine.auth_type {
        AuthType::Password { password: _ } => {
            // For password auth, we'd need sshpass or similar
            return Err("Password authentication requires sshpass or similar tool".to_string());
        }
        AuthType::Key { private_key_path, .. } => {
            cmd.arg("-i").arg(private_key_path);
        }
    }

    cmd.arg("-o")
        .arg("ConnectTimeout=10")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg(format!("{}@{}", machine.username, machine.host))
        .arg(&command);

    let output = cmd.output().map_err(|e| format!("SSH command failed: {}", e))?;

    Ok(RemoteCommandResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
    })
}

#[tauri::command]
pub async fn remote_get_system_info(machine: RemoteMachine) -> Result<RemoteSystemInfo, String> {
    let script = r#"
        hostname=$(hostname)
        os=$(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2 || echo "Unknown")
        kernel=$(uname -r)
        uptime=$(uptime -p 2>/dev/null || uptime)
        cpu_count=$(nproc)
        memory_total=$(free -h | awk '/^Mem:/ {print $2}')
        
        echo "hostname:$hostname"
        echo "os:$os"
        echo "kernel:$kernel"
        echo "uptime:$uptime"
        echo "cpu_count:$cpu_count"
        echo "memory_total:$memory_total"
        
        # Disk usage
        df -h | grep -E '^/dev/' | while read filesystem size used avail use_percent mountpoint; do
            echo "disk:$filesystem:$size:$used:$avail:${use_percent%?}:$mountpoint"
        done
        
        # Network interfaces
        ip addr show | grep -E '^[0-9]+:' | cut -d':' -f2 | tr -d ' ' | while read iface; do
            if [ "$iface" != "lo" ]; then
                ip_addr=$(ip addr show "$iface" | grep 'inet ' | awk '{print $2}' | tr '\n' ',' | sed 's/,$//')
                mac_addr=$(ip link show "$iface" | grep 'link/ether' | awk '{print $2}' | head -1)
                is_up=$(ip link show "$iface" | grep -q 'UP' && echo "true" || echo "false")
                echo "interface:$iface:$ip_addr:$mac_addr:$is_up"
            fi
        done
    "#;

    let result = remote_execute_command(machine, script.to_string()).await?;

    if !result.success {
        return Err(format!("Failed to get system info: {}", result.stderr));
    }

    let mut hostname = String::new();
    let mut os = String::new();
    let mut kernel = String::new();
    let mut uptime = String::new();
    let mut cpu_count = 0;
    let mut memory_total = String::new();
    let mut disk_usage = Vec::new();
    let mut network_interfaces = Vec::new();

    for line in result.stdout.lines() {
        if line.starts_with("hostname:") {
            hostname = line.strip_prefix("hostname:").unwrap_or("").to_string();
        } else if line.starts_with("os:") {
            os = line.strip_prefix("os:").unwrap_or("").to_string();
        } else if line.starts_with("kernel:") {
            kernel = line.strip_prefix("kernel:").unwrap_or("").to_string();
        } else if line.starts_with("uptime:") {
            uptime = line.strip_prefix("uptime:").unwrap_or("").to_string();
        } else if line.starts_with("cpu_count:") {
            cpu_count = line.strip_prefix("cpu_count:").unwrap_or("").parse().unwrap_or(0);
        } else if line.starts_with("memory_total:") {
            memory_total = line.strip_prefix("memory_total:").unwrap_or("").to_string();
        } else if line.starts_with("disk:") {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 6 {
                disk_usage.push(DiskUsage {
                    filesystem: parts[1].to_string(),
                    size: parts[2].to_string(),
                    used: parts[3].to_string(),
                    available: parts[4].to_string(),
                    usage_percent: parts[5].parse().unwrap_or(0),
                    mountpoint: parts[6].to_string(),
                });
            }
        } else if line.starts_with("interface:") {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 5 {
                network_interfaces.push(NetworkInterface {
                    name: parts[1].to_string(),
                    ip_addresses: parts[2].split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect(),
                    mac_address: if parts[3].is_empty() { None } else { Some(parts[3].to_string()) },
                    is_up: parts[4] == "true",
                });
            }
        }
    }

    Ok(RemoteSystemInfo {
        hostname,
        os,
        kernel,
        uptime,
        cpu_count,
        memory_total,
        disk_usage,
        network_interfaces,
    })
}

#[tauri::command]
pub async fn remote_list_processes(machine: RemoteMachine) -> Result<Vec<RemoteProcess>, String> {
    let script = r#"
        ps aux --no-headers | awk '{print $2 " " $1 " " $11 " " $3 " " $4 " " $8 " " $0}' | head -50
    "#;

    let result = remote_execute_command(machine, script.to_string()).await?;

    if !result.success {
        return Err(format!("Failed to list processes: {}", result.stderr));
    }

    let mut processes = Vec::new();

    for line in result.stdout.lines() {
        let parts: Vec<&str> = line.splitn(8, ' ').collect();
        if parts.len() >= 7 {
            let pid: u32 = parts[0].parse().unwrap_or(0);
            let user = parts[1].to_string();
            let command = parts[2].to_string();
            let cpu_percent: f32 = parts[3].parse().unwrap_or(0.0);
            let memory_percent: f32 = parts[4].parse().unwrap_or(0.0);
            let status = parts[5].to_string();
            let full_command = parts[6].to_string();

            processes.push(RemoteProcess {
                pid,
                name: command,
                cpu_percent,
                memory_percent,
                status,
                user,
                command: full_command,
            });
        }
    }

    Ok(processes)
}

#[tauri::command]
pub async fn remote_copy_file(
    machine: RemoteMachine,
    local_path: String,
    remote_path: String,
    direction: String, // "upload" or "download"
) -> Result<String, String> {
    let mut cmd = Command::new("scp");

    match &machine.auth_type {
        AuthType::Password { .. } => {
            return Err("Password authentication not supported for SCP".to_string());
        }
        AuthType::Key { private_key_path, .. } => {
            cmd.arg("-i").arg(private_key_path);
        }
    }

    cmd.arg("-o").arg("ConnectTimeout=10").arg("-o").arg("BatchMode=yes");

    if direction == "upload" {
        cmd.arg(&local_path)
            .arg(format!("{}@{}:{}", machine.username, machine.host, remote_path));
    } else {
        cmd.arg(format!("{}@{}:{}", machine.username, machine.host, local_path))
            .arg(&remote_path);
    }

    let output = cmd.output().map_err(|e| format!("SCP command failed: {}", e))?;

    if !output.status.success() {
        return Err(format!("SCP failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(format!("File copied successfully ({})", direction))
}

#[tauri::command]
pub async fn remote_check_docker(machine: RemoteMachine) -> Result<bool, String> {
    let result = remote_execute_command(machine, "docker --version".to_string()).await?;
    Ok(result.success)
}

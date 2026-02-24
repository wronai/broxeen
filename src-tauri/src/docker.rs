use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: Vec<String>,
    pub created: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub size: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerNetwork {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DockerInfo {
    pub version: String,
    pub containers_running: u32,
    pub containers_total: u32,
    pub images_total: u32,
    pub server_version: String,
}

#[tauri::command]
pub async fn docker_is_available() -> Result<bool, String> {
    let output = Command::new("docker")
        .arg("--version")
        .output()
        .map_err(|e| format!("Docker command failed: {}", e))?;

    Ok(output.status.success())
}

#[tauri::command]
pub async fn docker_info() -> Result<DockerInfo, String> {
    let output = Command::new("docker")
        .arg("info")
        .arg("--format")
        .arg("json")
        .output()
        .map_err(|e| format!("Failed to get Docker info: {}", e))?;

    if !output.status.success() {
        return Err("Docker info command failed".to_string());
    }

    let info_str = String::from_utf8_lossy(&output.stdout);
    let info: serde_json::Value = serde_json::from_str(&info_str)
        .map_err(|e| format!("Failed to parse Docker info: {}", e))?;

    Ok(DockerInfo {
        version: info["ServerVersion"].as_str().unwrap_or("unknown").to_string(),
        containers_running: info["ContainersRunning"].as_u64().unwrap_or(0) as u32,
        containers_total: info["Containers"].as_u64().unwrap_or(0) as u32,
        images_total: info["Images"].as_u64().unwrap_or(0) as u32,
        server_version: info["ServerVersion"].as_str().unwrap_or("unknown").to_string(),
    })
}

#[tauri::command]
pub async fn docker_list_containers(all: bool) -> Result<Vec<DockerContainer>, String> {
    let mut args = vec!["ps", "--format", "{{json .}}"];
    if all {
        args.push("-a");
    }

    let output = Command::new("docker")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to list containers: {}", e))?;

    if !output.status.success() {
        return Err("Docker ps command failed".to_string());
    }

    let containers_str = String::from_utf8_lossy(&output.stdout);
    let mut containers = Vec::new();

    for line in containers_str.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let container: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse container JSON: {}", e))?;

        containers.push(DockerContainer {
            id: container["ID"].as_str().unwrap_or("").to_string(),
            name: container["Names"].as_str().unwrap_or("").to_string(),
            image: container["Image"].as_str().unwrap_or("").to_string(),
            status: container["Status"].as_str().unwrap_or("").to_string(),
            ports: container["Ports"].as_str()
                .unwrap_or("")
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            created: container["CreatedAt"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(containers)
}

#[tauri::command]
pub async fn docker_list_images() -> Result<Vec<DockerImage>, String> {
    let output = Command::new("docker")
        .args(&["images", "--format", "{{json .}}"])
        .output()
        .map_err(|e| format!("Failed to list images: {}", e))?;

    if !output.status.success() {
        return Err("Docker images command failed".to_string());
    }

    let images_str = String::from_utf8_lossy(&output.stdout);
    let mut images = Vec::new();

    for line in images_str.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let image: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse image JSON: {}", e))?;

        images.push(DockerImage {
            id: image["ID"].as_str().unwrap_or("").to_string(),
            repository: image["Repository"].as_str().unwrap_or("").to_string(),
            tag: image["Tag"].as_str().unwrap_or("").to_string(),
            size: image["Size"].as_str().unwrap_or("").to_string(),
            created: image["CreatedAt"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(images)
}

#[tauri::command]
pub async fn docker_list_volumes() -> Result<Vec<DockerVolume>, String> {
    let output = Command::new("docker")
        .args(&["volume", "ls", "--format", "{{json .}}"])
        .output()
        .map_err(|e| format!("Failed to list volumes: {}", e))?;

    if !output.status.success() {
        return Err("Docker volume ls command failed".to_string());
    }

    let volumes_str = String::from_utf8_lossy(&output.stdout);
    let mut volumes = Vec::new();

    for line in volumes_str.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let volume: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse volume JSON: {}", e))?;

        volumes.push(DockerVolume {
            name: volume["Name"].as_str().unwrap_or("").to_string(),
            driver: volume["Driver"].as_str().unwrap_or("").to_string(),
            mountpoint: volume["Mountpoint"].as_str().unwrap_or("").to_string(),
            size: volume["Size"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(volumes)
}

#[tauri::command]
pub async fn docker_list_networks() -> Result<Vec<DockerNetwork>, String> {
    let output = Command::new("docker")
        .args(&["network", "ls", "--format", "{{json .}}"])
        .output()
        .map_err(|e| format!("Failed to list networks: {}", e))?;

    if !output.status.success() {
        return Err("Docker network ls command failed".to_string());
    }

    let networks_str = String::from_utf8_lossy(&output.stdout);
    let mut networks = Vec::new();

    for line in networks_str.lines() {
        if line.trim().is_empty() {
            continue;
        }

        let network: serde_json::Value = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse network JSON: {}", e))?;

        networks.push(DockerNetwork {
            id: network["ID"].as_str().unwrap_or("").to_string(),
            name: network["Name"].as_str().unwrap_or("").to_string(),
            driver: network["Driver"].as_str().unwrap_or("").to_string(),
            scope: network["Scope"].as_str().unwrap_or("").to_string(),
        });
    }

    Ok(networks)
}

#[tauri::command]
pub async fn docker_start_container(container_id: String) -> Result<String, String> {
    let output = Command::new("docker")
        .args(&["start", &container_id])
        .output()
        .map_err(|e| format!("Failed to start container: {}", e))?;

    if !output.status.success() {
        return Err(format!("Failed to start container: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(format!("Container {} started", container_id))
}

#[tauri::command]
pub async fn docker_stop_container(container_id: String) -> Result<String, String> {
    let output = Command::new("docker")
        .args(&["stop", &container_id])
        .output()
        .map_err(|e| format!("Failed to stop container: {}", e))?;

    if !output.status.success() {
        return Err(format!("Failed to stop container: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(format!("Container {} stopped", container_id))
}

#[tauri::command]
pub async fn docker_restart_container(container_id: String) -> Result<String, String> {
    let output = Command::new("docker")
        .args(&["restart", &container_id])
        .output()
        .map_err(|e| format!("Failed to restart container: {}", e))?;

    if !output.status.success() {
        return Err(format!("Failed to restart container: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(format!("Container {} restarted", container_id))
}

#[tauri::command]
pub async fn docker_remove_container(container_id: String, force: bool) -> Result<String, String> {
    let mut args = vec!["rm"];
    if force {
        args.push("-f");
    }
    args.push(&container_id);

    let output = Command::new("docker")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to remove container: {}", e))?;

    if !output.status.success() {
        return Err(format!("Failed to remove container: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(format!("Container {} removed", container_id))
}

#[tauri::command]
pub async fn docker_get_logs(container_id: String, lines: Option<u32>) -> Result<String, String> {
    let output = if let Some(n) = lines {
        Command::new("docker")
            .args(&["logs", "--tail", &n.to_string(), &container_id])
            .output()
            .map_err(|e| format!("Failed to get container logs: {}", e))?
    } else {
        Command::new("docker")
            .args(&["logs", &container_id])
            .output()
            .map_err(|e| format!("Failed to get container logs: {}", e))?
    };

    if !output.status.success() {
        return Err(format!("Failed to get container logs: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

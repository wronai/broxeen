use std::net::IpAddr;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkInfo {
    pub local_ip: String,
    pub subnet: String,
    pub interface_name: String,
}

/// Get local network IP address from active network interface
#[tauri::command]
pub fn get_local_network_info() -> Result<NetworkInfo, String> {
    // Try to get local IP using local-ip-address crate
    match local_ip_address::local_ip() {
        Ok(IpAddr::V4(ip)) => {
            let ip_str = ip.to_string();
            let octets: Vec<&str> = ip_str.split('.').collect();
            
            if octets.len() != 4 {
                return Err("Invalid IPv4 address format".to_string());
            }
            
            // Calculate subnet (first 3 octets)
            let subnet = format!("{}.{}.{}", octets[0], octets[1], octets[2]);
            
            // Try to get interface name
            let interface_name = get_interface_name(&ip_str).unwrap_or_else(|| "unknown".to_string());
            
            Ok(NetworkInfo {
                local_ip: ip_str,
                subnet,
                interface_name,
            })
        }
        Ok(IpAddr::V6(_)) => {
            Err("Only IPv6 available - IPv4 required for network scanning".to_string())
        }
        Err(e) => {
            Err(format!("Failed to detect local IP: {}", e))
        }
    }
}

/// Try to get the name of the network interface for a given IP
fn get_interface_name(target_ip: &str) -> Option<String> {
    use local_ip_address::list_afinet_netifas;
    
    if let Ok(network_interfaces) = list_afinet_netifas() {
        for (name, ip) in network_interfaces.iter() {
            if ip.to_string() == target_ip {
                return Some(name.clone());
            }
        }
    }
    None
}

/// Get all network interfaces with their IPs
#[tauri::command]
pub fn list_network_interfaces() -> Result<Vec<(String, String)>, String> {
    use local_ip_address::list_afinet_netifas;
    
    match list_afinet_netifas() {
        Ok(interfaces) => {
            let result: Vec<(String, String)> = interfaces
                .iter()
                .filter_map(|(name, ip)| {
                    // Filter out loopback and IPv6
                    if name != "lo" && matches!(ip, IpAddr::V4(_)) {
                        Some((name.clone(), ip.to_string()))
                    } else {
                        None
                    }
                })
                .collect();
            Ok(result)
        }
        Err(e) => Err(format!("Failed to list network interfaces: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_local_network_info() {
        let result = get_local_network_info();
        // Should either succeed or fail gracefully
        match result {
            Ok(info) => {
                println!("Local IP: {}", info.local_ip);
                println!("Subnet: {}", info.subnet);
                println!("Interface: {}", info.interface_name);
                
                // Validate format
                assert!(info.local_ip.contains('.'));
                assert!(info.subnet.contains('.'));
                assert_eq!(info.subnet.split('.').count(), 3);
            }
            Err(e) => {
                println!("Failed to get network info: {}", e);
            }
        }
    }

    #[test]
    fn test_list_network_interfaces() {
        let result = list_network_interfaces();
        match result {
            Ok(interfaces) => {
                println!("Found {} interfaces:", interfaces.len());
                for (name, ip) in interfaces {
                    println!("  {} -> {}", name, ip);
                }
            }
            Err(e) => {
                println!("Failed to list interfaces: {}", e);
            }
        }
    }
}

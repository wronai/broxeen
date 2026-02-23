/// Autostart management — enable/disable launching Broxeen at system boot.
///
/// Linux:  ~/.config/autostart/broxeen.desktop
/// macOS:  ~/Library/LaunchAgents/com.broxeen.app.plist  (future)
/// Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run (future)

use crate::logging::{backend_info, backend_warn, backend_error};
use std::fs;
use std::path::PathBuf;

fn autostart_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|c| c.join("autostart"))
}

fn desktop_entry_path() -> Option<PathBuf> {
    autostart_dir().map(|d| d.join("broxeen.desktop"))
}

fn current_exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "broxeen".to_string())
}

fn desktop_entry_content() -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Broxeen\n\
         Comment=Broxeen — Smart Network & Camera Monitor\n\
         Exec={}\n\
         Terminal=false\n\
         StartupNotify=false\n\
         X-GNOME-Autostart-enabled=true\n\
         Categories=Utility;Network;\n",
        current_exe_path()
    )
}

#[tauri::command]
pub fn autostart_enable() -> Result<String, String> {
    backend_info("Enabling autostart...");

    let dir = autostart_dir().ok_or("Cannot determine autostart directory")?;
    let path = desktop_entry_path().ok_or("Cannot determine desktop entry path")?;

    fs::create_dir_all(&dir).map_err(|e| {
        backend_error(format!("Failed to create autostart dir: {}", e));
        format!("Failed to create autostart directory: {}", e)
    })?;

    let content = desktop_entry_content();
    fs::write(&path, &content).map_err(|e| {
        backend_error(format!("Failed to write desktop entry: {}", e));
        format!("Failed to write autostart file: {}", e)
    })?;

    backend_info(format!("Autostart enabled at {}", path.display()));
    Ok(format!("Autostart enabled: {}", path.display()))
}

#[tauri::command]
pub fn autostart_disable() -> Result<String, String> {
    backend_info("Disabling autostart...");

    let path = match desktop_entry_path() {
        Some(p) => p,
        None => return Ok("Autostart not configured (no config dir)".to_string()),
    };

    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            backend_error(format!("Failed to remove desktop entry: {}", e));
            format!("Failed to remove autostart file: {}", e)
        })?;
        backend_info(format!("Autostart disabled, removed {}", path.display()));
        Ok("Autostart disabled".to_string())
    } else {
        Ok("Autostart was already disabled".to_string())
    }
}

#[tauri::command]
pub fn autostart_status() -> Result<bool, String> {
    let path = match desktop_entry_path() {
        Some(p) => p,
        None => return Ok(false),
    };
    Ok(path.exists())
}

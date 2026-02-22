/// Structured backend logging utilities.
///
/// Provides consistent log output format for the Tauri backend.

pub fn backend_info(message: impl AsRef<str>) {
    println!("[backend][INFO] {}", message.as_ref());
}

pub fn backend_warn(message: impl AsRef<str>) {
    println!("[backend][WARN] {}", message.as_ref());
}

pub fn backend_error(message: impl AsRef<str>) {
    eprintln!("[backend][ERROR] {}", message.as_ref());
}

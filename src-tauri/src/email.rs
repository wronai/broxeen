use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;

use crate::logging::{backend_info, backend_warn, backend_error};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_password: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub from_address: String,
    pub use_tls: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailMessage {
    pub id: String,
    pub from: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub date: Option<String>,
    pub has_attachments: bool,
    pub is_read: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmailSendRequest {
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub attachments: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InboxSummary {
    pub total_messages: usize,
    pub unread_count: usize,
    pub recent_messages: Vec<EmailMessage>,
    pub summary_text: String,
    pub poll_time: String,
}

/// Send email using system `sendmail`, `msmtp`, or Python fallback
#[tauri::command]
pub async fn email_send(
    to: Vec<String>,
    subject: String,
    body: String,
    attachments: Option<Vec<String>>,
    config: Option<EmailConfig>,
) -> Result<String, String> {
    backend_info(format!(
        "Command email_send invoked: to={:?}, subject='{}', attachments={:?}",
        to, subject, attachments.as_ref().map(|a| a.len())
    ));

    let cfg = config.unwrap_or_else(|| load_email_config_from_env());

    if cfg.smtp_host.is_empty() || cfg.smtp_user.is_empty() {
        return Err("Email nie jest skonfigurowany. Użyj komendy 'konfiguruj email' w czacie.".to_string());
    }

    let recipients = to.join(", ");
    let attachment_paths = attachments.unwrap_or_default();

    // Build email content
    let boundary = format!("broxeen-boundary-{}", chrono::Utc::now().timestamp_millis());
    let mut email_content = String::new();

    email_content.push_str(&format!("From: {}\r\n", cfg.from_address));
    email_content.push_str(&format!("To: {}\r\n", recipients));
    email_content.push_str(&format!("Subject: {}\r\n", subject));
    email_content.push_str("MIME-Version: 1.0\r\n");

    if attachment_paths.is_empty() {
        email_content.push_str("Content-Type: text/plain; charset=utf-8\r\n");
        email_content.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        email_content.push_str(&body);
    } else {
        email_content.push_str(&format!(
            "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
            boundary
        ));

        // Body part
        email_content.push_str(&format!("--{}\r\n", boundary));
        email_content.push_str("Content-Type: text/plain; charset=utf-8\r\n");
        email_content.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        email_content.push_str(&body);
        email_content.push_str("\r\n");

        // Attachment parts
        for attach_path in &attachment_paths {
            let path = Path::new(attach_path);
            if !path.exists() {
                backend_warn(format!("Attachment not found: {}", attach_path));
                continue;
            }

            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "attachment".to_string());

            let file_bytes = std::fs::read(path)
                .map_err(|e| format!("Nie można odczytać załącznika {}: {}", attach_path, e))?;
            let b64 = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &file_bytes,
            );

            email_content.push_str(&format!("--{}\r\n", boundary));
            email_content.push_str(&format!(
                "Content-Type: application/octet-stream; name=\"{}\"\r\n",
                filename
            ));
            email_content.push_str("Content-Transfer-Encoding: base64\r\n");
            email_content.push_str(&format!(
                "Content-Disposition: attachment; filename=\"{}\"\r\n\r\n",
                filename
            ));

            // Split base64 into 76-char lines
            for chunk in b64.as_bytes().chunks(76) {
                email_content.push_str(&String::from_utf8_lossy(chunk));
                email_content.push_str("\r\n");
            }
        }

        email_content.push_str(&format!("--{}--\r\n", boundary));
    }

    // Try sending via Python (most reliable cross-platform approach)
    let python_script = format!(
        r#"
import smtplib
import sys

server = smtplib.SMTP("{host}", {port})
server.ehlo()
if {use_tls}:
    server.starttls()
    server.ehlo()
server.login("{user}", "{password}")
server.sendmail("{from_addr}", {to_list}, sys.stdin.read().encode('utf-8'))
server.quit()
print("OK")
"#,
        host = cfg.smtp_host,
        port = cfg.smtp_port,
        use_tls = if cfg.use_tls { "True" } else { "False" },
        user = cfg.smtp_user.replace('\"', "\\\""),
        password = cfg.smtp_password.replace('\"', "\\\""),
        from_addr = cfg.from_address,
        to_list = format!(
            "[{}]",
            to.iter()
                .map(|t| format!("\"{}\"", t))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    );

    let mut child = Command::new("python3")
        .arg("-c")
        .arg(&python_script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Nie można uruchomić Python do wysyłki email: {}", e))?;

    if let Some(ref mut stdin) = child.stdin {
        use std::io::Write;
        stdin
            .write_all(email_content.as_bytes())
            .map_err(|e| format!("Nie można przesłać treści email: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Błąd podczas wysyłki email: {}", e))?;

    if output.status.success() {
        let msg = format!(
            "Email wysłany do {} (temat: '{}', załączników: {})",
            recipients,
            subject,
            attachment_paths.len()
        );
        backend_info(&msg);
        Ok(msg)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        backend_error(format!("Email send failed: {}", stderr));
        Err(format!("Nie udało się wysłać email: {}", stderr))
    }
}

/// Poll inbox via Python IMAP
#[tauri::command]
pub async fn email_poll_inbox(
    max_messages: Option<usize>,
    config: Option<EmailConfig>,
) -> Result<InboxSummary, String> {
    backend_info("Command email_poll_inbox invoked");

    let cfg = config.unwrap_or_else(|| load_email_config_from_env());

    if cfg.imap_host.is_empty() || cfg.smtp_user.is_empty() {
        return Err("Email nie jest skonfigurowany. Użyj komendy 'konfiguruj email' w czacie.".to_string());
    }

    let max = max_messages.unwrap_or(10);

    let python_script = format!(
        r#"
import imaplib
import email
from email.header import decode_header
import json
import sys

def decode_str(s):
    if s is None:
        return ""
    decoded = decode_header(s)
    parts = []
    for part, charset in decoded:
        if isinstance(part, bytes):
            parts.append(part.decode(charset or 'utf-8', errors='replace'))
        else:
            parts.append(str(part))
    return ' '.join(parts)

try:
    if {use_tls}:
        mail = imaplib.IMAP4_SSL("{imap_host}", {imap_port})
    else:
        mail = imaplib.IMAP4("{imap_host}", {imap_port})

    mail.login("{user}", "{password}")
    mail.select("INBOX")

    # Get total and unseen counts
    status, data = mail.search(None, "ALL")
    all_ids = data[0].split() if data[0] else []
    total = len(all_ids)

    status, data = mail.search(None, "UNSEEN")
    unseen_ids = data[0].split() if data[0] else []
    unread = len(unseen_ids)

    # Fetch recent messages
    fetch_ids = all_ids[-{max}:] if len(all_ids) > {max} else all_ids
    fetch_ids.reverse()

    messages = []
    for msg_id in fetch_ids:
        status, msg_data = mail.fetch(msg_id, "(FLAGS BODY.PEEK[HEADER] BODY.PEEK[TEXT])")
        if status != "OK":
            continue

        raw_header = msg_data[0][1] if msg_data[0] and len(msg_data[0]) > 1 else b""
        msg = email.message_from_bytes(raw_header)

        subject = decode_str(msg.get("Subject", ""))
        from_addr = decode_str(msg.get("From", ""))
        to_addr = decode_str(msg.get("To", ""))
        date = msg.get("Date", "")

        # Get body text
        body_text = ""
        if len(msg_data) > 1 and msg_data[1] and len(msg_data[1]) > 1:
            try:
                body_text = msg_data[1][1].decode('utf-8', errors='replace')[:500]
            except:
                body_text = ""

        # Check flags
        flags_str = str(msg_data[0][0]) if msg_data[0] else ""
        is_read = "\\\\Seen" in flags_str
        has_attach = "attachment" in str(raw_header).lower()

        messages.append({{
            "id": msg_id.decode(),
            "from": from_addr,
            "to": [t.strip() for t in to_addr.split(",")],
            "subject": subject,
            "body": body_text[:500],
            "date": date,
            "has_attachments": has_attach,
            "is_read": is_read,
        }})

    mail.close()
    mail.logout()

    print(json.dumps({{
        "total_messages": total,
        "unread_count": unread,
        "recent_messages": messages,
    }}))
except Exception as e:
    print(json.dumps({{"error": str(e)}}), file=sys.stderr)
    sys.exit(1)
"#,
        imap_host = cfg.imap_host,
        imap_port = cfg.imap_port,
        use_tls = if cfg.use_tls { "True" } else { "False" },
        user = cfg.smtp_user.replace('\"', "\\\""),
        password = cfg.smtp_password.replace('\"', "\\\""),
        max = max,
    );

    let output = Command::new("python3")
        .arg("-c")
        .arg(&python_script)
        .output()
        .map_err(|e| format!("Nie można uruchomić Python do odczytu email: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        backend_error(format!("Email poll failed: {}", stderr));
        return Err(format!("Nie udało się odczytać skrzynki: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Błąd parsowania odpowiedzi: {}", e))?;

    let total = parsed["total_messages"].as_u64().unwrap_or(0) as usize;
    let unread = parsed["unread_count"].as_u64().unwrap_or(0) as usize;
    let messages_json = parsed["recent_messages"].as_array().cloned().unwrap_or_default();

    let recent_messages: Vec<EmailMessage> = messages_json
        .iter()
        .map(|m| EmailMessage {
            id: m["id"].as_str().unwrap_or("").to_string(),
            from: m["from"].as_str().unwrap_or("").to_string(),
            to: m["to"]
                .as_array()
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            subject: m["subject"].as_str().unwrap_or("").to_string(),
            body: m["body"].as_str().unwrap_or("").to_string(),
            date: m["date"].as_str().map(String::from),
            has_attachments: m["has_attachments"].as_bool().unwrap_or(false),
            is_read: m["is_read"].as_bool().unwrap_or(false),
        })
        .collect();

    // Generate summary text
    let summary = if recent_messages.is_empty() {
        "Skrzynka pusta — brak wiadomości.".to_string()
    } else {
        let mut lines = vec![format!(
            "📬 **Skrzynka email** — {} wiadomości ({} nieprzeczytanych)\n",
            total, unread
        )];
        for (i, msg) in recent_messages.iter().take(5).enumerate() {
            let read_icon = if msg.is_read { "📭" } else { "📩" };
            let attach_icon = if msg.has_attachments { " 📎" } else { "" };
            lines.push(format!(
                "{}. {} **{}**{}\n   Od: {} | {}",
                i + 1,
                read_icon,
                msg.subject,
                attach_icon,
                msg.from,
                msg.date.as_deref().unwrap_or("brak daty"),
            ));
        }
        lines.join("\n")
    };

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(InboxSummary {
        total_messages: total,
        unread_count: unread,
        recent_messages,
        summary_text: summary,
        poll_time: now,
    })
}

/// Test email configuration
#[tauri::command]
pub async fn email_test_config(config: EmailConfig) -> Result<String, String> {
    backend_info(format!(
        "Command email_test_config invoked: smtp={}:{}, imap={}:{}",
        config.smtp_host, config.smtp_port, config.imap_host, config.imap_port
    ));

    let python_script = format!(
        r#"
import smtplib
import imaplib
import json

results = {{"smtp": False, "imap": False, "smtp_error": "", "imap_error": ""}}

try:
    server = smtplib.SMTP("{smtp_host}", {smtp_port}, timeout=10)
    server.ehlo()
    if {use_tls}:
        server.starttls()
        server.ehlo()
    server.login("{user}", "{password}")
    server.quit()
    results["smtp"] = True
except Exception as e:
    results["smtp_error"] = str(e)

try:
    if {use_tls}:
        mail = imaplib.IMAP4_SSL("{imap_host}", {imap_port})
    else:
        mail = imaplib.IMAP4("{imap_host}", {imap_port})
    mail.login("{user}", "{password}")
    mail.logout()
    results["imap"] = True
except Exception as e:
    results["imap_error"] = str(e)

print(json.dumps(results))
"#,
        smtp_host = config.smtp_host,
        smtp_port = config.smtp_port,
        imap_host = config.imap_host,
        imap_port = config.imap_port,
        use_tls = if config.use_tls { "True" } else { "False" },
        user = config.smtp_user.replace('\"', "\\\""),
        password = config.smtp_password.replace('\"', "\\\""),
    );

    let output = Command::new("python3")
        .arg("-c")
        .arg(&python_script)
        .output()
        .map_err(|e| format!("Nie można uruchomić Python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Błąd parsowania: {}", e))?;

    let smtp_ok = parsed["smtp"].as_bool().unwrap_or(false);
    let imap_ok = parsed["imap"].as_bool().unwrap_or(false);
    let smtp_err = parsed["smtp_error"].as_str().unwrap_or("");
    let imap_err = parsed["imap_error"].as_str().unwrap_or("");

    let mut result = String::new();
    if smtp_ok {
        result.push_str("✅ SMTP: połączenie poprawne\n");
    } else {
        result.push_str(&format!("❌ SMTP: {}\n", smtp_err));
    }
    if imap_ok {
        result.push_str("✅ IMAP: połączenie poprawne\n");
    } else {
        result.push_str(&format!("❌ IMAP: {}\n", imap_err));
    }

    if smtp_ok && imap_ok {
        backend_info("Email config test: both SMTP and IMAP OK");
        Ok(result)
    } else {
        backend_warn(format!("Email config test partial failure: smtp={} imap={}", smtp_ok, imap_ok));
        Err(result)
    }
}

fn load_email_config_from_env() -> EmailConfig {
    EmailConfig {
        smtp_host: std::env::var("BROXEEN_SMTP_HOST").unwrap_or_default(),
        smtp_port: std::env::var("BROXEEN_SMTP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(587),
        smtp_user: std::env::var("BROXEEN_SMTP_USER").unwrap_or_default(),
        smtp_password: std::env::var("BROXEEN_SMTP_PASSWORD").unwrap_or_default(),
        imap_host: std::env::var("BROXEEN_IMAP_HOST").unwrap_or_default(),
        imap_port: std::env::var("BROXEEN_IMAP_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(993),
        from_address: std::env::var("BROXEEN_EMAIL_FROM").unwrap_or_default(),
        use_tls: std::env::var("BROXEEN_EMAIL_TLS")
            .map(|v| v != "false" && v != "0")
            .unwrap_or(true),
    }
}

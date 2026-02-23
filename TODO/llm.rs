use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::{debug, warn};

use crate::config::LlmConfig;

/// Result of LLM verification.
#[derive(Debug, Clone)]
pub struct LlmResult {
    pub label: String,
    pub description: String,
}

pub struct LlmClient {
    client: Client,
    api_key: String,
    model: String,
    max_tokens: u32,
}

impl LlmClient {
    pub fn new(cfg: &LlmConfig) -> Result<Self> {
        let api_key = cfg.api_key.clone()
            .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
            .ok_or_else(|| anyhow!("ANTHROPIC_API_KEY not set"))?;

        Ok(Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()?,
            api_key,
            model: cfg.model.clone(),
            max_tokens: cfg.max_tokens,
        })
    }

    /// Send a JPEG crop (≤500px) to the LLM for classification.
    ///
    /// Prompt is deliberately minimal — single token response format
    /// to keep latency and cost low.
    ///
    /// Returns: `LlmResult { label, description }` where label ∈ our 10 classes.
    pub async fn classify_object(
        &self,
        jpeg_bytes: &[u8],
        local_label: &str,
        camera_id: &str,
    ) -> Result<LlmResult> {
        let img_b64 = B64.encode(jpeg_bytes);

        let payload = json!({
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": img_b64
                        }
                    },
                    {
                        "type": "text",
                        "text": format!(
                            "Camera: {}. Local classifier result: {}.\n\
                             Identify the main object in this image.\n\
                             Respond ONLY in this exact format:\n\
                             LABEL|brief description (max 15 words)\n\
                             LABEL must be one of: person/car/truck/bus/motorcycle/bicycle/dog/cat/bird/unknown",
                            camera_id, local_label
                        )
                    }
                ]
            }]
        });

        debug!("Sending crop to LLM (model={}, local={})", self.model, local_label);

        let resp = self.client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            warn!("LLM API error {}: {}", status, body);
            return Err(anyhow!("LLM API returned {}: {}", status, body));
        }

        let json: Value = resp.json().await?;

        let text = json["content"][0]["text"]
            .as_str()
            .ok_or_else(|| anyhow!("Unexpected LLM response structure"))?
            .trim()
            .to_string();

        let (label, description) = parse_llm_response(&text, local_label);
        Ok(LlmResult { label, description })
    }
}

/// Parse "LABEL|description" format, falling back to local_label on error.
fn parse_llm_response(raw: &str, fallback_label: &str) -> (String, String) {
    const VALID_LABELS: &[&str] = &[
        "person", "car", "truck", "bus", "motorcycle",
        "bicycle", "dog", "cat", "bird", "unknown",
    ];

    // Find first line that looks like a response (ignore chain-of-thought lines)
    for line in raw.lines() {
        if let Some(idx) = line.find('|') {
            let candidate = line[..idx].trim().to_lowercase();
            let description = line[idx + 1..].trim().to_string();
            if VALID_LABELS.contains(&candidate.as_str()) {
                return (candidate, description);
            }
        }
        // Also accept bare label without description
        let bare = line.trim().to_lowercase();
        if VALID_LABELS.contains(&bare.as_str()) {
            return (bare, String::new());
        }
    }

    // Fallback
    (fallback_label.to_string(), raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_llm_response;

    #[test]
    fn test_parse_standard() {
        let (label, desc) = parse_llm_response("car|A silver sedan moving left", "unknown");
        assert_eq!(label, "car");
        assert_eq!(desc, "A silver sedan moving left");
    }

    #[test]
    fn test_parse_bare_label() {
        let (label, _) = parse_llm_response("person", "unknown");
        assert_eq!(label, "person");
    }

    #[test]
    fn test_parse_fallback() {
        let (label, _) = parse_llm_response("I cannot identify this object.", "dog");
        assert_eq!(label, "dog");
    }

    #[test]
    fn test_parse_ignores_cot() {
        let raw = "Looking at the image...\ncar|A dark SUV driving away";
        let (label, desc) = parse_llm_response(raw, "unknown");
        assert_eq!(label, "car");
        assert_eq!(desc, "A dark SUV driving away");
    }
}

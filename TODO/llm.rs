//! LLM client supporting OpenRouter (primary) with local-model fallback.
//!
//! OpenRouter is OpenAI-API-compatible — same /v1/chat/completions endpoint,
//! different base URL and auth header format.
//!
//! Fallback: any local OpenAI-compatible server (Ollama, llama.cpp, LM Studio).

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{debug, info, warn};

// ─── Provider config ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum LlmProvider {
    /// OpenRouter — https://openrouter.ai
    OpenRouter {
        api_key:  String,
        model:    String,   // e.g. "google/gemini-2.0-flash-exp"
    },
    /// Any local OpenAI-compatible server (Ollama, llama.cpp, LM Studio)
    Local {
        base_url: String,  // e.g. "http://localhost:11434/v1"
        model:    String,  // e.g. "llava:7b"
    },
}

impl LlmProvider {
    pub fn label(&self) -> String {
        match self {
            LlmProvider::OpenRouter { model, .. } => format!("OpenRouter/{}", model),
            LlmProvider::Local { model, .. }      => format!("Local/{}", model),
        }
    }
}

// ─── Request / response types (OpenAI-compatible) ────────────────────────────

#[derive(Debug, Serialize)]
struct ChatRequest {
    model:      String,
    messages:   Vec<Message>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
struct Message {
    role:    String,
    content: Vec<ContentPart>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Serialize)]
struct ImageUrl {
    url:    String,   // "data:image/jpeg;base64,..."
    detail: String,   // "low" to save tokens
}

// ─── Result types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ObjectDescription {
    /// Confirmed class label (from our 20)
    pub label:        String,
    /// Short description of the object
    pub description:  String,
    /// Confidence words: "certain", "likely", "uncertain"
    pub certainty:    String,
}

#[derive(Debug, Clone)]
pub struct SceneNarrativeResult {
    pub narrative: String,
    pub provider:  String,
}

// ─── Client ──────────────────────────────────────────────────────────────────

pub struct LlmClient {
    http:       Client,
    primary:    Option<LlmProvider>,
    fallback:   Option<LlmProvider>,
    max_tokens: u32,
}

impl LlmClient {
    /// Build client from config.
    /// Primary = OpenRouter (if key set).
    /// Fallback = local Ollama (if configured).
    pub fn from_config(cfg: &crate::config::LlmConfig) -> Self {
        let primary: Option<LlmProvider> = cfg.openrouter_api_key.as_ref()
            .filter(|k| !k.is_empty())
            .map(|key| LlmProvider::OpenRouter {
                api_key: key.clone(),
                model:   cfg.openrouter_model.clone(),
            });

        let fallback: Option<LlmProvider> = cfg.local_base_url.as_ref()
            .filter(|u| !u.is_empty())
            .map(|url| LlmProvider::Local {
                base_url: url.clone(),
                model:    cfg.local_model.clone(),
            });

        if primary.is_none() && fallback.is_none() {
            warn!("No LLM provider configured — running in local-only mode");
        } else {
            info!("LLM primary:  {}", primary.as_ref().map(|p| p.label()).unwrap_or("none".into()));
            info!("LLM fallback: {}", fallback.as_ref().map(|p| p.label()).unwrap_or("none".into()));
        }

        Self {
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            primary,
            fallback,
            max_tokens: cfg.max_tokens,
        }
    }

    /// Describe a single detected object crop.
    /// Sends JPEG bytes (already ≤400px). Returns label + description.
    pub async fn describe_object(
        &self,
        jpeg_bytes:  &[u8],
        local_label: &str,
        camera_id:   &str,
    ) -> Result<ObjectDescription> {
        let b64 = format!("data:image/jpeg;base64,{}", B64.encode(jpeg_bytes));

        let prompt = format!(
            "Camera: {camera_id}. Local detector: {local_label}.\n\
             Identify the main object in this image.\n\
             Reply ONLY in this exact format:\n\
             LABEL|description (max 10 words)|certainty\n\
             LABEL must be one of: person/car/truck/bus/motorcycle/bicycle/\
             dog/cat/bird/horse/backpack/handbag/suitcase/umbrella/\
             bottle/chair/laptop/cell phone/clock/unknown\n\
             certainty: certain/likely/uncertain"
        );

        let messages = vec![Message {
            role: "user".into(),
            content: vec![
                ContentPart::ImageUrl { image_url: ImageUrl { url: b64, detail: "low".into() } },
                ContentPart::Text { text: prompt },
            ],
        }];

        let resp = self.call_with_fallback(messages, 60).await?;
        Ok(parse_object_response(&resp, local_label))
    }

    /// Send a scene batch (multiple crops + timeline) → narrative.
    pub async fn describe_scene(
        &self,
        crops:     &[(Vec<u8>, String)],  // (jpeg, timestamp_str)
        timeline:  &str,
        camera_id: &str,
    ) -> Result<SceneNarrativeResult> {
        let mut content = Vec::new();

        for (i, (jpeg, ts)) in crops.iter().enumerate() {
            let b64 = format!("data:image/jpeg;base64,{}", B64.encode(jpeg));
            content.push(ContentPart::ImageUrl {
                image_url: ImageUrl { url: b64, detail: "low".into() },
            });
            content.push(ContentPart::Text {
                text: format!("[Crop {} @ {}]", i + 1, ts),
            });
        }

        content.push(ContentPart::Text {
            text: format!(
                "{}\n\n\
                 These images show detected objects from camera '{}' during this period.\n\
                 Write a concise 2-4 sentence summary of what happened:\n\
                 - Which objects appeared and when\n\
                 - Their movement (direction, behaviour)\n\
                 - Any notable patterns\n\
                 Be specific with times. Past tense. No lists.",
                timeline, camera_id
            ),
        });

        let messages = vec![Message {
            role: "user".into(),
            content,
        }];

        let provider_label = self.active_provider_label();
        let text = self.call_with_fallback(messages, self.max_tokens).await?;

        Ok(SceneNarrativeResult {
            narrative: text.trim().to_string(),
            provider: provider_label,
        })
    }

    /// Text-to-SQL: convert natural language query → SQL against our schema.
    pub async fn text_to_sql(&self, question: &str, schema: &str) -> Result<String> {
        let messages = vec![Message {
            role: "user".into(),
            content: vec![ContentPart::Text {
                text: format!(
                    "SQLite schema:\n```sql\n{schema}\n```\n\n\
                     Convert this question to a single SQLite SELECT query.\n\
                     Question: {question}\n\n\
                     Rules:\n\
                     - Output ONLY the SQL query, nothing else\n\
                     - No markdown, no explanation\n\
                     - Use only tables and columns from the schema\n\
                     - For time filters: use datetime('now', '-N hours/days') or date comparisons\n\
                     - 'today' means date(timestamp) = date('now')\n\
                     - Labels are lowercase: 'person', 'car', 'truck', etc."
                ),
            }],
        }];

        let sql = self.call_with_fallback(messages, 200).await?;

        // Strip markdown fences if present
        let sql = sql
            .trim()
            .trim_start_matches("```sql")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();

        Ok(sql)
    }

    fn active_provider_label(&self) -> String {
        self.primary.as_ref()
            .or(self.fallback.as_ref())
            .map(|p| p.label())
            .unwrap_or("none".into())
    }

    /// Try primary provider, fall back to local on error.
    async fn call_with_fallback(&self, messages: Vec<Message>, max_tokens: u32) -> Result<String> {
        if let Some(ref primary) = self.primary {
            match self.call_provider(primary, messages.clone(), max_tokens).await {
                Ok(r) => return Ok(r),
                Err(e) => warn!("Primary LLM failed: {} — trying fallback", e),
            }
        }

        if let Some(ref fallback) = self.fallback {
            return self.call_provider(fallback, messages, max_tokens).await;
        }

        Err(anyhow!("No LLM provider available"))
    }

    async fn call_provider(
        &self,
        provider:   &LlmProvider,
        messages:   Vec<Message>,
        max_tokens: u32,
    ) -> Result<String> {
        let (base_url, model, auth_header, auth_value) = match provider {
            LlmProvider::OpenRouter { api_key, model } => (
                "https://openrouter.ai/api/v1/chat/completions".to_string(),
                model.clone(),
                "Authorization",
                format!("Bearer {}", api_key),
            ),
            LlmProvider::Local { base_url, model } => (
                format!("{}/chat/completions", base_url.trim_end_matches('/')),
                model.clone(),
                "Authorization",
                "Bearer local".to_string(),   // Ollama ignores auth
            ),
        };

        let req_body = ChatRequest {
            model,
            messages,
            max_tokens,
            temperature: Some(0.2),
        };

        debug!("LLM call → {}", base_url);

        let resp = self.http
            .post(&base_url)
            .header(auth_header, auth_value)
            .header("Content-Type", "application/json")
            // OpenRouter requires this header (identifies your app)
            .header("HTTP-Referer", "https://github.com/broxeen-vision")
            .header("X-Title", "Broxeen Vision")
            .json(&req_body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body   = resp.text().await.unwrap_or_default();
            anyhow::bail!("LLM HTTP {}: {}", status, &body[..body.len().min(300)]);
        }

        let json: Value = resp.json().await?;

        // OpenAI-compatible response format
        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow!("Unexpected LLM response: {}", json))
    }
}

// ─── Response parsers ─────────────────────────────────────────────────────────

const VALID_LABELS: &[&str] = &[
    "person", "car", "truck", "bus", "motorcycle", "bicycle",
    "dog", "cat", "bird", "horse",
    "backpack", "handbag", "suitcase", "umbrella",
    "bottle", "chair", "laptop", "cell phone", "clock", "unknown",
];

fn parse_object_response(raw: &str, fallback: &str) -> ObjectDescription {
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() >= 2 {
            let label = parts[0].trim().to_lowercase();
            if VALID_LABELS.contains(&label.as_str()) {
                let description = parts.get(1).unwrap_or(&"").trim().to_string();
                let certainty   = parts.get(2).unwrap_or(&"likely").trim().to_string();
                return ObjectDescription { label, description, certainty };
            }
        }
    }
    ObjectDescription {
        label:       fallback.to_string(),
        description: raw.trim().chars().take(60).collect(),
        certainty:   "uncertain".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_standard() {
        let r = parse_object_response("car|Silver sedan moving left|certain", "unknown");
        assert_eq!(r.label, "car");
        assert_eq!(r.certainty, "certain");
    }

    #[test]
    fn parse_fallback() {
        let r = parse_object_response("I cannot tell", "person");
        assert_eq!(r.label, "person");
        assert_eq!(r.certainty, "uncertain");
    }
}

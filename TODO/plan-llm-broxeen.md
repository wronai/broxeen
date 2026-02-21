# Plan integracji LLM (Lite) w Broxeen

## Cel

Dodać do Broxeen multimodalny LLM (via OpenRouter) obsługujący:
- **Opis grafiki** — co widać na stronie (screenshoty, obrazki)
- **Q&A po treści** — odpowiadanie na pytania o zawartość strony
- **Pełny STT → LLM → TTS** — mówisz pytanie, dostajesz głosową odpowiedź
- **Inteligentne przeglądanie** — LLM analizuje HTML i wyciąga sens

## Architektura

```
 Mikrofon (STT)          Klawiatura
      │                      │
      └──────┬───────────────┘
             ▼
      useSpeech.ts (istniejący)
             │
             ▼
    ┌─────────────────┐
    │   Chat.tsx       │  ← decyduje: browse? pytanie do LLM? opis strony?
    │   (orchestrator) │
    └────────┬────────┘
             │
     ┌───────┼────────────┐
     ▼       ▼            ▼
 resolver  browse     llmGateway.ts ──→ Tauri cmd ──→ OpenRouter API
  (URL)    (fetch)       │                               │
                         │         ┌─────────────────────┘
                         ▼         ▼
                    odpowiedź tekstowa
                         │
                         ▼
                    useTts.ts (istniejący) → Głośnik
```

## Nowe pliki

```
broxeen/
├── .env                              # NOWY — konfiguracja LLM
├── src/
│   ├── lib/
│   │   ├── llmClient.ts              # NOWY — klient OpenRouter (TS)
│   │   ├── llmClient.test.ts         # NOWY — testy
│   │   └── llmPrompts.ts             # NOWY — system prompty per tryb
│   ├── hooks/
│   │   ├── useLlm.ts                 # NOWY — React hook do LLM
│   │   └── useLlm.test.ts            # NOWY — testy
│   └── components/
│       └── Chat.tsx                  # ZMIANA — integracja LLM w handleSubmit
├── src-tauri/
│   └── src/
│       ├── main.rs                   # ZMIANA — nowe komendy Tauri
│       ├── llm.rs                    # NOWY — moduł Rust do OpenRouter
│       └── screenshot.rs             # NOWY — screenshot WebView → base64
└── python/                           # OPCJONALNY sidecar
    └── llm_client.py                 # Twój istniejący klient (backup)
```

## Konfiguracja

### `.env`

```env
# ── LLM via OpenRouter ──────────────────────────
OPENROUTER_API_KEY=sk-or-v1-3afad9d16461cb...
LLM_MODEL=google/gemini-3-flash-preview
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.7

# ── Broxeen-specific ────────────────────────────
LLM_SYSTEM_PROMPT_BROWSE=Jesteś asystentem przeglądania internetu. Odpowiadaj po polsku, zwięźle.
LLM_SYSTEM_PROMPT_DESCRIBE=Opisz co widzisz na obrazku. Odpowiadaj po polsku.
LLM_SYSTEM_PROMPT_QA=Odpowiedz na pytanie na podstawie podanej treści strony. Bądź zwięzły.
```

### `src-tauri/tauri.conf.json` — dodaj env

```jsonc
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build"
  },
  // ... reszta bez zmian
}
```

---

## Przykładowe pliki implementacji

### 1. `src/lib/llmClient.ts` — klient OpenRouter

```typescript
/**
 * llmClient — Unified LLM client via OpenRouter for Broxeen.
 * Works both in browser (dev) and through Tauri commands (production).
 */

import { isTauriRuntime } from "./runtime";
import { createScopedLogger } from "./logger";

const log = createScopedLogger("llm");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface LlmConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
}

/** Multimodal content (text + images) */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** Load config from env or Tauri settings */
export function getConfig(): LlmConfig {
  return {
    apiKey: import.meta.env.VITE_OPENROUTER_API_KEY ?? "",
    model: import.meta.env.VITE_LLM_MODEL ?? "google/gemini-3-flash-preview",
    maxTokens: Number(import.meta.env.VITE_LLM_MAX_TOKENS ?? 2048),
    temperature: Number(import.meta.env.VITE_LLM_TEMPERATURE ?? 0.7),
  };
}

/**
 * Send a chat completion request to OpenRouter.
 * Supports text-only and multimodal (image) messages.
 */
export async function chat(
  messages: LlmMessage[],
  config?: Partial<LlmConfig>
): Promise<LlmResponse> {
  const cfg = { ...getConfig(), ...config };

  if (!cfg.apiKey) {
    throw new Error("OPENROUTER_API_KEY not set. Configure in .env file.");
  }

  // In Tauri runtime, delegate to Rust backend (bypasses CORS)
  if (isTauriRuntime()) {
    return chatViaTauri(messages, cfg);
  }

  // Browser fallback (dev mode)
  return chatDirect(messages, cfg);
}

async function chatDirect(
  messages: LlmMessage[],
  cfg: LlmConfig
): Promise<LlmResponse> {
  log.info(`Sending ${messages.length} messages to ${cfg.model}`);

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://broxeen.local",
      "X-Title": "broxeen",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    text: data.choices[0].message.content,
    model: data.model,
    usage: data.usage,
  };
}

async function chatViaTauri(
  messages: LlmMessage[],
  cfg: LlmConfig
): Promise<LlmResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LlmResponse>("llm_chat", { messages, config: cfg });
}

// ── Convenience wrappers ────────────────────────────

/** Ask LLM a question about page content */
export async function askAboutContent(
  pageContent: string,
  question: string
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "Jesteś asystentem przeglądania internetu Broxeen. " +
        "Odpowiadaj po polsku, zwięźle i na temat. " +
        "Użytkownik przegląda stronę i zadaje pytanie o jej treść.",
    },
    {
      role: "user",
      content: `Treść strony:\n\n${pageContent.slice(0, 6000)}\n\n---\nPytanie: ${question}`,
    },
  ];
  const resp = await chat(messages);
  return resp.text;
}

/** Describe an image (screenshot or page image) */
export async function describeImage(
  base64Image: string,
  mimeType: string = "image/png",
  prompt: string = "Opisz dokładnie co widzisz na tym obrazku. Odpowiedz po polsku."
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "Jesteś asystentem wizualnym. Opisujesz obrazki i screenshoty stron internetowych po polsku.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
          },
        },
      ],
    },
  ];
  const resp = await chat(messages);
  return resp.text;
}

/** Summarize page content for TTS readout */
export async function summarizeForTts(
  pageContent: string,
  maxSentences: number = 5
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        `Podsumuj poniższą treść strony w maksymalnie ${maxSentences} zdaniach. ` +
        "Pisz naturalnym językiem polskim, tak żeby dobrze brzmiało czytane na głos przez syntezator mowy. " +
        "Nie używaj markdown, linków ani formatowania.",
    },
    {
      role: "user",
      content: pageContent.slice(0, 8000),
    },
  ];
  const resp = await chat(messages);
  return resp.text;
}
```

### 2. `src/lib/llmPrompts.ts` — prompty systemowe

```typescript
/**
 * System prompts for different Broxeen LLM modes.
 * Centralized for easy tuning.
 */

export const PROMPTS = {
  /** Tryb przeglądania — streszczanie stron */
  browse:
    "Jesteś asystentem przeglądania internetu Broxeen. " +
    "Użytkownik mówi po polsku i przegląda strony przez chat. " +
    "Streszczaj treść strony zwięźle, naturalnym językiem polskim. " +
    "Nie używaj markdown. Pisz tak, by syntezator mowy brzmiał naturalnie.",

  /** Tryb Q&A — pytania o treść */
  qa:
    "Odpowiadaj na pytania o treść strony internetowej. " +
    "Bądź zwięzły i konkretny. Odpowiadaj po polsku. " +
    "Jeśli odpowiedzi nie ma w treści, powiedz o tym.",

  /** Tryb opisu grafiki */
  vision:
    "Opisujesz obrazki i screenshoty stron internetowych. " +
    "Opisz układ strony, widoczne elementy, tekst i grafiki. " +
    "Odpowiadaj po polsku, zwięźle.",

  /** Tryb identyfikacji intencji użytkownika */
  intent:
    "Określ intencję użytkownika. Odpowiedz JEDNYM słowem:\n" +
    "- BROWSE — chce otworzyć stronę (podał URL lub nazwę)\n" +
    "- ASK — zadaje pytanie o obecną stronę\n" +
    "- DESCRIBE — chce opis tego co widzi\n" +
    "- SEARCH — chce szukać czegoś w internecie\n" +
    "- COMMAND — komenda systemowa (np. głośniej, ciszej, stop)\n" +
    "- CHAT — zwykła rozmowa\n" +
    "Odpowiedz TYLKO jednym słowem.",

  /** Tryb ekstrakcji treści z HTML */
  extract:
    "Wyciągnij najważniejszą treść z podanego HTML. " +
    "Ignoruj nawigację, reklamy, stopki. " +
    "Zwróć czysty tekst artykułu / głównej treści.",
} as const;

export type PromptMode = keyof typeof PROMPTS;
```

### 3. `src/hooks/useLlm.ts` — React hook

```typescript
import { useState, useCallback, useRef } from "react";
import { chat, askAboutContent, describeImage, summarizeForTts } from "../lib/llmClient";
import { PROMPTS, PromptMode } from "../lib/llmPrompts";
import type { LlmMessage } from "../lib/llmClient";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("useLlm");

interface UseLlmOptions {
  /** Kontekst strony do Q&A */
  pageContent?: string;
  /** Historia konwersacji */
  maxHistory?: number;
}

interface UseLlmReturn {
  /** Wyślij wiadomość tekstową */
  send: (text: string) => Promise<string>;
  /** Opisz obraz (base64) */
  describe: (base64: string, mime?: string) => Promise<string>;
  /** Streszcz treść strony dla TTS */
  summarize: (content: string) => Promise<string>;
  /** Wykryj intencję użytkownika */
  detectIntent: (text: string) => Promise<PromptMode>;
  /** Stan ładowania */
  loading: boolean;
  /** Ostatni błąd */
  error: string | null;
  /** Historia konwersacji */
  history: LlmMessage[];
  /** Wyczyść historię */
  clearHistory: () => void;
}

export function useLlm(options: UseLlmOptions = {}): UseLlmReturn {
  const { pageContent, maxHistory = 20 } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<LlmMessage[]>([]);

  const send = useCallback(
    async (text: string): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        let result: string;

        if (pageContent) {
          // Q&A mode — pytanie o treść strony
          result = await askAboutContent(pageContent, text);
        } else {
          // General chat mode
          const messages: LlmMessage[] = [
            { role: "system", content: PROMPTS.browse },
            ...historyRef.current.slice(-maxHistory),
            { role: "user", content: text },
          ];
          const resp = await chat(messages);
          result = resp.text;
        }

        // Update history
        historyRef.current.push(
          { role: "user", content: text },
          { role: "assistant", content: result }
        );

        return result;
      } catch (e: any) {
        const msg = e.message ?? String(e);
        log.error(msg);
        setError(msg);
        return `Błąd LLM: ${msg}`;
      } finally {
        setLoading(false);
      }
    },
    [pageContent, maxHistory]
  );

  const describe = useCallback(async (base64: string, mime = "image/png") => {
    setLoading(true);
    setError(null);
    try {
      return await describeImage(base64, mime);
    } catch (e: any) {
      setError(e.message);
      return `Błąd opisu: ${e.message}`;
    } finally {
      setLoading(false);
    }
  }, []);

  const summarize = useCallback(async (content: string) => {
    setLoading(true);
    setError(null);
    try {
      return await summarizeForTts(content);
    } catch (e: any) {
      setError(e.message);
      return `Błąd streszczenia: ${e.message}`;
    } finally {
      setLoading(false);
    }
  }, []);

  const detectIntent = useCallback(async (text: string): Promise<PromptMode> => {
    try {
      const messages: LlmMessage[] = [
        { role: "system", content: PROMPTS.intent },
        { role: "user", content: text },
      ];
      const resp = await chat(messages, { maxTokens: 10, temperature: 0.1 });
      const intent = resp.text.trim().toLowerCase();

      const validIntents: Record<string, PromptMode> = {
        browse: "browse",
        ask: "qa",
        describe: "vision",
        search: "browse",
        command: "browse",
        chat: "browse",
      };
      return validIntents[intent] ?? "browse";
    } catch {
      return "browse";
    }
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
  }, []);

  return {
    send,
    describe,
    summarize,
    detectIntent,
    loading,
    error,
    history: historyRef.current,
    clearHistory,
  };
}
```

### 4. `src-tauri/src/llm.rs` — backend Rust

```rust
//! LLM module — OpenRouter API client for Tauri backend.
//! Handles API calls server-side to avoid CORS and protect API key.

use serde::{Deserialize, Serialize};
use std::env;

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmConfig {
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlData },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageUrlData {
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LlmMessage {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmResponse {
    pub text: String,
    pub model: String,
}

/// Load LLM config from environment
pub fn get_config() -> LlmConfig {
    LlmConfig {
        api_key: env::var("OPENROUTER_API_KEY").unwrap_or_default(),
        model: env::var("LLM_MODEL")
            .unwrap_or_else(|_| "google/gemini-3-flash-preview".into()),
        max_tokens: env::var("LLM_MAX_TOKENS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2048),
        temperature: env::var("LLM_TEMPERATURE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.7),
    }
}

/// Send chat completion to OpenRouter
pub async fn chat_completion(
    messages: Vec<LlmMessage>,
    config: Option<LlmConfig>,
) -> Result<LlmResponse, String> {
    let cfg = config.unwrap_or_else(get_config);

    if cfg.api_key.is_empty() {
        return Err("OPENROUTER_API_KEY not set".into());
    }

    let payload = serde_json::json!({
        "model": cfg.model,
        "messages": messages,
        "max_tokens": cfg.max_tokens,
        "temperature": cfg.temperature,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://broxeen.local")
        .header("X-Title", "broxeen")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {}", &body[..body.len().min(200)]));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let text = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let model = data["model"].as_str().unwrap_or("").to_string();

    Ok(LlmResponse { text, model })
}
```

### 5. `src-tauri/src/main.rs` — nowe komendy Tauri

```rust
// Dodaj do istniejącego main.rs:

mod llm;

/// Tauri command: LLM chat completion
#[tauri::command]
async fn llm_chat(
    messages: Vec<llm::LlmMessage>,
    config: Option<llm::LlmConfig>,
) -> Result<llm::LlmResponse, String> {
    llm::chat_completion(messages, config).await
}

/// Tauri command: Screenshot current WebView as base64
#[tauri::command]
async fn screenshot_webview(
    window: tauri::Window,
) -> Result<String, String> {
    // Tauri 2 doesn't have built-in screenshot yet
    // Option A: Use JS to capture canvas
    // Option B: Use platform-specific screenshot
    Err("Screenshot not yet implemented — use JS canvas capture".into())
}

// W .build() dodaj:
//   .invoke_handler(tauri::generate_handler![
//       browse, get_settings, save_settings,
//       llm_chat, screenshot_webview,   // ← NOWE
//   ])
```

### 6. Zmiany w `src/components/Chat.tsx`

```typescript
// ── Dodaj importy ──────────────────────────────────
import { useLlm } from "../hooks/useLlm";
import { PROMPTS } from "../lib/llmPrompts";

// ── W komponencie Chat: ────────────────────────────
const [pageContent, setPageContent] = useState<string>("");

const llm = useLlm({ pageContent });

// ── Zmień handleSubmit: ────────────────────────────
async function handleSubmit(text?: string) {
  const input = text ?? inputText.trim();
  if (!input) return;

  addMessage({ role: "user", text: input });
  setInputText("");

  // 1. Spróbuj resolver (istniejąca logika)
  const resolved = resolve(input);

  if (resolved.kind === "exact" || resolved.kind === "fuzzy") {
    // Browse + LLM summarize
    addMessage({ role: "system", text: "Otwieram stronę..." });
    const browseResult = await executeBrowseCommand(resolved.url, runtimeIsTauri);
    setPageContent(browseResult.content);

    // LLM streszczenie dla TTS
    const summary = await llm.summarize(browseResult.content);
    addMessage({ role: "assistant", text: summary });

    // Auto-TTS jeśli włączone
    if (settings.tts_enabled) {
      speak(summary);
    }
  } else if (pageContent && !looksLikeUrl(input)) {
    // Q&A o aktualnej stronie
    addMessage({ role: "system", text: "Myślę..." });
    const answer = await llm.send(input);
    updateLastSystemMessage(answer);

    if (settings.tts_enabled) {
      speak(answer);
    }
  } else if (resolved.kind === "search") {
    // Wyszukiwanie
    // ... istniejąca logika DuckDuckGo ...
  }
}
```

### 7. `src-tauri/Cargo.toml` — nowe zależności

```toml
# Dodaj do [dependencies]:
reqwest = { version = "0.12", features = ["json"] }
base64 = "0.22"
# serde i serde_json już powinny być
```

### 8. `.env` (pełny)

```env
# ── OpenRouter LLM ──────────────────────────────────
VITE_OPENROUTER_API_KEY=sk-or-v1-3afad9d16461cb...
VITE_LLM_MODEL=google/gemini-3-flash-preview
VITE_LLM_MAX_TOKENS=2048
VITE_LLM_TEMPERATURE=0.7

# ── Tauri backend (bez VITE_ prefix) ────────────────
OPENROUTER_API_KEY=sk-or-v1-3afad9d16461cb...
LLM_MODEL=google/gemini-3-flash-preview
LLM_MAX_TOKENS=2048
LLM_TEMPERATURE=0.7
```

> **Uwaga:** `VITE_` prefix = dostępne w frontend. Bez `VITE_` = tylko backend Rust.
> W produkcji klucz API powinien być TYLKO po stronie Rust.

---

## Flow pełnego cyklu STT → LLM → TTS

```
1. Użytkownik klika mikrofon (toggleMic)
2. useSpeech.ts → rozpoznaje mowę → "co jest na tej stronie"
3. Chat.tsx → onTranscript → handleSubmit("co jest na tej stronie")
4. handleSubmit:
   a. pageContent istnieje → tryb Q&A
   b. useLlm.send("co jest na tej stronie") → OpenRouter API
   c. LLM odpowiada: "Na stronie jest artykuł o..."
   d. addMessage({ role: "assistant", text: odpowiedź })
   e. useTts.speak(odpowiedź) → głośnik czyta odpowiedź
5. Jeśli auto_listen=true → mikrofon znowu się włącza
```

## Flow opisu grafiki

```
1. Użytkownik mówi: "opisz tę stronę"
2. detectIntent → "DESCRIBE"
3. Przechwycenie screenshota WebView (canvas/Tauri cmd) → base64
4. llm.describe(base64png) → OpenRouter (Gemini vision)
5. "Widzę stronę z nagłówkiem, menu nawigacyjnym, artykułem o..."
6. TTS czyta opis
```

---

## Kolejność implementacji

| # | Zadanie | Pliki | Priorytet |
|---|---------|-------|-----------|
| 1 | `.env` + konfiguracja | `.env`, `vite.config.ts` | 🔴 |
| 2 | `llmClient.ts` + testy | `src/lib/llmClient.ts` | 🔴 |
| 3 | `llm.rs` + komenda Tauri | `src-tauri/src/llm.rs`, `main.rs` | 🔴 |
| 4 | `llmPrompts.ts` | `src/lib/llmPrompts.ts` | 🟡 |
| 5 | `useLlm.ts` hook + testy | `src/hooks/useLlm.ts` | 🔴 |
| 6 | Integracja w `Chat.tsx` | `src/components/Chat.tsx` | 🔴 |
| 7 | Detekcja intencji | `llmPrompts.ts` (intent) | 🟡 |
| 8 | Screenshot → vision | `screenshot.rs`, `llmClient.ts` | 🟢 |
| 9 | Auto-listen loop | `Chat.tsx` + `useSpeech.ts` | 🟢 |
| 10 | Streaming odpowiedzi | `llmClient.ts` (SSE) | 🟢 |

🔴 = krytyczne, 🟡 = ważne, 🟢 = nice-to-have

---

## Uwagi

- **Gemini 3 Flash** obsługuje multimodal (tekst + obraz) — idealne do opisywania stron
- **API key bezpieczeństwo:** W produkcji klucz TYLKO w Rust backend, nie w frontend
- **Token limit:** Treść strony obcinana do ~6000 znaków żeby zmieścić się w kontekście
- **Koszt:** Gemini Flash jest tani (~$0.10/1M tokenów) — nawet intensywne użycie < $1/dzień
- **Fallback:** Jeśli LLM niedostępny, Broxeen działa jak dotychczas (surowy tekst + TTS)

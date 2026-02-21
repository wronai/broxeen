/**
 * llmClient — Unified LLM client via OpenRouter for Broxeen.
 * Works both in browser (dev) and through Tauri commands (production).
 */

import { isTauriRuntime } from "./runtime";
import { createScopedLogger } from "./logger";

const log = createScopedLogger("llm");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Types ───────────────────────────────────────────

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

/** Multimodal content (text + images for Gemini vision) */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

// ── Config ──────────────────────────────────────────

export function getConfig(): LlmConfig {
  return {
    apiKey: import.meta.env.VITE_OPENROUTER_API_KEY ?? "",
    model: import.meta.env.VITE_LLM_MODEL ?? "google/gemini-3-flash-preview",
    maxTokens: Number(import.meta.env.VITE_LLM_MAX_TOKENS ?? 2048),
    temperature: Number(import.meta.env.VITE_LLM_TEMPERATURE ?? 0.7),
  };
}

// ── Core chat function ──────────────────────────────

/**
 * Send a chat completion request to OpenRouter.
 * Supports text-only and multimodal (image) messages.
 */
export async function chat(
  messages: LlmMessage[],
  configOverride?: Partial<LlmConfig>
): Promise<LlmResponse> {
  const cfg = { ...getConfig(), ...configOverride };

  if (!cfg.apiKey) {
    throw new Error("OPENROUTER_API_KEY not set. Configure in .env file.");
  }

  if (isTauriRuntime()) {
    return chatViaTauri(messages, cfg);
  }

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
    log.error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
    throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? "";

  return {
    text,
    model: data.model ?? cfg.model,
    usage: data.usage,
  };
}

async function chatViaTauri(
  messages: LlmMessage[],
  cfg: LlmConfig
): Promise<LlmResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LlmResponse>("llm_chat", {
    messages: JSON.stringify(messages),
    apiKey: cfg.apiKey,
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    temperature: cfg.temperature,
  });
}

// ── Convenience wrappers ────────────────────────────

const CONTENT_TRIM = 6000;
const TTS_TRIM = 8000;

/** Ask LLM a question about current page content */
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
      content:
        `Treść strony:\n\n${pageContent.slice(0, CONTENT_TRIM)}\n\n` +
        `---\nPytanie: ${question}`,
    },
  ];
  const resp = await chat(messages);
  return resp.text;
}

/** Describe an image (screenshot or inline image) — Gemini multimodal */
export async function describeImage(
  base64Image: string,
  mimeType = "image/png",
  prompt = "Opisz dokładnie co widzisz na tym obrazku. Odpowiedz po polsku."
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "Jesteś asystentem wizualnym aplikacji Broxeen. " +
        "Opisujesz obrazki i screenshoty stron po polsku, zwięźle.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Image}` },
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
  maxSentences = 5
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        `Podsumuj poniższą treść strony w maksymalnie ${maxSentences} zdaniach. ` +
        "Pisz naturalnym językiem polskim, tak żeby dobrze brzmiało czytane " +
        "na głos przez syntezator mowy. Nie używaj markdown, linków ani formatowania.",
    },
    { role: "user", content: pageContent.slice(0, TTS_TRIM) },
  ];
  const resp = await chat(messages);
  return resp.text;
}

/** Quick intent detection — returns one word */
export async function detectIntent(
  userText: string
): Promise<string> {
  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "Określ intencję użytkownika. Odpowiedz JEDNYM słowem:\n" +
        "BROWSE — chce otworzyć stronę\n" +
        "ASK — pytanie o obecną stronę\n" +
        "DESCRIBE — chce opis tego co widzi\n" +
        "SEARCH — szukanie w internecie\n" +
        "COMMAND — komenda (głośniej, ciszej, stop)\n" +
        "CHAT — zwykła rozmowa",
    },
    { role: "user", content: userText },
  ];
  const resp = await chat(messages, { maxTokens: 10, temperature: 0.1 });
  return resp.text.trim().toUpperCase();
}

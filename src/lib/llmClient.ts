/**
 * llmClient — Unified LLM client via OpenRouter for Broxeen.
 * Works both in browser (dev) and through Tauri commands (production).
 */

import { isTauriRuntime } from "./runtime";
import { logger, logAsyncDecorator } from "./logger";

const llmClientLogger = logger.scope("llm:client");

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
  const runChat = logAsyncDecorator("llm:client", "chat", async () => {
    const cfg = { ...getConfig(), ...configOverride };

    if (!cfg.apiKey) {
      llmClientLogger.error("OPENROUTER_API_KEY not set in configuration");
      throw new Error("OPENROUTER_API_KEY not set. Configure in .env file.");
    }

    const isTauri = isTauriRuntime();
    llmClientLogger.info("Dispatching LLM chat completion request", {
      messagesCount: messages.length,
      model: cfg.model,
      runtime: isTauri ? "tauri" : "browser",
    });

    if (isTauri) {
      return chatViaTauri(messages, cfg);
    }

    return chatDirect(messages, cfg);
  });
  return runChat();
}

async function chatDirect(
  messages: LlmMessage[],
  cfg: LlmConfig
): Promise<LlmResponse> {
  const runChatDirect = logAsyncDecorator("llm:client", "chatDirect", async () => {
    llmClientLogger.debug("Executing HTTP POST to OpenRouter", {
      url: OPENROUTER_URL,
    });

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
      llmClientLogger.error("OpenRouter HTTP request failed", {
        status: resp.status,
        responseBody: body.slice(0, 200),
      });
      throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? "";

    llmClientLogger.info("OpenRouter response received", {
      model: data.model ?? cfg.model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      responseLength: text.length,
    });

    return {
      text,
      model: data.model ?? cfg.model,
      usage: data.usage,
    };
  });
  return runChatDirect();
}

async function chatViaTauri(
  messages: LlmMessage[],
  cfg: LlmConfig
): Promise<LlmResponse> {
  const runChatViaTauri = logAsyncDecorator("llm:client", "chatViaTauri", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    llmClientLogger.debug("Invoking Tauri command llm_chat");

    const result = await invoke<LlmResponse>("llm_chat", {
      messages: JSON.stringify(messages),
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
    });

    llmClientLogger.info("Tauri LLM command completed", {
      model: result.model,
      responseLength: result.text.length,
    });

    return result;
  });
  return runChatViaTauri();
}

// ── Convenience wrappers ────────────────────────────

const CONTENT_TRIM = 6000;
const TTS_TRIM = 8000;

/** Ask LLM a question about current page content */
export async function askAboutContent(
  pageContent: string,
  question: string
): Promise<string> {
  const runAsk = logAsyncDecorator("llm:client", "askAboutContent", async () => {
    llmClientLogger.debug("Building Q&A prompt", { questionLength: question.length });
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
  });
  return runAsk();
}

/** Describe an image (screenshot or inline image) — Gemini multimodal */
export async function describeImage(
  base64Image: string,
  mimeType = "image/png",
  prompt = "Opisz dokładnie co widzisz na tym obrazku. Odpowiedz po polsku."
): Promise<string> {
  const runDescribe = logAsyncDecorator("llm:client", "describeImage", async () => {
    llmClientLogger.debug("Building image description prompt", { mimeType });
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
  });
  return runDescribe();
}

/** Summarize page content for TTS readout */
export async function summarizeForTts(
  pageContent: string,
  maxSentences = 5
): Promise<string> {
  const runSummarize = logAsyncDecorator("llm:client", "summarizeForTts", async () => {
    llmClientLogger.debug("Building TTS summary prompt", { maxSentences });
    const messages: LlmMessage[] = [
      {
        role: "system",
        content:
          `Podsumuj poniższą treść strony w maksymalnie ${maxSentences} zdaniach. ` +
          "Pisz naturalnym językiem polskim, tak żeby dobrze brzmiało czytane " +
          "na głos przez syntezator mowy. Nie używaj markdown, linków ani formatowania. " +
          "WAŻNE: Skup się TYLKO na głównej treści artykułu lub strony. " +
          "Całkowicie ignoruj: elementy nawigacji, przyciski, etykiety menu, " +
          "linki w stopce, powiadomienia o ciasteczkach, formularze logowania, " +
          "nazwy kategorii, breadcrumby, sidebary i inne elementy interfejsu. " +
          "Nie cytuj nazw przycisków ani pozycji menu.",
      },
      { role: "user", content: pageContent.slice(0, TTS_TRIM) },
    ];
    const resp = await chat(messages);
    return resp.text;
  });
  return runSummarize();
}

/** Quick intent detection — returns one word */
export async function detectIntent(
  userText: string
): Promise<string> {
  const runDetect = logAsyncDecorator("llm:client", "detectIntent", async () => {
    llmClientLogger.debug("Building intent detection prompt", { textLength: userText.length });
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
  });
  return runDetect();
}

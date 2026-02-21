import { useState, useCallback, useRef } from "react";
import {
  chat,
  askAboutContent,
  describeImage,
  summarizeForTts,
  detectIntent as detectIntentFn,
} from "../lib/llmClient";
import { PROMPTS } from "../lib/llmPrompts";
import type { LlmMessage } from "../lib/llmClient";
import { createScopedLogger } from "../lib/logger";

const log = createScopedLogger("useLlm");

// ── Types ───────────────────────────────────────────

export type IntentType =
  | "BROWSE"
  | "ASK"
  | "DESCRIBE"
  | "SEARCH"
  | "COMMAND"
  | "CHAT";

interface UseLlmOptions {
  /** Current page content for Q&A context */
  pageContent?: string;
  /** Max conversation history turns to send */
  maxHistory?: number;
}

interface UseLlmReturn {
  /** Send a text message (auto-selects Q&A or general chat) */
  send: (text: string) => Promise<string>;
  /** Describe an image via Gemini vision */
  describe: (base64: string, mime?: string) => Promise<string>;
  /** Summarize content for TTS readout */
  summarize: (content: string, maxSentences?: number) => Promise<string>;
  /** Detect user intent from text */
  detectIntent: (text: string) => Promise<IntentType>;
  /** Loading state */
  loading: boolean;
  /** Last error message */
  error: string | null;
  /** Conversation history */
  history: LlmMessage[];
  /** Clear conversation history */
  clearHistory: () => void;
}

// ── Hook ────────────────────────────────────────────

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
          // Q&A mode: answer questions about current page
          result = await askAboutContent(pageContent, text);
        } else {
          // General chat mode with history
          const messages: LlmMessage[] = [
            { role: "system", content: PROMPTS.browse },
            ...historyRef.current.slice(-maxHistory),
            { role: "user", content: text },
          ];
          const resp = await chat(messages);
          result = resp.text;
        }

        // Track history
        historyRef.current = [
          ...historyRef.current,
          { role: "user", content: text },
          { role: "assistant", content: result },
        ].slice(-maxHistory * 2);

        return result;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(msg);
        setError(msg);
        return `Błąd LLM: ${msg}`;
      } finally {
        setLoading(false);
      }
    },
    [pageContent, maxHistory]
  );

  const describe = useCallback(
    async (base64: string, mime = "image/png"): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        return await describeImage(base64, mime);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return `Błąd opisu obrazu: ${msg}`;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const summarize = useCallback(
    async (content: string, maxSentences = 5): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        return await summarizeForTts(content, maxSentences);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return `Błąd streszczenia: ${msg}`;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const detectIntent = useCallback(
    async (text: string): Promise<IntentType> => {
      try {
        const raw = await detectIntentFn(text);
        const valid: IntentType[] = [
          "BROWSE", "ASK", "DESCRIBE", "SEARCH", "COMMAND", "CHAT",
        ];
        return valid.includes(raw as IntentType)
          ? (raw as IntentType)
          : "BROWSE";
      } catch {
        return "BROWSE";
      }
    },
    []
  );

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

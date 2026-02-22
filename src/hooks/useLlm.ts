import { useState, useCallback, useRef } from "react";
import {
  chat,
  askAboutContent,
  describeImage,
  summarizeForTts,
  summarizeSearchResults,
  detectIntent as detectIntentFn,
} from "../lib/llmClient";
import { PROMPTS } from "../lib/llmPrompts";
import type { LlmMessage } from "../lib/llmClient";
import { createScopedLogger, logAsyncDecorator } from "../lib/logger";

const llmLogger = createScopedLogger("useLlm");

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
  /** Summarize search results */
  summarizeSearch: (content: string, query: string) => Promise<string>;
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
      const runSend = logAsyncDecorator("hooks:useLlm", "send", async () => {
        setLoading(true);
        setError(null);
        try {
          let result: string;

          if (pageContent) {
            llmLogger.info("LLM Q&A mode triggered", {
              queryLength: text.length,
            });
            result = await askAboutContent(pageContent, text);
          } else {
            llmLogger.info("LLM general chat mode triggered", {
              queryLength: text.length,
              historyLength: historyRef.current.length,
            });
            const messages: LlmMessage[] = [
              { role: "system", content: PROMPTS.browse },
              ...historyRef.current.slice(-maxHistory),
              { role: "user", content: text },
            ];
            const resp = await chat(messages);
            result = resp.text;
          }

          const nextHistory: LlmMessage[] = [
            ...historyRef.current,
            { role: "user", content: text },
            { role: "assistant", content: result },
          ];
          historyRef.current = nextHistory.slice(-maxHistory * 2);

          return result;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          llmLogger.error("Failed to send LLM query", { error: msg });
          setError(msg);
          return `Błąd LLM: ${msg}`;
        } finally {
          setLoading(false);
        }
      });
      return runSend();
    },
    [pageContent, maxHistory],
  );

  const describe = useCallback(
    async (base64: string, mime = "image/png"): Promise<string> => {
      const runDescribe = logAsyncDecorator(
        "hooks:useLlm",
        "describe",
        async () => {
          setLoading(true);
          setError(null);
          try {
            llmLogger.info("LLM image description triggered");
            return await describeImage(base64, mime);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            llmLogger.error("Failed to describe image via LLM", { error: msg });
            setError(msg);
            return `Błąd opisu obrazu: ${msg}`;
          } finally {
            setLoading(false);
          }
        },
      );
      return runDescribe();
    },
    [],
  );

  const summarize = useCallback(
    async (content: string, maxSentences = 5): Promise<string> => {
      const runSummarize = logAsyncDecorator(
        "hooks:useLlm",
        "summarize",
        async () => {
          setLoading(true);
          setError(null);
          try {
            llmLogger.info("LLM summarize triggered", {
              contentLength: content.length,
              maxSentences,
            });
            return await summarizeForTts(content, maxSentences);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            llmLogger.error("Failed to summarize content via LLM", {
              error: msg,
            });
            setError(msg);
            return `Błąd streszczenia: ${msg}`;
          } finally {
            setLoading(false);
          }
        },
      );
      return runSummarize();
    },
    [],
  );

  const summarizeSearch = useCallback(
    async (content: string, query: string): Promise<string> => {
      const runSummarizeSearch = logAsyncDecorator(
        "hooks:useLlm",
        "summarizeSearch",
        async () => {
          setLoading(true);
          setError(null);
          try {
            llmLogger.info("LLM search summarize triggered", {
              contentLength: content.length,
              queryLength: query.length,
            });
            return await summarizeSearchResults(content, query);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            llmLogger.error("Failed to summarize search results via LLM", {
              error: msg,
            });
            setError(msg);
            return `Błąd streszczenia wyników: ${msg}`;
          } finally {
            setLoading(false);
          }
        },
      );
      return runSummarizeSearch();
    },
    [],
  );

  const detectIntent = useCallback(
    async (text: string): Promise<IntentType> => {
      const runDetectIntent = logAsyncDecorator(
        "hooks:useLlm",
        "detectIntent",
        async () => {
          try {
            llmLogger.debug("Detecting intent", { queryLength: text.length });
            const raw = await detectIntentFn(text);
            const valid: IntentType[] = [
              "BROWSE",
              "ASK",
              "DESCRIBE",
              "SEARCH",
              "COMMAND",
              "CHAT",
            ];
            const finalIntent = valid.includes(raw as IntentType)
              ? (raw as IntentType)
              : "BROWSE";
            llmLogger.debug("Intent detected", { intent: finalIntent });
            return finalIntent;
          } catch (e) {
            llmLogger.warn("Failed to detect intent, falling back to BROWSE", {
              error: e,
            });
            return "BROWSE";
          }
        },
      );
      return runDetectIntent();
    },
    [],
  );

  const clearHistory = useCallback(() => {
    llmLogger.info("Clearing LLM chat history");
    historyRef.current = [];
  }, []);

  return {
    send,
    describe,
    summarize,
    summarizeSearch,
    detectIntent,
    loading,
    error,
    history: historyRef.current,
    clearHistory,
  };
}

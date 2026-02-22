import type { LlmMessage } from "../lib/llmClient";

/**
 * Interface for LLM operations.
 * Segregated by capability — consumers only depend on what they need.
 */
export interface LlmService {
  /** General chat with message history */
  chat(messages: LlmMessage[]): Promise<string>;

  /** Ask about specific content */
  ask(question: string, context: string): Promise<string>;

  /** Summarize webpage content for TTS readout */
  summarize(content: string, maxSentences?: number): Promise<string>;

  /** Summarize search results with original query context */
  summarizeSearch(content: string, query: string): Promise<string>;

  /** Detect user intent from text */
  detectIntent(text: string): Promise<string>;

  /** Describe an image via vision model */
  describeImage(base64: string, mime?: string): Promise<string>;
}

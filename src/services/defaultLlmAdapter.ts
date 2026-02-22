import type { LlmService } from "./llmService";
import {
  chat,
  askAboutContent,
  summarizeForTts,
  summarizeSearchResults,
  detectIntent,
  describeImage,
  type LlmMessage,
} from "../lib/llmClient";

/**
 * Default implementation of LlmService that delegates to the existing
 * low-level functions in llmClient.ts.
 */
export class DefaultLlmAdapter implements LlmService {
  async chat(messages: LlmMessage[]): Promise<string> {
    const response = await chat(messages);
    return response.text;
  }

  async ask(question: string, context: string): Promise<string> {
    return askAboutContent(context, question);
  }

  async summarize(content: string, maxSentences?: number): Promise<string> {
    return summarizeForTts(content, maxSentences);
  }

  async summarizeSearch(content: string, query: string): Promise<string> {
    return summarizeSearchResults(content, query);
  }

  async detectIntent(text: string): Promise<string> {
    return detectIntent(text);
  }

  async describeImage(base64: string, mime?: string): Promise<string> {
    return describeImage(base64, mime);
  }
}

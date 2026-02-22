import type { EventStore } from "../domain/eventStore";
import type { LlmService } from "../services/llmService";
import type { ChatAggregate } from "../domain/chatAggregate";
import { createScopedLogger } from "../lib/logger";

const logger = createScopedLogger("cmd:sendMessage");

/**
 * SendMessageCommand — handles LLM Q&A and general chat.
 * Emits message events and routes to appropriate LLM mode.
 */
export class SendMessageCommand {
  constructor(
    private eventStore: EventStore,
    private aggregate: ChatAggregate,
    private llmService: LlmService,
  ) {}

  async execute(question: string, pageContent?: string): Promise<void> {
    logger.info("Executing send message command", {
      questionLength: question.length,
      hasContext: !!pageContent,
    });

    // Add loading message
    const loadingId = this.aggregate.getNextId();
    this.eventStore.append({
      type: "message_added",
      payload: {
        id: loadingId,
        role: "assistant",
        text: "Myślę...",
        loading: true,
      },
    });

    try {
      const answer = pageContent
        ? await this.llmService.ask(question, pageContent)
        : await this.llmService.chat([{ role: "user", content: question }]);

      this.eventStore.append({
        type: "message_updated",
        payload: {
          id: loadingId,
          updates: { text: answer, loading: false },
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Send message command failed", { error: errorMsg });

      this.eventStore.append({
        type: "error_occurred",
        payload: { context: "sendMessage", error: errorMsg },
        timestamp: Date.now(),
      });

      this.eventStore.append({
        type: "message_updated",
        payload: {
          id: loadingId,
          updates: { text: `Błąd LLM: ${errorMsg}`, loading: false },
        },
      });
    }
  }
}

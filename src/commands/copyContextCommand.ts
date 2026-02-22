import type { ChatAggregate } from "../domain/chatAggregate";
import { createScopedLogger } from "../lib/logger";

const logger = createScopedLogger("cmd:copyContext");

/**
 * CopyContextCommand — copies a message interaction context to clipboard.
 * Format: "userQuery:\nassistantResponse\nURL: url"
 */
export class CopyContextCommand {
  constructor(private aggregate: ChatAggregate) {}

  async execute(messageId: number): Promise<void> {
    const msg = this.aggregate.getMessage(messageId);
    if (!msg) {
      logger.warn("Cannot copy: message not found", { messageId });
      return;
    }

    const userQuery = this.aggregate.getLastUserQuery(messageId);

    let context = userQuery ? `${userQuery}:\n` : "";
    context += msg.text;
    if (msg.url) {
      context += `\nURL: ${msg.url}`;
    }

    try {
      await navigator.clipboard.writeText(context);
      logger.info("Message context copied to clipboard", {
        characters: context.length,
      });
    } catch (err) {
      logger.error("Failed to copy message context", err);
    }
  }
}

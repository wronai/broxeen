import type { ChatAggregate } from "../domain/chatAggregate";
import type { ChatMessage } from "../domain/chatEvents";

/**
 * GetMessagesQuery — returns current chat messages from the aggregate.
 * Pure query, no side effects.
 */
export class GetMessagesQuery {
  constructor(private aggregate: ChatAggregate) {}

  execute(): readonly ChatMessage[] {
    return this.aggregate.getMessages();
  }

  getById(id: number): ChatMessage | undefined {
    return this.aggregate.getMessage(id);
  }

  getLastUserQuery(beforeId: number): string | null {
    return this.aggregate.getLastUserQuery(beforeId);
  }
}

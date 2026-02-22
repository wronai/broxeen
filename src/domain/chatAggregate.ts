import type { ChatMessage, DomainEvent } from "./chatEvents";
import { projectChatMessages } from "./chatEvents";

/**
 * Chat Aggregate Root.
 *
 * Applies domain events to maintain the chat message state.
 * Provides query methods for reading current state.
 * All state changes go through apply() — no direct mutation.
 */
export class ChatAggregate {
  private messages: ChatMessage[] = [];
  private nextId = 0;

  /** Apply a domain event to update aggregate state. */
  apply(event: DomainEvent): void {
    this.messages = projectChatMessages(this.messages, event);

    // Track the next available message ID
    if (event.type === "message_added") {
      this.nextId = Math.max(this.nextId, event.payload.id + 1);
    }
    if (event.type === "chat_cleared") {
      this.nextId = 0;
    }
  }

  /** Replay a sequence of events to rebuild state. */
  replayAll(events: DomainEvent[]): void {
    this.messages = [];
    this.nextId = 0;
    for (const event of events) {
      this.apply(event);
    }
  }

  /** Get a read-only view of all messages. */
  getMessages(): readonly ChatMessage[] {
    return this.messages;
  }

  /** Get the next available message ID. */
  getNextId(): number {
    return this.nextId;
  }

  /** Find a message by ID. */
  getMessage(id: number): ChatMessage | undefined {
    return this.messages.find((m) => m.id === id);
  }

  /**
   * Find the last user query that preceded a given message.
   * Useful for copy-context feature.
   */
  getLastUserQuery(beforeId: number): string | null {
    const idx = this.messages.findIndex((m) => m.id === beforeId);
    if (idx < 0) return null;

    for (let i = idx - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") {
        return this.messages[i].text;
      }
    }
    return null;
  }

  /** Get the total number of messages. */
  get messageCount(): number {
    return this.messages.length;
  }
}

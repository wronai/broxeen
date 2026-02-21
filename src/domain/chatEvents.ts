export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: number;
  role: ChatMessageRole;
  text: string;
  url?: string;
  resolveType?: string;
  suggestions?: string[];
  loading?: boolean;
}

export type ChatEvent =
  | {
      type: "message_added";
      payload: ChatMessage;
    }
  | {
      type: "message_updated";
      payload: {
        id: number;
        updates: Partial<ChatMessage>;
      };
    }
  | {
      type: "chat_cleared";
    };

export function projectChatMessages(
  current: ChatMessage[],
  event: ChatEvent,
): ChatMessage[] {
  switch (event.type) {
    case "message_added":
      return [...current, event.payload];
    case "message_updated":
      return current.map((message) =>
        message.id === event.payload.id
          ? { ...message, ...event.payload.updates }
          : message,
      );
    case "chat_cleared":
      return [];
    default:
      return current;
  }
}

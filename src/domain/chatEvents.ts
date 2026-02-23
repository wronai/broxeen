import type { AudioSettings } from "./audioSettings";

// ── Value Objects ──────────────────────────────────
export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: number;
  role: ChatMessageRole;
  text: string;
  type?: 'content' | 'image' | 'error' | 'loading' | 'suggestions' | 'network_selection' | 'camera_list' | 'camera_analysis' | 'config_prompt' | 'camera_live';
  mimeType?: string;
  url?: string;
  resolveType?: string;
  suggestions?: Array<{ action: string; text: string; description: string; query: string }>;
  loading?: boolean;
  screenshotBase64?: string;
  rssUrl?: string;
  contactUrl?: string;
  phoneUrl?: string;
  pageTitle?: string;
  title?: string;
  timestamp?: number;
  // New properties for enhanced message types
  networkOptions?: Array<{ scope: string; name: string; description: string }>;
  cameras?: Array<{ id: string; name: string; address: string; status: string }>;
  analysis?: string;
  live?: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string };
  /** Interactive config prompt data (buttons, fields, actions) */
  configPrompt?: import('../components/ChatConfigPrompt').ConfigPromptData;
}

// ── Domain Events ──────────────────────────────────

/** Chat-specific events (backward-compatible with existing code) */
export type ChatEvent =
  | { type: "message_added"; payload: ChatMessage }
  | {
      type: "message_updated";
      payload: { id: number; updates: Partial<ChatMessage> };
    }
  | { type: "chat_cleared" };

/** Full domain events for event sourcing */
export type DomainEvent =
  // Chat events
  | ChatEvent
  // Browse lifecycle
  | {
      type: "browse_requested";
      payload: { query: string; resolvedUrl: string; resolveType: string };
      timestamp: number;
    }
  | {
      type: "content_fetched";
      payload: {
        url: string;
        title: string;
        content: string;
        source: "tauri" | "browser";
        screenshotBase64?: string;
        rssUrl?: string;
        contactUrl?: string;
        phoneUrl?: string;
      };
      timestamp: number;
    }
  | {
      type: "search_executed";
      payload: { query: string; resultCount: number; url: string };
      timestamp: number;
    }
  | {
      type: "summary_generated";
      payload: {
        messageId: number;
        summary: string;
        mode: "browse" | "search";
      };
      timestamp: number;
    }
  // TTS lifecycle
  | {
      type: "tts_started";
      payload: { messageId: number; textLength: number };
      timestamp: number;
    }
  | { type: "tts_stopped"; timestamp: number }
  // Error handling
  | {
      type: "error_occurred";
      payload: { context: string; error: string; url?: string };
      timestamp: number;
    }
  // Settings
  | {
      type: "settings_changed";
      payload: Partial<AudioSettings>;
      timestamp: number;
    };

/** Create a timestamped domain event */
export function createEvent<T extends DomainEvent["type"]>(
  type: T,
  payload?: Extract<DomainEvent, { type: T }> extends { payload: infer P }
    ? P
    : never,
): DomainEvent {
  const base = { type, timestamp: Date.now() } as Record<string, unknown>;
  if (payload !== undefined) {
    base.payload = payload;
  }
  return base as DomainEvent;
}

// ── Projector (backward-compatible) ────────────────

export function projectChatMessages(
  current: ChatMessage[],
  event: ChatEvent | DomainEvent,
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

import type { AudioSettings } from "./audioSettings";

// ── Value Objects ──────────────────────────────────
export type ChatMessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: number;
  role: ChatMessageRole;
  text: string;
  type?: 'content' | 'image' | 'error' | 'loading' | 'suggestions' | 'network_selection' | 'camera_list' | 'camera_analysis' | 'config_prompt' | 'camera_live' | 'file_results' | 'thinking';
  mimeType?: string;
  url?: string;
  resolveType?: string;
  suggestions?: Array<{ action: string; text: string; description: string; query: string }>;
  loading?: boolean;
  screenshotBase64?: string;
  rssUrl?: string;
  contactUrl?: string;
  phoneUrl?: string;
  sitemapUrl?: string;
  blogUrl?: string;
  linkedinUrl?: string;
  facebookUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  youtubeUrl?: string;
  instagramUrl?: string;
  pageTitle?: string;
  title?: string;
  timestamp?: number;
  // New properties for enhanced message types
  networkOptions?: Array<{ scope: string; name: string; description: string }>;
  cameras?: Array<{ id: string; name: string; address: string; status: string }>;
  analysis?: string;
  live?: { url: string; cameraId: string; fps?: number; initialBase64?: string; initialMimeType?: string; snapshotUrl?: string | null; startInSnapshotMode?: boolean };
  /** Interactive config prompt data (buttons, fields, actions) */
  configPrompt?: import('../components/ChatConfigPrompt').ConfigPromptData;
  /** File search results for file_results message type */
  fileResults?: {
    files: Array<{
      path: string;
      name: string;
      extension: string;
      size_bytes: number;
      modified: string | null;
      file_type: string;
      is_dir: boolean;
      preview: string | null;
      mime_type: string;
    }>;
    query: string;
    totalFound: number;
    durationMs: number;
    truncated: boolean;
  };
  /** Thinking/processing indicator data */
  thinkingInfo?: {
    label: string;
    estimatedSeconds: number;
    startedAt: number;
  };
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
        sitemapUrl?: string;
        blogUrl?: string;
        linkedinUrl?: string;
        facebookUrl?: string;
        twitterUrl?: string;
        githubUrl?: string;
        youtubeUrl?: string;
        instagramUrl?: string;
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
    }
  // Device/Network events
  | {
      type: "device_discovered";
      payload: {
        id: string;
        ip: string;
        hostname?: string;
        vendor?: string;
        deviceType?: string;
        services: Array<{ type: string; port: number }>;
      };
      timestamp: number;
    }
  | {
      type: "device_status_changed";
      payload: {
        id: string;
        ip: string;
        oldStatus: "online" | "offline" | "unknown";
        newStatus: "online" | "offline" | "unknown";
        lastSeen: number;
      };
      timestamp: number;
    }
  | {
      type: "network_scan_completed";
      payload: {
        subnet: string;
        deviceCount: number;
        duration: number;
        scanType: "full" | "incremental" | "targeted";
      };
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

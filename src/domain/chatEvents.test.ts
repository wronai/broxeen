import { describe, it, expect } from "vitest";
import { projectChatMessages, type ChatEvent, type ChatMessage } from "./chatEvents";

describe("chatEvents projector", () => {
  it("applies message_added event", () => {
    const initial: ChatMessage[] = [];
    const next = projectChatMessages(initial, {
      type: "message_added",
      payload: {
        id: 1,
        role: "user",
        text: "hello",
      },
    });

    expect(next).toHaveLength(1);
    expect(next[0].text).toBe("hello");
  });

  it("applies message_updated event", () => {
    const initial: ChatMessage[] = [
      { id: 1, role: "assistant", text: "loading", loading: true },
    ];

    const next = projectChatMessages(initial, {
      type: "message_updated",
      payload: {
        id: 1,
        updates: { text: "done", loading: false },
      },
    });

    expect(next[0].text).toBe("done");
    expect(next[0].loading).toBe(false);
  });

  it("ignores message_updated for unknown message id", () => {
    const initial: ChatMessage[] = [{ id: 1, role: "user", text: "x" }];

    const next = projectChatMessages(initial, {
      type: "message_updated",
      payload: {
        id: 99,
        updates: { text: "y" },
      },
    });

    expect(next).toEqual(initial);
  });

  it("supports event-sourcing style replay", () => {
    const events: ChatEvent[] = [
      {
        type: "message_added",
        payload: { id: 1, role: "user", text: "onet.pl" },
      },
      {
        type: "message_added",
        payload: {
          id: 2,
          role: "assistant",
          text: "Pobieram: https://onet.pl...",
          loading: true,
        },
      },
      {
        type: "message_updated",
        payload: { id: 2, updates: { text: "Treść strony", loading: false } },
      },
    ];

    const finalState = events.reduce(projectChatMessages, [] as ChatMessage[]);

    expect(finalState).toHaveLength(2);
    expect(finalState[1]).toMatchObject({
      id: 2,
      role: "assistant",
      text: "Treść strony",
      loading: false,
    });
  });

  it("clears messages on chat_cleared event", () => {
    const initial: ChatMessage[] = [{ id: 1, role: "user", text: "hello" }];

    const next = projectChatMessages(initial, {
      type: "chat_cleared",
    });

    expect(next).toEqual([]);
  });
});

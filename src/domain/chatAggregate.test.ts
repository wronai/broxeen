import { describe, it, expect, beforeEach } from "vitest";
import { ChatAggregate } from "./chatAggregate";
import type { DomainEvent } from "./chatEvents";

describe("ChatAggregate", () => {
  let aggregate: ChatAggregate;

  beforeEach(() => {
    aggregate = new ChatAggregate();
  });

  it("starts empty", () => {
    expect(aggregate.getMessages()).toEqual([]);
    expect(aggregate.messageCount).toBe(0);
    expect(aggregate.getNextId()).toBe(0);
  });

  it("applies message_added event", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "user", text: "hello" },
    });

    expect(aggregate.messageCount).toBe(1);
    expect(aggregate.getMessages()[0].text).toBe("hello");
    expect(aggregate.getNextId()).toBe(2);
  });

  it("applies message_updated event", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "assistant", text: "loading...", loading: true },
    });
    aggregate.apply({
      type: "message_updated",
      payload: { id: 1, updates: { text: "done", loading: false } },
    });

    expect(aggregate.getMessage(1)?.text).toBe("done");
    expect(aggregate.getMessage(1)?.loading).toBe(false);
  });

  it("applies chat_cleared event", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "user", text: "hello" },
    });
    aggregate.apply({ type: "chat_cleared" });

    expect(aggregate.messageCount).toBe(0);
    expect(aggregate.getNextId()).toBe(0);
  });

  it("ignores non-chat domain events", () => {
    aggregate.apply({
      type: "browse_requested",
      payload: {
        query: "test",
        resolvedUrl: "https://x.com",
        resolveType: "url",
      },
      timestamp: Date.now(),
    } as DomainEvent);

    expect(aggregate.messageCount).toBe(0);
  });

  it("finds message by ID", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 5, role: "user", text: "find me" },
    });

    expect(aggregate.getMessage(5)?.text).toBe("find me");
    expect(aggregate.getMessage(99)).toBeUndefined();
  });

  it("finds last user query before a given message", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "user", text: "onet.pl" },
    });
    aggregate.apply({
      type: "message_added",
      payload: { id: 2, role: "assistant", text: "Oto treść strony..." },
    });

    expect(aggregate.getLastUserQuery(2)).toBe("onet.pl");
  });

  it("returns null when no user query found", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 0, role: "system", text: "Witaj w Broxeen!" },
    });
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "assistant", text: "response" },
    });

    expect(aggregate.getLastUserQuery(1)).toBeNull();
  });

  it("replays events to rebuild state", () => {
    const events: DomainEvent[] = [
      {
        type: "message_added",
        payload: { id: 1, role: "user", text: "first" },
      },
      {
        type: "message_added",
        payload: { id: 2, role: "assistant", text: "loading", loading: true },
      },
      {
        type: "message_updated",
        payload: { id: 2, updates: { text: "response", loading: false } },
      },
    ];

    aggregate.replayAll(events);

    expect(aggregate.messageCount).toBe(2);
    expect(aggregate.getMessage(2)?.text).toBe("response");
    expect(aggregate.getMessage(2)?.loading).toBe(false);
    expect(aggregate.getNextId()).toBe(3);
  });

  it("tracks next ID correctly across multiple adds", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 0, role: "system", text: "sys" },
    });
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "user", text: "u" },
    });
    aggregate.apply({
      type: "message_added",
      payload: { id: 2, role: "assistant", text: "a" },
    });

    expect(aggregate.getNextId()).toBe(3);
  });

  it("returns readonly messages array", () => {
    aggregate.apply({
      type: "message_added",
      payload: { id: 1, role: "user", text: "test" },
    });

    const messages = aggregate.getMessages();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventStore } from "./eventStore";
import type { DomainEvent } from "./chatEvents";

describe("EventStore", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  it("starts empty", () => {
    expect(store.size).toBe(0);
    expect(store.getEvents()).toEqual([]);
  });

  it("appends events", () => {
    const event: DomainEvent = {
      type: "message_added",
      payload: { id: 1, role: "user", text: "hello" },
    };
    store.append(event);

    expect(store.size).toBe(1);
    expect(store.getEvents()).toHaveLength(1);
    expect(store.getEvents()[0]).toBe(event);
  });

  it("notifies type-specific subscribers", () => {
    const handler = vi.fn();
    store.on("message_added", handler);

    const event: DomainEvent = {
      type: "message_added",
      payload: { id: 1, role: "user", text: "test" },
    };
    store.append(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not notify subscribers for other event types", () => {
    const handler = vi.fn();
    store.on("message_added", handler);

    store.append({ type: "chat_cleared" } as DomainEvent);

    expect(handler).not.toHaveBeenCalled();
  });

  it("notifies global subscribers for all events", () => {
    const handler = vi.fn();
    store.onAll(handler);

    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "a" },
    } as DomainEvent);
    store.append({ type: "chat_cleared" } as DomainEvent);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops notifications", () => {
    const handler = vi.fn();
    const unsub = store.on("message_added", handler);

    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "a" },
    } as DomainEvent);
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    store.append({
      type: "message_added",
      payload: { id: 2, role: "user", text: "b" },
    } as DomainEvent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("filters events by type", () => {
    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "a" },
    } as DomainEvent);
    store.append({ type: "chat_cleared" } as DomainEvent);
    store.append({
      type: "message_added",
      payload: { id: 2, role: "user", text: "b" },
    } as DomainEvent);

    const filtered = store.getEvents({ type: "message_added" });
    expect(filtered).toHaveLength(2);
  });

  it("filters events by timestamp", () => {
    store.append({
      type: "browse_requested",
      payload: { query: "a", resolvedUrl: "x", resolveType: "url" },
      timestamp: 100,
    } as DomainEvent);
    store.append({
      type: "browse_requested",
      payload: { query: "b", resolvedUrl: "y", resolveType: "url" },
      timestamp: 200,
    } as DomainEvent);
    store.append({
      type: "browse_requested",
      payload: { query: "c", resolvedUrl: "z", resolveType: "url" },
      timestamp: 300,
    } as DomainEvent);

    const filtered = store.getEvents({ since: 200 });
    expect(filtered).toHaveLength(2);
  });

  it("projects state from events", () => {
    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "hello" },
    } as DomainEvent);
    store.append({
      type: "message_added",
      payload: { id: 2, role: "assistant", text: "hi" },
    } as DomainEvent);

    const count = store.project((events) => events.length);
    expect(count).toBe(2);
  });

  it("clears all events", () => {
    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "a" },
    } as DomainEvent);
    store.clear();

    expect(store.size).toBe(0);
    expect(store.getEvents()).toEqual([]);
  });

  it("handles subscriber errors gracefully", () => {
    const badHandler = vi.fn(() => {
      throw new Error("oops");
    });
    const goodHandler = vi.fn();

    store.on("message_added", badHandler);
    store.on("message_added", goodHandler);

    store.append({
      type: "message_added",
      payload: { id: 1, role: "user", text: "a" },
    } as DomainEvent);

    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });
});

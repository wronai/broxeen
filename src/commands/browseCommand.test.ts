import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowseCommand } from "./browseCommand";
import { EventStore } from "../domain/eventStore";
import { ChatAggregate } from "../domain/chatAggregate";
import type { BrowseService } from "../services/browseService";
import type { LlmService } from "../services/llmService";

describe("BrowseCommand", () => {
  let eventStore: EventStore;
  let aggregate: ChatAggregate;
  let mockBrowseService: BrowseService;
  let mockLlmService: LlmService;

  beforeEach(() => {
    eventStore = new EventStore();
    aggregate = new ChatAggregate();

    // Wire up aggregate to listen to store events automatically (like CqrsContext does)
    eventStore.onAll((event) => {
      aggregate.apply(event);
    });

    mockBrowseService = {
      fetch: vi.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Example",
        content:
          "Example content for testing that is long enough to be useful.",
      }),
    };

    mockLlmService = {
      chat: vi.fn().mockResolvedValue("chat response"),
      ask: vi.fn().mockResolvedValue("ask response"),
      summarize: vi.fn().mockResolvedValue("LLM summary of the page content."),
      summarizeSearch: vi.fn().mockResolvedValue("Search results summary."),
      detectIntent: vi.fn().mockResolvedValue("BROWSE"),
      describeImage: vi.fn().mockResolvedValue("image description"),
    };
  });

  it("emits browse_requested event", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "example.com",
      resolvedUrl: "https://example.com",
      resolveType: "url",
    });

    const events = eventStore.getEvents({ type: "browse_requested" });
    expect(events).toHaveLength(1);
  });

  it("adds loading message then updates with content", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "example.com",
      resolvedUrl: "https://example.com",
      resolveType: "url",
    });

    const messages = aggregate.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].loading).toBe(false);
    expect(messages[0].text).toContain("LLM summary");
  });

  it("uses summarizeSearch for search resolveType", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "find companies",
      resolvedUrl: "https://html.duckduckgo.com/html/?q=find+companies",
      resolveType: "search",
    });

    expect(mockLlmService.summarizeSearch).toHaveBeenCalled();
    expect(mockLlmService.summarize).not.toHaveBeenCalled();
  });

  it("uses regular summarize for url resolveType", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "example.com",
      resolvedUrl: "https://example.com",
      resolveType: "url",
    });

    expect(mockLlmService.summarize).toHaveBeenCalled();
    expect(mockLlmService.summarizeSearch).not.toHaveBeenCalled();
  });

  it("handles browse errors gracefully", async () => {
    (mockBrowseService.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "broken.com",
      resolvedUrl: "https://broken.com",
      resolveType: "url",
    });

    const messages = aggregate.getMessages();
    expect(messages[0].text).toContain("Nie udało się pobrać strony");
    expect(messages[0].loading).toBe(false);

    const errors = eventStore.getEvents({ type: "error_occurred" });
    expect(errors).toHaveLength(1);
  });

  it("works without LLM service (null)", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      null,
    );

    await cmd.execute({
      query: "example.com",
      resolvedUrl: "https://example.com",
      resolveType: "url",
    });

    const messages = aggregate.getMessages();
    expect(messages[0].text).toContain("Example content");
    expect(messages[0].loading).toBe(false);
  });

  it("emits content_fetched event with source", async () => {
    const cmd = new BrowseCommand(
      eventStore,
      aggregate,
      mockBrowseService,
      mockLlmService,
    );

    await cmd.execute({
      query: "example.com",
      resolvedUrl: "https://example.com",
      resolveType: "url",
    });

    const fetched = eventStore.getEvents({ type: "content_fetched" });
    expect(fetched).toHaveLength(1);
  });
});

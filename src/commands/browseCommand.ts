import type { EventStore } from "../domain/eventStore";
import type { BrowseService } from "../services/browseService";
import type { LlmService } from "../services/llmService";
import type { ChatAggregate } from "../domain/chatAggregate";
import { createScopedLogger } from "../lib/logger";

const logger = createScopedLogger("cmd:browse");

export interface BrowseCommandParams {
  query: string;
  resolvedUrl: string;
  resolveType: string;
}

/**
 * BrowseCommand — orchestrates the full browse flow:
 * 1. Emit browse_requested event
 * 2. Add loading message
 * 3. Fetch content via BrowseService
 * 4. Emit content_fetched event
 * 5. Summarize via LlmService (if available)
 * 6. Emit summary_generated event
 * 7. Update message with final content
 */
export class BrowseCommand {
  constructor(
    private eventStore: EventStore,
    private aggregate: ChatAggregate,
    private browseService: BrowseService,
    private llmService: LlmService | null,
  ) {}

  async execute(params: BrowseCommandParams): Promise<void> {
    const { query, resolvedUrl, resolveType } = params;
    const now = Date.now();

    logger.info("Executing browse command", {
      query,
      resolvedUrl,
      resolveType,
    });

    // 1. Record browse request
    this.eventStore.append({
      type: "browse_requested",
      payload: { query, resolvedUrl, resolveType },
      timestamp: now,
    });

    // 2. Add loading message
    const loadingId = this.aggregate.getNextId();
    this.eventStore.append({
      type: "message_added",
      payload: {
        id: loadingId,
        role: "assistant",
        text:
          resolveType === "search"
            ? "Wyszukuję..."
            : `Pobieram: ${resolvedUrl}...`,
        url: resolvedUrl,
        loading: true,
        resolveType,
      },
    });

    try {
      // 3. Fetch content
      const browseResult = await this.browseService.fetch(resolvedUrl);
      const content = browseResult.content.slice(0, 5000).trim();
      const isSearch =
        resolveType === "search" || browseResult.resolve_type === "search";

      this.eventStore.append({
        type: "content_fetched",
        payload: {
          url: browseResult.url,
          title: browseResult.title,
          content: browseResult.content,
          source: "browser",
          screenshotBase64: browseResult.screenshot_base64,
          rssUrl: browseResult.rss_url,
          contactUrl: browseResult.contact_url,
          phoneUrl: browseResult.phone_url,
        },
        timestamp: Date.now(),
      });

      // 4. Summarize via LLM if available
      let assistantText: string;
      if (this.llmService && content) {
        // Update loading message
        this.eventStore.append({
          type: "message_updated",
          payload: {
            id: loadingId,
            updates: {
              text: isSearch
                ? "Analizuję wyniki wyszukiwania..."
                : "Analizuję treść strony...",
              url: browseResult.url,
            },
          },
        });

        const summary = isSearch
          ? await this.llmService.summarizeSearch(browseResult.content, query)
          : await this.llmService.summarize(browseResult.content);
        const safeSummary = typeof summary === "string" ? summary.trim() : "";

        this.eventStore.append({
          type: "summary_generated",
          payload: {
            messageId: loadingId,
            summary: safeSummary,
            mode: isSearch ? "search" : "browse",
          },
          timestamp: Date.now(),
        });

        assistantText = safeSummary
          ? safeSummary
          : content
            ? content
            : `Nie udało się wyodrębnić treści z: ${browseResult.url}`;
      } else {
        assistantText = content
          ? content
          : `Nie udało się wyodrębnić treści z: ${browseResult.url}`;
      }

      // 5. Final message update
      this.eventStore.append({
        type: "message_updated",
        payload: {
          id: loadingId,
          updates: {
            text: assistantText,
            pageTitle: browseResult.title,
            url: browseResult.url,
            loading: false,
            screenshotBase64: browseResult.screenshot_base64,
            rssUrl: browseResult.rss_url,
            contactUrl: browseResult.contact_url,
            phoneUrl: browseResult.phone_url,
          },
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Browse command failed", { error: errorMsg });

      this.eventStore.append({
        type: "error_occurred",
        payload: { context: "browse", error: errorMsg, url: resolvedUrl },
        timestamp: Date.now(),
      });

      this.eventStore.append({
        type: "message_updated",
        payload: {
          id: loadingId,
          updates: {
            text: `Nie udało się pobrać strony: ${errorMsg}`,
            loading: false,
          },
        },
      });
    }
  }
}

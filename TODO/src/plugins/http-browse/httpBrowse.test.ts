import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HttpBrowsePlugin,
  AllOriginsJsonStrategy,
  type FetchStrategy,
  type FetchStrategyResult,
  type ContentExtractor,
} from "./httpBrowsePlugin";
import { buildQuery } from "../../core/intentRouter";

// ── Mock Strategy ───────────────────────────────────────────

function createMockStrategy(
  name: string,
  priority: number,
  result?: Partial<FetchStrategyResult>,
  shouldFail = false,
): FetchStrategy {
  return {
    name,
    priority,
    isAvailable: () => true,
    fetch: shouldFail
      ? vi.fn().mockRejectedValue(new Error(`${name} failed`))
      : vi.fn().mockResolvedValue({
          html: "<html><title>Test</title><body>Hello World</body></html>",
          source: name,
          ...result,
        }),
  };
}

describe("HttpBrowsePlugin", () => {
  let plugin: HttpBrowsePlugin;

  describe("with default strategies", () => {
    beforeEach(() => {
      plugin = new HttpBrowsePlugin({
        strategies: [
          createMockStrategy("primary", 90),
          createMockStrategy("backup", 50),
        ],
      });
    });

    it("executes query using highest priority strategy", async () => {
      const query = buildQuery("browse", "https://onet.pl");
      const result = await plugin.execute(query);

      expect(result.status).toBe("success");
      expect(result.pluginId).toBe("http-browse");
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
    });

    it("adds https:// prefix to bare domains", async () => {
      const strategy = createMockStrategy("spy", 100);
      const spyPlugin = new HttpBrowsePlugin({ strategies: [strategy] });

      await spyPlugin.execute(buildQuery("browse", "onet.pl"));

      expect(strategy.fetch).toHaveBeenCalledWith("https://onet.pl");
    });

    it("uses resolvedTarget over rawInput", async () => {
      const strategy = createMockStrategy("spy", 100);
      const spyPlugin = new HttpBrowsePlugin({ strategies: [strategy] });

      await spyPlugin.execute(
        buildQuery("browse", "onet kropka pe el", {
          resolvedTarget: "https://onet.pl",
        }),
      );

      expect(strategy.fetch).toHaveBeenCalledWith("https://onet.pl");
    });
  });

  describe("fallback chain", () => {
    it("falls back to next strategy on failure", async () => {
      const failing = createMockStrategy("failing", 90, {}, true);
      const working = createMockStrategy("working", 50);

      plugin = new HttpBrowsePlugin({ strategies: [failing, working] });

      const result = await plugin.execute(
        buildQuery("browse", "https://example.com"),
      );

      expect(result.status).toBe("success");
      expect(failing.fetch).toHaveBeenCalled();
      expect(working.fetch).toHaveBeenCalled();
    });

    it("returns error when all strategies fail", async () => {
      plugin = new HttpBrowsePlugin({
        strategies: [
          createMockStrategy("s1", 90, {}, true),
          createMockStrategy("s2", 50, {}, true),
        ],
      });

      const result = await plugin.execute(
        buildQuery("browse", "https://example.com"),
      );

      expect(result.status).toBe("error");
      expect(result.content[0].data).toContain("Nie udało się");
    });

    it("skips unavailable strategies", async () => {
      const unavailable: FetchStrategy = {
        name: "unavailable",
        priority: 100,
        isAvailable: () => false,
        fetch: vi.fn(),
      };
      const available = createMockStrategy("available", 50);

      plugin = new HttpBrowsePlugin({
        strategies: [unavailable, available],
      });

      const result = await plugin.execute(
        buildQuery("browse", "https://example.com"),
      );

      expect(result.status).toBe("success");
      expect(unavailable.fetch).not.toHaveBeenCalled();
    });
  });

  describe("content truncation", () => {
    it("truncates content over maxContentLength", async () => {
      const longContent = "x".repeat(100_000);
      const strategy = createMockStrategy("big", 90, {
        html: `<html><body>${longContent}</body></html>`,
      });

      plugin = new HttpBrowsePlugin({
        strategies: [strategy],
        maxContentLength: 1_000,
      });

      const result = await plugin.execute(
        buildQuery("browse", "https://example.com"),
      );

      expect(result.status).toBe("success");
      expect(result.content[0].data.length).toBeLessThanOrEqual(1_000);
      expect(result.metadata.truncated).toBe(true);
    });
  });

  describe("custom extractor", () => {
    it("uses injected content extractor", async () => {
      const extractor: ContentExtractor = {
        extract: vi.fn().mockReturnValue({
          title: "Custom Title",
          text: "Custom extracted content",
          summary: "Custom summary",
        }),
      };

      plugin = new HttpBrowsePlugin({
        strategies: [createMockStrategy("s", 90)],
        extractor,
      });

      const result = await plugin.execute(
        buildQuery("browse", "https://example.com"),
      );

      expect(extractor.extract).toHaveBeenCalled();
      expect(result.content[0].title).toBe("Custom Title");
      expect(result.content[0].data).toBe("Custom extracted content");
    });
  });

  describe("addStrategy", () => {
    it("dynamically adds strategy and sorts by priority", async () => {
      const original = createMockStrategy("original", 50);
      plugin = new HttpBrowsePlugin({ strategies: [original] });

      const dynamic = createMockStrategy("dynamic", 100);
      plugin.addStrategy(dynamic);

      await plugin.execute(buildQuery("browse", "https://example.com"));

      // Dynamic should be tried first (higher priority)
      expect(dynamic.fetch).toHaveBeenCalled();
    });
  });

  describe("capabilities", () => {
    it("reports correct capabilities", () => {
      plugin = new HttpBrowsePlugin();

      expect(plugin.capabilities.intents).toContain("browse");
      expect(plugin.capabilities.intents).toContain("search");
      expect(plugin.capabilities.browserCompatible).toBe(true);
      expect(plugin.capabilities.requiresNetwork).toBe(true);
    });
  });

  describe("isAvailable", () => {
    it("returns true when at least one strategy is available", async () => {
      plugin = new HttpBrowsePlugin({
        strategies: [createMockStrategy("s", 50)],
      });

      expect(await plugin.isAvailable()).toBe(true);
    });
  });
});

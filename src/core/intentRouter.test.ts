import { describe, it, expect, beforeEach, vi } from "vitest";
import { IntentRouter, buildQuery, type LlmIntentDetector } from "./intentRouter";
import { PluginRegistry } from "./pluginRegistry";
import type { DataSourcePlugin, PluginCapabilities } from "./plugin.types";

function createPlugin(
  id: string,
  overrides: Partial<PluginCapabilities> = {},
): DataSourcePlugin {
  return {
    id,
    name: `Mock ${id}`,
    capabilities: {
      intents: ["browse"],
      streaming: false,
      requiresNetwork: true,
      browserCompatible: true,
      priority: 50,
      ...overrides,
    },
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({
      pluginId: id,
      status: "success",
      content: [{ type: "text", data: `result from ${id}` }],
      metadata: { duration_ms: 5, cached: false, truncated: false },
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe("IntentRouter", () => {
  let registry: PluginRegistry;
  let router: IntentRouter;

  beforeEach(() => {
    registry = new PluginRegistry();
    router = new IntentRouter({ registry, isTauri: false });
  });

  describe("detectIntent", () => {
    it("detects direct URLs as browse", async () => {
      registry.register(createPlugin("http", { intents: ["browse"] }));
      expect(await router.detectIntent("https://onet.pl")).toBe("browse");
    });

    it("detects bare domains as browse", async () => {
      registry.register(createPlugin("http", { intents: ["browse"] }));
      expect(await router.detectIntent("onet.pl")).toBe("browse");
    });

    it("detects Polish phonetic as browse", async () => {
      registry.register(createPlugin("http", { intents: ["browse"] }));
      expect(await router.detectIntent("onet kropka pe el")).toBe("browse");
    });

    it("detects camera keywords", async () => {
      registry.register(
        createPlugin("camera", { intents: ["camera:describe"] }),
      );
      expect(await router.detectIntent("co widać na kamerze")).toBe(
        "camera:describe",
      );
    });

    it("detects IoT sensor keywords", async () => {
      registry.register(createPlugin("mqtt", { intents: ["iot:read"] }));
      expect(await router.detectIntent("jaka jest temperatura")).toBe(
        "iot:read",
      );
    });

    it("falls back to search for natural language", async () => {
      registry.register(createPlugin("search", { intents: ["search"] }));
      expect(await router.detectIntent("restauracje w Gdańsku")).toBe(
        "search",
      );
    });

    it("returns search for empty input", async () => {
      expect(await router.detectIntent("")).toBe("search");
    });

    it("falls back to search when no plugin matches intent", async () => {
      registry.register(createPlugin("search", { intents: ["search"] }));
      // Camera intent detected by rules, but no camera plugin registered
      expect(await router.detectIntent("pokaż kamerę")).toBe("search");
    });

    it("uses LLM detector as fallback", async () => {
      const llmDetector: LlmIntentDetector = {
        detect: vi.fn().mockResolvedValue("api:query"),
      };
      registry.register(
        createPlugin("api", { intents: ["api:query"], priority: 80 }),
      );
      registry.register(
        createPlugin("search", { intents: ["search"], priority: 10 }),
      );

      const routerWithLlm = new IntentRouter({
        registry,
        llmDetector,
        isTauri: false,
      });

      // "zapytaj serwer o status" doesn't match high-priority rules,
      // but LLM should detect it as api:query
      expect(await routerWithLlm.detectIntent("zapytaj serwer o status")).toBe(
        "api:query",
      );
    });
  });

  describe("route", () => {
    it("routes to matching plugin and returns result", async () => {
      const plugin = createPlugin("http", { intents: ["browse"] });
      registry.register(plugin);

      const query = buildQuery("browse", "https://onet.pl");
      const result = await router.route(query);

      expect(result.status).toBe("success");
      expect(result.pluginId).toBe("http");
      expect(plugin.execute).toHaveBeenCalledWith(query);
    });

    it("returns error when no plugin matches", async () => {
      const query = buildQuery("mqtt:read", "temperatura salon");
      const result = await router.route(query);

      expect(result.status).toBe("error");
      expect(result.content[0].data).toContain("Brak pluginu");
    });

    it("falls back to next plugin on failure", async () => {
      const failing = createPlugin("failing", {
        intents: ["browse"],
        priority: 90,
      });
      (failing.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("network error"),
      );

      const backup = createPlugin("backup", {
        intents: ["browse"],
        priority: 50,
      });

      registry.register(failing);
      registry.register(backup);

      const query = buildQuery("browse", "https://onet.pl");
      const result = await router.route(query);

      expect(result.status).toBe("success");
      expect(result.pluginId).toBe("backup");
    });

    it("skips unavailable plugins", async () => {
      const unavailable = createPlugin("unavailable", {
        intents: ["browse"],
        priority: 90,
      });
      (unavailable.isAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(
        false,
      );

      const available = createPlugin("available", {
        intents: ["browse"],
        priority: 50,
      });

      registry.register(unavailable);
      registry.register(available);

      const query = buildQuery("browse", "https://onet.pl");
      const result = await router.route(query);

      expect(result.pluginId).toBe("available");
      expect(unavailable.execute).not.toHaveBeenCalled();
    });
  });

  describe("addRule", () => {
    it("custom rules take effect", async () => {
      registry.register(
        createPlugin("custom", { intents: ["custom:action"] }),
      );

      router.addRule({
        intent: "custom:action",
        test: (input) => input.startsWith("!custom"),
        priority: 95,
      });

      expect(await router.detectIntent("!custom do something")).toBe(
        "custom:action",
      );
    });
  });
});

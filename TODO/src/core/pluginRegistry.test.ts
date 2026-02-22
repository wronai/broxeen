import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginRegistry, resetDefaultRegistry, getDefaultRegistry } from "./pluginRegistry";
import type {
  DataSourcePlugin,
  PluginCapabilities,
  PluginQuery,
  PluginResult,
  ContentBlock,
} from "./plugin.types";

// ── Test Helpers ────────────────────────────────────────────

function createMockPlugin(
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
      content: [{ type: "text", data: "mock result" }],
      metadata: { duration_ms: 10, cached: false, truncated: false },
    } satisfies PluginResult),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ───────────────────────────────────────────────────

describe("PluginRegistry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
    resetDefaultRegistry();
  });

  describe("register / unregister", () => {
    it("registers a plugin and retrieves it by ID", () => {
      const plugin = createMockPlugin("http-browse");
      registry.register(plugin);

      expect(registry.get("http-browse")).toBe(plugin);
      expect(registry.size).toBe(1);
    });

    it("throws on duplicate registration", () => {
      const plugin = createMockPlugin("http-browse");
      registry.register(plugin);

      expect(() => registry.register(plugin)).toThrow("already registered");
    });

    it("unregisters a plugin", () => {
      const plugin = createMockPlugin("http-browse");
      registry.register(plugin);
      registry.unregister("http-browse");

      expect(registry.get("http-browse")).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it("unregister on non-existent ID is no-op", () => {
      expect(() => registry.unregister("nonexistent")).not.toThrow();
    });
  });

  describe("getForIntent", () => {
    it("returns plugins matching intent sorted by priority", () => {
      const low = createMockPlugin("low", { intents: ["browse"], priority: 10 });
      const high = createMockPlugin("high", { intents: ["browse"], priority: 90 });
      const mid = createMockPlugin("mid", { intents: ["browse"], priority: 50 });

      registry.register(low);
      registry.register(high);
      registry.register(mid);

      const result = registry.getForIntent("browse");

      expect(result.map((p) => p.id)).toEqual(["high", "mid", "low"]);
    });

    it("returns empty array for unknown intent", () => {
      registry.register(createMockPlugin("http-browse"));

      expect(registry.getForIntent("mqtt-read")).toEqual([]);
    });

    it("filters by multiple intents on same plugin", () => {
      const multi = createMockPlugin("multi", {
        intents: ["browse", "search"],
      });
      registry.register(multi);

      expect(registry.getForIntent("browse")).toHaveLength(1);
      expect(registry.getForIntent("search")).toHaveLength(1);
      expect(registry.getForIntent("mqtt")).toHaveLength(0);
    });
  });

  describe("getAvailableForIntent", () => {
    it("excludes non-browser-compatible plugins when not Tauri", () => {
      const browserOk = createMockPlugin("browser-ok", {
        intents: ["browse"],
        browserCompatible: true,
      });
      const tauriOnly = createMockPlugin("tauri-only", {
        intents: ["browse"],
        browserCompatible: false,
      });

      registry.register(browserOk);
      registry.register(tauriOnly);

      expect(registry.getAvailableForIntent("browse", false)).toHaveLength(1);
      expect(registry.getAvailableForIntent("browse", true)).toHaveLength(2);
    });
  });

  describe("lifecycle", () => {
    it("initializeAll calls initialize on each plugin", async () => {
      const p1 = createMockPlugin("p1");
      const p2 = createMockPlugin("p2");
      registry.register(p1);
      registry.register(p2);

      const results = await registry.initializeAll();

      expect(p1.initialize).toHaveBeenCalledOnce();
      expect(p2.initialize).toHaveBeenCalledOnce();
      expect(results.get("p1")).toBeNull();
      expect(results.get("p2")).toBeNull();
    });

    it("initializeAll isolates failures", async () => {
      const good = createMockPlugin("good");
      const bad = createMockPlugin("bad");
      (bad.initialize as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("init failed"),
      );

      registry.register(good);
      registry.register(bad);

      const results = await registry.initializeAll();

      expect(results.get("good")).toBeNull();
      expect(results.get("bad")).toBeInstanceOf(Error);
      expect(results.get("bad")!.message).toBe("init failed");
    });

    it("disposeAll calls dispose on each plugin", async () => {
      const p1 = createMockPlugin("p1");
      registry.register(p1);

      await registry.disposeAll();

      expect(p1.dispose).toHaveBeenCalledOnce();
      expect(registry.size).toBe(0);
    });
  });

  describe("events", () => {
    it("emits plugin:registered event", () => {
      const handler = vi.fn();
      registry.onPluginEvent(handler);

      registry.register(createMockPlugin("test"));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "plugin:registered",
          pluginId: "test",
        }),
      );
    });

    it("unsubscribe stops events", () => {
      const handler = vi.fn();
      const unsub = registry.onPluginEvent(handler);
      unsub();

      registry.register(createMockPlugin("test"));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("singleton", () => {
    it("getDefaultRegistry returns same instance", () => {
      const a = getDefaultRegistry();
      const b = getDefaultRegistry();
      expect(a).toBe(b);
    });

    it("resetDefaultRegistry creates fresh instance", () => {
      const a = getDefaultRegistry();
      resetDefaultRegistry();
      const b = getDefaultRegistry();
      expect(a).not.toBe(b);
    });
  });
});

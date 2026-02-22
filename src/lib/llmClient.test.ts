import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock runtime
vi.mock("./runtime", () => ({ isTauriRuntime: () => false }));
vi.mock("./logger", () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  logAsyncDecorator: (scope: string, name: string, fn: any) => fn,
  logSyncDecorator: (scope: string, name: string, fn: any) => fn,
}));

// Must import after mocks
const { chat, askAboutContent, describeImage, summarizeForTts, detectIntent } =
  await import("./llmClient");
const { configStore } = await import("../config/configStore");

// ── Helpers ──────────────────────────────────────────

function mockFetchSuccess(
  responseText: string,
  model = "google/gemini-3-flash-preview",
) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: responseText } }],
        model,
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
  });
}

function mockFetchError(status: number, body: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ── Tests ────────────────────────────────────────────

describe("llmClient", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "");
    configStore.set('llm.apiKey', 'test-key-123');
    configStore.set('llm.model', 'google/gemini-3-flash-preview');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("chat", () => {
    it("sends messages and returns response", async () => {
      mockFetchSuccess("Cześć, jestem asystentem!");

      const resp = await chat([{ role: "user", content: "Cześć" }]);

      expect(resp.text).toBe("Cześć, jestem asystentem!");
      expect(resp.model).toBe("google/gemini-3-flash-preview");
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const [url, opts] = (global.fetch as any).mock.calls[0];
      expect(url).toContain("openrouter.ai");
      const body = JSON.parse(opts.body);
      expect(body.model).toBe("google/gemini-3-flash-preview");
      expect(body.messages).toHaveLength(1);
    });

    it("throws on missing API key", async () => {
      configStore.set('llm.apiKey', '');
      await expect(chat([{ role: "user", content: "test" }])).rejects.toThrow(
        "OPENROUTER_API_KEY not set",
      );
    });

    it("throws on HTTP error", async () => {
      mockFetchError(429, "Rate limited");
      await expect(chat([{ role: "user", content: "test" }])).rejects.toThrow(
        "LLM HTTP 429",
      );
    });

    it("uses config overrides", async () => {
      mockFetchSuccess("ok");
      await chat([{ role: "user", content: "test" }], {
        model: "anthropic/claude-sonnet-4",
        maxTokens: 100,
      });

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.model).toBe("anthropic/claude-sonnet-4");
      expect(body.max_tokens).toBe(100);
    });
  });

  describe("askAboutContent", () => {
    it("sends page content + question", async () => {
      mockFetchSuccess("Na stronie jest artykuł o programowaniu.");

      const result = await askAboutContent(
        "To jest treść strony o programowaniu w TypeScript...",
        "O czym jest ta strona?",
      );

      expect(result).toContain("programowaniu");
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages).toHaveLength(2); // system + user
      expect(body.messages[1].content).toContain("Pytanie:");
    });

    it("truncates long content", async () => {
      mockFetchSuccess("ok");
      const longContent = "x".repeat(10000);
      await askAboutContent(longContent, "test");

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.messages[1].content.length).toBeLessThan(10000);
    });
  });

  describe("describeImage", () => {
    it("sends multimodal message with base64 image", async () => {
      mockFetchSuccess("Widzę stronę z nagłówkiem i menu.");

      const result = await describeImage("iVBOR...", "image/png");
      expect(result).toContain("Widzę");

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      const userMsg = body.messages[1];
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content[1].type).toBe("image_url");
      expect(userMsg.content[1].image_url.url).toContain(
        "data:image/png;base64,",
      );
    });
  });

  describe("summarizeForTts", () => {
    it("returns TTS-friendly summary", async () => {
      mockFetchSuccess("Strona zawiera informacje o pogodzie w Gdańsku.");

      const result = await summarizeForTts("Pogoda w Gdańsku...");
      expect(result).toContain("pogodzie");
    });
  });

  describe("detectIntent", () => {
    it("returns intent keyword", async () => {
      mockFetchSuccess("BROWSE");
      const intent = await detectIntent("otwórz google.com");
      expect(intent).toBe("BROWSE");
    });

    it("handles lowercase response", async () => {
      mockFetchSuccess("  ask  ");
      const intent = await detectIntent("co jest na tej stronie?");
      expect(intent).toBe("ASK");
    });
  });
});

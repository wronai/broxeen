import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { executeBrowseCommand } from "./browseGateway";

describe("browseGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes Tauri command in tauri runtime", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Example",
      content: "Body",
    });

    const result = await executeBrowseCommand("https://example.com", true);

    expect(mockInvoke).toHaveBeenCalledWith("browse", {
      url: "https://example.com",
    });
    expect(result).toMatchObject({
      url: "https://example.com",
      title: "Example",
      content: "Body",
    });
  });

  it("uses browser fallback outside tauri runtime", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: "<html><body>Example body</body></html>",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://example.com", false);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.allorigins.win/get?url="),
    );
    expect(result.url).toBe("https://example.com");
    expect(result.content).toContain("Example body");
    expect(result.content).not.toContain("<html");
  });

  it("extracts readable title and text from browser fallback HTML", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: `
          <html>
            <head>
              <title>Google</title>
              <script>console.log("hidden");</script>
            </head>
            <body>
              <main>
                <p>
                  Search the world's information, including webpages, images, videos and more.
                  Google has many special features to help you find exactly what you're looking for.
                </p>
              </main>
            </body>
          </html>
        `,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://google.com", false);

    expect(result.title).toBe("Google");
    expect(result.content).toContain("Search the world's information");
    expect(result.content).not.toContain("<html");
    expect(result.content).not.toContain("<script");
  });

  it("throws when browser fallback response is not ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeBrowseCommand("https://example.com", false),
    ).rejects.toThrow("HTTP 503: Service Unavailable");
  });
});

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

  it("normalizes raw HTML payload returned by tauri command", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: "",
      content: `
        <html>
          <body>
            <main>
              <p>
                This page contains enough readable text to pass extraction thresholds and
                should be returned as normalized plain text instead of raw HTML markup.
              </p>
            </main>
          </body>
        </html>
      `,
    });

    const result = await executeBrowseCommand("https://example.com", true);

    expect(result.title).toBe("https://example.com");
    expect(result.content).toContain("normalized plain text");
    expect(result.content).not.toContain("<html");
  });

  it("returns fallback text when tauri response has empty content", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Example",
      content: "   ",
    });

    const result = await executeBrowseCommand("https://example.com", true);

    expect(result.content).toBe("Nie udało się wyodrębnić treści ze strony.");
  });

  it("handles malformed tauri payload without throwing", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: undefined,
      content: undefined,
    } as unknown as Awaited<ReturnType<typeof executeBrowseCommand>>);

    const result = await executeBrowseCommand("https://example.com", true);

    expect(result.title).toBe("https://example.com");
    expect(result.content).toBe("Nie udało się wyodrębnić treści ze strony.");
  });

  it("uses safe fallback URL when tauri payload URL is missing", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: undefined,
      title: "",
      content: "   ",
    } as unknown as Awaited<ReturnType<typeof executeBrowseCommand>>);

    const result = await executeBrowseCommand("https://example.com", true);

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("https://example.com");
    expect(result.content).toBe("Nie udało się wyodrębnić treści ze strony.");
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
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.url).toBe("https://example.com");
    expect(result.content).toContain("Example body");
    expect(result.content).not.toContain("<html");
  });

  it("falls back to AllOrigins RAW when AllOrigins JSON and corsproxy fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(`
          <html>
            <head><title>Fallback title</title></head>
            <body>
              <main>
                <p>
                  This is fallback content from AllOrigins RAW endpoint with enough text
                  to be extracted as readable output in browser mode.
                </p>
              </main>
            </body>
          </html>
        `),
        headers: {
          get: vi.fn().mockReturnValue("text/html"),
        },
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://example.com", false);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.title).toBe("Fallback title");
    expect(result.content).toContain(
      "fallback content from AllOrigins RAW endpoint",
    );
  });

  it("falls back to Jina proxy when AllOrigins endpoints fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: vi
          .fn()
          .mockResolvedValue(
            "Jina fallback plain text content for browser mode.",
          ),
        headers: {
          get: vi.fn().mockReturnValue("text/plain"),
        },
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://example.com", false);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Untitled");
    expect(result.content).toContain("Jina fallback plain text content");
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

  it("strips cookie banner boilerplate from extracted content", async () => {
    const cookieBanner =
      "Strona korzysta z plików tekstowych zwanych ciasteczkami, aby zapewnić użytkownikom jak najlepszą obsługę. Są one zapisywane w przeglądarce i pozwalają rozpoznać Cię podczas kolejnej wizyty w serwisie. Dzięki nim właściciele witryny mogą lepiej zrozumieć, które treści są dla Ciebie najbardziej przydatne i interesujące. Pomaga to w ciągłym ulepszaniu zawartości strony i dostosowywaniu jej do Twoich potrzeb. Korzystanie z witryny oznacza akceptację tych mechanizmów.";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: `
          <html>
            <head><title>Example</title></head>
            <body>
              <main>
                <p>${cookieBanner}</p>
                <p>
                  This page contains enough readable text to pass extraction thresholds and should remain
                  even after cookie boilerplate is stripped.
                </p>
              </main>
            </body>
          </html>
        `,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://example.com", false);

    expect(result.title).toBe("Example");
    expect(result.content).toContain("This page contains enough readable text");
    expect(result.content).not.toContain("zwanych ciasteczkami");
  });

  it("strips nav, footer, button, and form elements from extracted content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: `
          <html>
            <head><title>Portal Informacyjny</title></head>
            <body>
              <nav><a href="/">Strona główna</a> <a href="/sport">Sport</a> <a href="/pogoda">Pogoda</a></nav>
              <header><button>Zaloguj się</button> <button>Menu</button></header>
              <main>
                <article>
                  <p>
                    Naukowcy z Polskiej Akademii Nauk odkryli nowy gatunek motyla w Puszczy Białowieskiej.
                    Odkrycie ma duże znaczenie dla ochrony bioróżnorodności w Europie Środkowej.
                  </p>
                </article>
              </main>
              <footer>
                <p>© 2026 Portal. Regulamin. Polityka prywatności. Kontakt: info@portal.pl</p>
              </footer>
              <form><input type="text" placeholder="Szukaj..." /><button>Szukaj</button></form>
            </body>
          </html>
        `,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand("https://portal.pl", false);

    expect(result.title).toBe("Portal Informacyjny");
    expect(result.content).toContain("Polskiej Akademii Nauk");
    expect(result.content).not.toContain("Zaloguj się");
    expect(result.content).not.toContain("Szukaj");
    expect(result.content).not.toContain("Regulamin");
    expect(result.content).not.toContain("Strona główna");
  });

  it("filters out navigation menu items from content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: `
          <html>
            <head><title>News Site</title></head>
            <body>
              <aside class="sidebar">
                <ul><li>Popularne</li><li>Najnowsze</li><li>Komentarze</li></ul>
              </aside>
              <div role="navigation"><a>Home</a> <a>About</a> <a>Contact</a></div>
              <article>
                <p>
                  The latest research shows that renewable energy adoption has increased by 40 percent
                  across European countries in the past year, marking a significant milestone in
                  the transition to sustainable energy sources.
                </p>
              </article>
            </body>
          </html>
        `,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeBrowseCommand(
      "https://news.example.com",
      false,
    );

    expect(result.content).toContain("renewable energy");
    expect(result.content).not.toContain("Popularne");
    expect(result.content).not.toContain("Najnowsze");
    expect(result.content).not.toContain("Contact");
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
    ).rejects.toThrow("Nie udało się pobrać strony");

    await expect(
      executeBrowseCommand("https://example.com", false),
    ).rejects.toThrow("żaden z serwerów proxy");
  });
});

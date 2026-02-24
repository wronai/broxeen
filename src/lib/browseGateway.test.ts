import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { executeBrowseCommand } from "./browseGateway";

// Import the internal functions for testing
import {
  looksLikeRssOrAtom,
  extractRssAtomContent,
  normalizeBrowseResult,
} from "./browseGateway";

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
    // Each proxy fetcher retries up to 2 times on 500 (transient).
    // So allorigins:get uses 3 calls, corsproxy uses 3 calls,
    // and then allorigins:raw succeeds on the first attempt.
    const fail500 = () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    const fetchMock = vi
      .fn()
      // allorigins:get — 1 original + 2 retries = 3 calls
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      // corsproxy — 1 original + 2 retries = 3 calls
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      // allorigins:raw — succeeds
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

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(result.title).toBe("Fallback title");
    expect(result.content).toContain(
      "fallback content from AllOrigins RAW endpoint",
    );
  });

  it("falls back to Jina proxy when AllOrigins endpoints fail", async () => {
    // Each proxy fetcher retries up to 2 times on 500 (transient).
    // allorigins:get=3 + corsproxy=3 + allorigins:raw=3 = 9 failures,
    // then Jina succeeds on first attempt = 10 total.
    const fail500 = () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    const fetchMock = vi
      .fn()
      // allorigins:get — 3 calls
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      // corsproxy — 3 calls
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      // allorigins:raw — 3 calls
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      // jina — succeeds
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

    expect(fetchMock).toHaveBeenCalledTimes(10);
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

    const legalDisclaimer = "Pobieranie, zwielokrotnianie, przechowywanie lub jakiekolwiek inne wykorzystywanie treści dostępnych w niniejszym serwisie wymaga uprzedniej i jednoznacznej zgody Wirtualna Polska Media Spółka Akcyjna z siedzibą w Warszawie.";

    const onetDisclaimer = "Systematyczne pobieranie treści, danych lub informacji z tej strony internetowej (web scraping), jak również eksploracja tekstu i danych (TDM) bez uprzedniej, wyraźnej zgody Ringier Axel Springer Polska sp. z o.o. (RASP) jest zabronione.";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        contents: `
          <html>
            <head><title>Example</title></head>
            <body>
              <main>
                <p>${cookieBanner}</p>
                <p>${legalDisclaimer}</p>
                <p>${onetDisclaimer}</p>
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
    expect(result.content).not.toContain("Wirtualna Polska Media");
    expect(result.content).not.toContain("Ringier Axel Springer");
    expect(result.content).not.toContain("web scraping");
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

describe("RSS/Atom Feed Detection and Parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("looksLikeRssOrAtom", () => {
    it("detects RSS 2.0 feeds", () => {
      const rssContent = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Test Feed</title>
          </channel>
        </rss>`;
      expect(looksLikeRssOrAtom(rssContent)).toBe(true);
    });

    it("detects Atom feeds", () => {
      const atomContent = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Test Feed</title>
        </feed>`;
      expect(looksLikeRssOrAtom(atomContent)).toBe(true);
    });

    it("detects RSS 1.0/RDF feeds", () => {
      const rdfContent = `<?xml version="1.0" encoding="UTF-8"?>
        <rdf:RDF xmlns="http://purl.org/rss/1.0/">
          <channel>
            <title>Test Feed</title>
          </channel>
        </rdf:RDF>`;
      expect(looksLikeRssOrAtom(rdfContent)).toBe(true);
    });

    it("does not detect HTML content", () => {
      const htmlContent = `<!DOCTYPE html>
        <html>
          <head><title>Page</title></head>
          <body><p>Content</p></body>
        </html>`;
      expect(looksLikeRssOrAtom(htmlContent)).toBe(false);
    });

    it("does not detect plain text", () => {
      const textContent = "This is just plain text content without any XML tags.";
      expect(looksLikeRssOrAtom(textContent)).toBe(false);
    });
  });

  describe("extractRssAtomContent", () => {
    beforeEach(() => {
      // Mock DOMParser for tests
      const mockDOMParser = vi.fn().mockImplementation(() => ({
        parseFromString: vi.fn().mockImplementation((xml: string, mimeType: string) => {
          // Create a simple mock document structure
          const mockDocument = {
            querySelector: vi.fn().mockImplementation((selector: string) => {
              // Mock different selectors based on the input
              if (selector === 'parsererror') {
                // Check if XML is malformed
                if (xml.includes('Broken Feed') && !xml.includes('</title>')) {
                  return { textContent: 'XML parsing error' };
                }
                return null;
              }
              
              if (selector === 'rss, rdf:rdf') {
                return xml.includes('<rss') || xml.includes('<rdf:RDF') ? {} : null;
              }
              
              if (selector === 'feed') {
                return xml.includes('<feed') ? {} : null;
              }
              
              if (selector === 'channel') {
                if (xml.includes('<channel>')) {
                  return {
                    querySelector: vi.fn().mockImplementation((subSelector: string) => {
                      if (subSelector === 'title') {
                        return { textContent: xml.includes('Technology News') ? 'Technology News' : 'Test RSS' };
                      }
                      if (subSelector === 'description') {
                        return { textContent: xml.includes('Latest tech updates') ? 'Latest tech updates' : '' };
                      }
                      return null;
                    }),
                    querySelectorAll: vi.fn().mockImplementation((subSelector: string) => {
                      if (subSelector === 'item') {
                        // Return mock items based on content
                        if (xml.includes('New AI Breakthrough')) {
                          return [
                            {
                              querySelector: vi.fn().mockImplementation((itemSelector: string) => ({
                                textContent: itemSelector === 'title' ? 'New AI Breakthrough' :
                                            itemSelector === 'link' ? 'https://example.com/ai-breakthrough' :
                                            itemSelector === 'description' ? 'Scientists have made a major breakthrough in AI research.' :
                                            itemSelector === 'pubDate' ? 'Mon, 24 Feb 2026 10:00:00 GMT' : ''
                              }))
                            },
                            {
                              querySelector: vi.fn().mockImplementation((itemSelector: string) => ({
                                textContent: itemSelector === 'title' ? 'Quantum Computing Update' :
                                            itemSelector === 'link' ? 'https://example.com/quantum' :
                                            itemSelector === 'description' ? 'Quantum computers reach new milestone.' :
                                            itemSelector === 'pubDate' ? 'Sun, 23 Feb 2026 15:30:00 GMT' : ''
                              }))
                            }
                          ];
                        }
                        return [{
                          querySelector: vi.fn().mockImplementation((itemSelector: string) => ({
                            textContent: itemSelector === 'title' ? 'Test Item' :
                                        itemSelector === 'description' ? 'Test description' : ''
                          }))
                        }];
                      }
                      return [];
                    })
                  };
                }
                return null;
              }
              
              if (selector === 'feed') {
                return {
                  querySelector: vi.fn().mockImplementation((subSelector: string) => {
                    if (subSelector === 'title') {
                      return { textContent: xml.includes('Science Blog') ? 'Science Blog' : 'Test Atom' };
                    }
                    if (subSelector === 'subtitle') {
                      return { textContent: xml.includes('Latest scientific discoveries') ? 'Latest scientific discoveries' : '' };
                    }
                    return null;
                  }),
                  querySelectorAll: vi.fn().mockImplementation((subSelector: string) => {
                    if (subSelector === 'entry') {
                      if (xml.includes('Mars Discovery')) {
                        return [
                          {
                            querySelector: vi.fn().mockImplementation((entrySelector: string) => {
                              if (entrySelector === 'title') return { textContent: 'Mars Discovery' };
                              if (entrySelector === 'summary') return { textContent: 'New evidence of water found on Mars.' };
                              if (entrySelector === 'published') return { textContent: '2026-02-24T10:00:00Z' };
                              if (entrySelector === 'link') return { getAttribute: vi.fn().mockReturnValue('https://example.com/mars') };
                              return null;
                            })
                          },
                          {
                            querySelector: vi.fn().mockImplementation((entrySelector: string) => {
                              if (entrySelector === 'title') return { textContent: 'Climate Study' };
                              if (entrySelector === 'content') return { textContent: 'Global temperatures continue to rise according to new study.' };
                              if (entrySelector === 'updated') return { textContent: '2026-02-23T14:30:00Z' };
                              if (entrySelector === 'link') return { getAttribute: vi.fn().mockReturnValue('https://example.com/climate') };
                              return null;
                            })
                          }
                        ];
                      }
                      return [{
                        querySelector: vi.fn().mockImplementation((entrySelector: string) => {
                          if (entrySelector === 'title') return { textContent: 'Atom Entry' };
                          if (entrySelector === 'summary') return { textContent: 'Atom summary' };
                          return null;
                        })
                      }];
                    }
                    return [];
                  })
                };
              }
              
              return null;
            })
          };
          return mockDocument;
        })
      }));
      
      vi.stubGlobal("DOMParser", mockDOMParser);
    });

    it("handles missing DOMParser gracefully", () => {
      // Remove DOMParser mock to test fallback
      vi.unstubAllGlobals();
      
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Technology News</title>
          </channel>
        </rss>`;

      const result = extractRssAtomContent(rssXml);

      expect(result.title).toBe("Feed Title");
      expect(result.content).toContain(rssXml.slice(0, 100)); // Should contain truncated XML
    });

    it("handles empty content", () => {
      const result = extractRssAtomContent("");

      expect(result.title).toBe("Untitled Feed");
      expect(result.content).toBe("Nie udało się wyodrębnić treści z kanału RSS/Atom.");
    });

    it("limits content to MAX_CONTENT_LENGTH", () => {
      // Create a long RSS feed
      let longContent = `<?xml version="1.0"?><rss><channel><title>Long Feed</title>`;
      for (let i = 0; i < 100; i++) {
        longContent += `<item><title>Item ${i}</title><description>This is item number ${i} with some long description to make it exceed the limit.</description></item>`;
      }
      longContent += `</channel></rss>`;

      const result = extractRssAtomContent(longContent);
      expect(result.content.length).toBeLessThanOrEqual(5000); // MAX_CONTENT_LENGTH
    });
  });

  describe("normalizeBrowseResult with RSS/Atom", () => {
    it("detects and normalizes RSS feed content", () => {
      const rssXml = `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>Test RSS</title>
            <item>
              <title>Test Item</title>
              <description>Test description</description>
            </item>
          </channel>
        </rss>`;

      const result = normalizeBrowseResult(
        {
          url: "https://example.com/feed.xml",
          title: "",
          content: rssXml,
        },
        "tauri",
        "https://example.com/feed.xml"
      );

      expect(result.content).toContain("## Test RSS");
      expect(result.content).toContain("### Ostatnie wpisy");
      expect(result.content).toContain("**1. Test Item**");
      expect(result.title).toBe("Test RSS");
    });

    it("detects and normalizes Atom feed content", () => {
      const atomXml = `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Test Atom</title>
          <entry>
            <title>Atom Entry</title>
            <summary>Atom summary</summary>
          </entry>
        </feed>`;

      const result = normalizeBrowseResult(
        {
          url: "https://example.com/atom.xml",
          title: "",
          content: atomXml,
        },
        "browser",
        "https://example.com/atom.xml"
      );

      expect(result.content).toContain("## Test Atom");
      expect(result.content).toContain("### Ostatnie wpisy");
      expect(result.content).toContain("**1. Atom Entry**");
      expect(result.title).toBe("Test Atom");
    });
  });
});

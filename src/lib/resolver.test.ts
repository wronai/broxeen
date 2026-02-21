import { describe, it, expect } from "vitest";
import { resolve } from "./resolver";

describe("resolve — exact URL", () => {
  it("przepuszcza https:// URL bez zmian", () => {
    const r = resolve("https://google.com");
    expect(r.url).toBe("https://google.com");
    expect(r.resolveType).toBe("exact");
    expect(r.needsClarification).toBe(false);
  });

  it("przepuszcza http:// URL bez zmian", () => {
    const r = resolve("http://example.com/path?q=1");
    expect(r.url).toBe("http://example.com/path?q=1");
    expect(r.resolveType).toBe("exact");
  });

  it("dodaje https:// do bare domeny", () => {
    const r = resolve("onet.pl");
    expect(r.url).toBe("https://onet.pl");
    expect(r.resolveType).toBe("exact");
  });

  it("dodaje https:// do domeny z subdomeną", () => {
    const r = resolve("www.google.com");
    expect(r.url).toBe("https://www.google.com");
    expect(r.resolveType).toBe("exact");
  });
});

describe("resolve — fonetyczne", () => {
  it("onet kropka pe el → https://onet.pl", () => {
    const r = resolve("onet kropka pe el");
    expect(r.url).toBe("https://onet.pl");
    expect(r.resolveType).toBe("fuzzy");
  });

  it("github kropka kom → https://github.com", () => {
    const r = resolve("github kropka kom");
    expect(r.url).toBe("https://github.com");
    expect(r.resolveType).toBe("fuzzy");
  });

  it("wikipedia kropka o er ge → https://wikipedia.org", () => {
    const r = resolve("wikipedia kropka o er ge");
    expect(r.url).toBe("https://wikipedia.org");
    expect(r.resolveType).toBe("fuzzy");
  });
});

describe("resolve — fuzzy matching", () => {
  it("'facbook' → fuzzy match do facebook.com", () => {
    const r = resolve("facbook");
    expect(r.url).toContain("facebook.com");
    expect(r.resolveType).toBe("fuzzy");
  });

  it("'gogle' → fuzzy match do google.com", () => {
    const r = resolve("gogle");
    expect(r.url).toContain("google.com");
  });

  it("'githb' → fuzzy match do github.com", () => {
    const r = resolve("githb");
    expect(r.url).toContain("github.com");
  });
});

describe("resolve — search fallback", () => {
  it("nieznane zapytanie → DuckDuckGo search", () => {
    const r = resolve("najlepsze restauracje w Gdańsku");
    expect(r.url).toContain("duckduckgo.com");
    expect(r.url).toContain("restauracje");
    expect(r.resolveType).toBe("search");
  });

  it("losowy tekst → search", () => {
    // String short enough and random enough to not fuzzy-match any domain
    const r = resolve("qqq");
    expect(r.resolveType).toBe("search");
    expect(r.url).toContain("duckduckgo.com");
  });

  it("wielowyrazowe zapytanie → search", () => {
    const r = resolve("najlepsze restauracje w Gdańsku");
    expect(r.resolveType).toBe("search");
    expect(r.url).toContain("duckduckgo.com");
    expect(r.url).toContain(encodeURIComponent("najlepsze"));
  });
});

describe("resolve — ambiguous / clarification", () => {
  it("pusty string → needsClarification", () => {
    const r = resolve("");
    expect(r.url).toBeNull();
    expect(r.needsClarification).toBe(true);
    expect(r.resolveType).toBe("ambiguous");
  });

  it("same spacje → needsClarification", () => {
    const r = resolve("   ");
    expect(r.needsClarification).toBe(true);
  });
});

describe("resolve — suggestions", () => {
  it("exact URL nie ma sugestii", () => {
    const r = resolve("https://google.com");
    expect(r.suggestions).toHaveLength(0);
  });

  it("search nie ma sugestii", () => {
    const r = resolve("zupełnie losowy tekst bez sensu xyz");
    expect(r.suggestions).toHaveLength(0);
  });
});

describe("resolve — normalizedInput", () => {
  it("exact URL → normalizedInput = input", () => {
    const r = resolve("https://google.com");
    expect(r.normalizedInput).toBe("https://google.com");
  });

  it("fonetyczne → normalizedInput = po normalizacji", () => {
    const r = resolve("onet kropka pe el");
    expect(r.normalizedInput).toBe("onet.pl");
  });
});

import { describe, it, expect } from "vitest";
import { normalize, looksLikeUrl } from "./phonetic";

describe("normalize — polskie domeny", () => {
  it.each([
    ["onet kropka pe el", "onet.pl"],
    ["allegro kropka pe el", "allegro.pl"],
    ["bankier kropka pe el", "bankier.pl"],
    ["wp kropka pe el", "wp.pl"],
    ["tvn24 kropka pe el", "tvn24.pl"],
    ["gazeta kropka pe el", "gazeta.pl"],
    ["interia kropka pe el", "interia.pl"],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("normalize — domeny międzynarodowe", () => {
  it.each([
    ["github kropka kom", "github.com"],
    ["google dot com", "google.com"],
    ["wikipedia kropka o er ge", "wikipedia.org"],
    ["youtube kropka kom", "youtube.com"],
    ["reddit kropka kom", "reddit.com"],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("normalize — separatory", () => {
  it.each([
    ["user małpa gmail kropka kom", "user@gmail.com"],
    ["example dash site kropka kom", "example-site.com"],
    ["my underscore page kropka pe el", "my_page.pl"],
    ["example myślnik site kropka kom", "example-site.com"],
    ["user podkreślnik name kropka pe el", "user_name.pl"],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("normalize — prefiksy protokołu", () => {
  it("przepuszcza gotowe URL bez zmian", () => {
    expect(normalize("google.com")).toBe("google.com");
    expect(normalize("onet.pl")).toBe("onet.pl");
  });

  it("konwertuje 'ha te te pe es' na 'https'", () => {
    expect(normalize("ha te te pe es kropka github kropka kom")).toBe(
      "https.github.com",
    );
  });
});

describe("normalize — www", () => {
  it.each([
    ["trzy w kropka onet kropka pe el", "www.onet.pl"],
    ["wuwuwu kropka google kropka kom", "www.google.com"],
    ["wu wu wu kropka wp kropka pe el", "www.wp.pl"],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("normalize — edge cases", () => {
  it("usuwa podwójne kropki", () => {
    const result = normalize("test kropka kropka pe el");
    expect(result).not.toContain("..");
  });

  it("usuwa końcową kropkę", () => {
    const result = normalize("onet kropka pe el kropka");
    expect(result).not.toMatch(/\.$/);
  });

  it("pusty string → pusty string", () => {
    expect(normalize("")).toBe("");
  });

  it("same spacje → pusty string", () => {
    expect(normalize("   ")).toBe("");
  });

  it("case-insensitive", () => {
    expect(normalize("ONET KROPKA PE EL")).toBe("onet.pl");
    expect(normalize("GitHub Kropka Kom")).toBe("github.com");
  });

  it("usuwa spacje wokół interpunkcji", () => {
    const result = normalize("onet kropka pe el");
    expect(result).not.toContain(" ");
  });
});

describe("looksLikeUrl", () => {
  it.each([
    "onet.pl",
    "google.com",
    "wikipedia.org",
    "https://github.com",
    "http://example.com",
    "sub.domain.co.uk",
    "test-site.dev",
  ])('"%s" wygląda jak URL', (text) => {
    expect(looksLikeUrl(text)).toBe(true);
  });

  it.each([
    "hello world",
    "najlepsze restauracje",
    "123",
    "",
    "a.b",
    "notatld",
    "just text here",
  ])('"%s" NIE wygląda jak URL', (text) => {
    expect(looksLikeUrl(text)).toBe(false);
  });
});

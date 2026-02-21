import { normalize, looksLikeUrl } from "./phonetic";

const KNOWN_DOMAINS = [
  "google.com", "youtube.com", "facebook.com", "twitter.com", "instagram.com",
  "linkedin.com", "reddit.com", "github.com", "stackoverflow.com", "wikipedia.org",
  "amazon.com", "netflix.com", "spotify.com", "apple.com", "microsoft.com",
  "onet.pl", "wp.pl", "interia.pl", "gazeta.pl", "allegro.pl",
  "olx.pl", "tvn24.pl", "bankier.pl", "money.pl", "pudelek.pl",
  "wykop.pl", "naszemiasto.pl", "o2.pl", "tvp.pl", "polsat.pl",
  "ceneo.pl", "morele.net", "x-kom.pl", "mediaexpert.pl", "empik.com",
  "bbc.com", "cnn.com", "nytimes.com", "theguardian.com", "reuters.com",
  "yahoo.com", "bing.com", "duckduckgo.com", "twitch.tv", "tiktok.com",
  "pinterest.com", "tumblr.com", "discord.com", "slack.com", "zoom.us",
  "medium.com", "dev.to", "hackernews.com", "producthunt.com",
  "gitlab.com", "bitbucket.org", "npmjs.com", "pypi.org",
  "aws.amazon.com", "azure.microsoft.com", "cloud.google.com",
  "docs.google.com", "drive.google.com", "maps.google.com",
  "mail.google.com", "calendar.google.com", "translate.google.com",
  "ebay.com", "aliexpress.com", "wish.com", "etsy.com",
  "booking.com", "airbnb.com", "tripadvisor.com",
  "imdb.com", "rottentomatoes.com", "metacritic.com",
  "wordpress.com", "blogger.com", "wix.com", "squarespace.com",
  "dropbox.com", "onedrive.com", "mega.nz",
  "paypal.com", "stripe.com", "revolut.com",
  "openai.com", "anthropic.com", "huggingface.co",
];

export interface ResolveResult {
  url: string | null;
  suggestions: string[];
  resolveType: "exact" | "fuzzy" | "search" | "ambiguous";
  needsClarification: boolean;
  normalizedInput: string;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  // SequenceMatcher-style: 2*matches / (len_a + len_b)
  const matches = (a.length + b.length - dist) / 2;
  return (2 * matches) / (a.length + b.length);
}

function fuzzyMatchDomain(
  input: string,
  threshold = 0.55,
  maxResults = 6,
): Array<[string, number]> {
  let cleaned = input.toLowerCase().trim();
  cleaned = cleaned.replace(/^(https?:\/\/|www\.)/, "");
  cleaned = cleaned.split("/")[0];

  const matches: Array<[string, number]> = [];
  for (const domain of KNOWN_DOMAINS) {
    // Compare against full domain AND stem (without TLD) for better typo matching
    const stem = domain.split(".")[0];
    const ratioFull = similarity(cleaned, domain);
    const ratioStem = similarity(cleaned, stem);
    const ratio = Math.max(ratioFull, ratioStem);
    if (ratio >= threshold) {
      matches.push([domain, ratio]);
    }
  }

  matches.sort((a, b) => b[1] - a[1]);
  return matches.slice(0, maxResults);
}

export function resolve(rawInput: string, threshold = 0.55): ResolveResult {
  const text = rawInput.trim();
  if (!text) {
    return {
      url: null,
      suggestions: [],
      resolveType: "ambiguous",
      needsClarification: true,
      normalizedInput: "",
    };
  }

  // 1) Already a valid URL?
  if (/^https?:\/\//.test(text)) {
    return {
      url: text,
      suggestions: [],
      resolveType: "exact",
      needsClarification: false,
      normalizedInput: text,
    };
  }

  // 2) Looks like a domain?
  if (/^[\w.-]+\.\w{2,}/.test(text)) {
    return {
      url: `https://${text}`,
      suggestions: [],
      resolveType: "exact",
      needsClarification: false,
      normalizedInput: text,
    };
  }

  // 3) Apply phonetic normalization
  const normalized = normalize(text);
  if (looksLikeUrl(normalized)) {
    const fuzzy = fuzzyMatchDomain(normalized, threshold);
    const suggestions = fuzzy
      .filter(([d]) => d !== normalized)
      .slice(0, 3)
      .map(([d]) => `https://${d}`);
    return {
      url: `https://${normalized}`,
      suggestions,
      resolveType: "fuzzy",
      needsClarification: false,
      normalizedInput: normalized,
    };
  }

  // 4) Fuzzy match against known domains
  const fuzzy = fuzzyMatchDomain(text, threshold);
  if (fuzzy.length > 0) {
    const [, bestScore] = fuzzy[0];
    const allSuggestions = fuzzy.map(([d]) => `https://${d}`);

    if (bestScore > 0.65) {
      return {
        url: allSuggestions[0],
        suggestions: allSuggestions.slice(1, 4),
        resolveType: "fuzzy",
        needsClarification: false,
        normalizedInput: text,
      };
    } else {
      return {
        url: null,
        suggestions: allSuggestions.slice(0, 5),
        resolveType: "ambiguous",
        needsClarification: true,
        normalizedInput: text,
      };
    }
  }

  // 5) Fallback — search
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
  return {
    url: searchUrl,
    suggestions: [],
    resolveType: "search",
    needsClarification: false,
    normalizedInput: text,
  };
}

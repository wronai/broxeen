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

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const costs: number[] = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer[i - 1] !== shorter[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longer.length - costs[shorter.length]) / longer.length;
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
    const ratio = similarity(cleaned, domain);
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

    if (bestScore > 0.8) {
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

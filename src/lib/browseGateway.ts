import { invoke } from "@tauri-apps/api/core";
import { logger, logAsyncDecorator } from "./logger";
import { isTauriRuntime } from "./runtime";
import {
  isProbablyTransientHttpStatus,
  retry,
  shouldRetryUnknownAsTransient,
} from "../core/retry";

const browseLogger = logger.scope("browse:gateway");
const MAX_CONTENT_LENGTH = 5000;

function stripCookieBannerText(text: string): string {
  const raw = text || "";
  const normalized = raw.replace(/\r\n?/g, "\n");
  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const cleanedBlocks: string[] = [];
  let removedCount = 0;

  for (const block of blocks) {
    // Skip legal disclaimer blocks (copyright, terms, etc.)
    const isLegalDisclaimer = /\b(Pobieranie|zwielokrotnianie|przechowywanie|wykorzystywanie|treści|dostępnych|niniejszym|serwisie|wymaga|uprzedniej|jednoznacznej|zgody|Wirtualna|Polska|Media|Spółka|Akcyjna|siedzibą|Warszawie|właściciela|niniejszego|serwisu|bez|względu|sposób|eksploracji|wykorzystaną|metodę|manualną|zautomatyzowaną|technikę|programów|uczenia|maszynowego|sztucznej|inteligencji|Powyższe|zastrzeżenie|dotyczy|wykorzystywania|jedynie|celu|ułatwienia|wyszukiwania|przez|wyszukiwarki|internetowe|korzystania|ramach|stosunków|umownych|dozwolonego|użytku|określonego|właściwe|przepisy|prawa|Szczegółowa|treść|dotycząca|niniejszego|zastrzeżenia|znajduje|tutaj)\b/i.test(block);
    
    if (isLegalDisclaimer) {
      removedCount += 1;
      continue;
    }

    const hasCookieWord = /\b(ciasteczk\w*|cookie\w*|cookies)\b/i.test(block);
    if (!hasCookieWord) {
      cleanedBlocks.push(block);
      continue;
    }

    const score =
      (/(polityk\w*\s+prywatn\w*|privacy\s+policy)/i.test(block) ? 1 : 0) +
      (/(akcept|zgadzam\s+się|consent)/iu.test(block) ? 1 : 0) +
      (/(przegl\w*dar\w*|browser)/i.test(block) ? 1 : 0) +
      (/(użytkownik\w*|user)/i.test(block) ? 1 : 0) +
      (/(zapisywan\w*|stored)/i.test(block) ? 1 : 0) +
      (/(najlepsz\w*\s+obsług\w*|best\s+experience)/i.test(block) ? 1 : 0);

    const looksLikeBanner =
      score >= 2 ||
      /strona\s+korzysta\s+z\s+plik\w*\s+tekstow\w*\s+zwanych\s+ciasteczkami/i.test(
        block,
      ) ||
      /plików\s+tekstowych\s+zwanych\s+ciasteczkami/i.test(block);

    if (!looksLikeBanner) {
      cleanedBlocks.push(block);
      continue;
    }

    // Try to strip the boilerplate segment from a mixed block.
    let stripped = block;

    stripped = stripped.replace(
      /strona\s+korzysta[\s\S]{0,3000}?akcept[\s\S]{0,200}?tych\s+mechanizm[\s\S]{0,40}?\.?/giu,
      " ",
    );

    stripped = stripped.replace(
      /we\s+use\s+cookies[\s\S]{0,3000}?(accept\s+|consent\s+|privacy\s+policy)/gi,
      " ",
    );

    stripped = normalizeText(stripped);

    // If after stripping we still have meaningful text, keep it.
    if (stripped.length >= 80) {
      cleanedBlocks.push(stripped);
      removedCount += 1;
      continue;
    }

    // Otherwise, drop the whole block.
    removedCount += 1;
  }

  if (!cleanedBlocks.length) {
    return raw;
  }

  return cleanedBlocks.join("\n\n");
}

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
  resolve_type?: string;
  screenshot_base64?: string;
  rss_url?: string;
  contact_url?: string;
  phone_url?: string;
}

interface AllOriginsResponse {
  contents?: string;
  status?: {
    url?: string;
    content_type?: string;
    content_length?: number;
    http_code?: number;
  };
}

interface BrowserProxyPayload {
  proxyName: string;
  rawContent: string;
  sourceHttpCode?: number;
  sourceContentType?: string;
  sourceContentLength?: number;
  sourceUrl?: string;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function withHttpScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function extractBrowserReadableContent(rawHtml: string): {
  title: string;
  content: string;
} {
  const fallbackContent =
    "Nie udało się wyodrębnić treści ze strony w trybie przeglądarki.";

  if (!rawHtml) {
    return {
      title: "Untitled",
      content: fallbackContent,
    };
  }

  if (typeof DOMParser === "undefined") {
    return {
      title: "Page Title (Browser Mode)",
      content: rawHtml.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  const document = new DOMParser().parseFromString(rawHtml, "text/html");
  document
    .querySelectorAll(
      "script, style, noscript, template, nav, footer, header, aside, form, " +
        "button, select, input[type='hidden'], " +
        "[role='navigation'], [role='banner'], [role='contentinfo'], " +
        ".cookie-banner, .cookie-consent, .ad, .advertisement, .sidebar, " +
        ".menu, .nav, .footer, .header",
    )
    .forEach((el) => el.remove());

  const title = normalizeText(document.title) || "Untitled";

  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".content",
    "#content",
    "body",
  ];

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) {
      continue;
    }

    const text = normalizeText(node.textContent || "");
    if (text.length > 120) {
      return {
        title,
        content: text.slice(0, MAX_CONTENT_LENGTH),
      };
    }
  }

  const paragraphText = Array.from(document.querySelectorAll("p"))
    .map((p) => normalizeText(p.textContent || ""))
    .filter((p) => p.length > 20)
    .join("\n\n");

  if (paragraphText) {
    return {
      title,
      content: paragraphText.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  const bodyText = normalizeText(document.body?.textContent || "");
  if (bodyText) {
    return {
      title,
      content: bodyText.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  return {
    title,
    content: fallbackContent,
  };
}

function looksLikeHtml(text: string): boolean {
  const probe = text.trim().slice(0, 2000);
  if (!probe) {
    return false;
  }

  return /<!doctype html|<html|<head|<body|<main|<article|<script|<style|<div|<p|<span|<a\s|<meta|<title|<h[1-6]|<ul|<ol|<li|<table|<form/i.test(
    probe,
  );
}

function looksLikeRssOrAtom(text: string): boolean {
  const probe = text.trim().slice(0, 2000);
  if (!probe) {
    return false;
  }

  return /<rss\s|<feed\s|<rdf:rdf|xmlns="http:\/\/www\.w3\.org\/2005\/Atom|xmlns="http:\/\/purl\.org\/rss\/1\.0|<channel\s|<entry\s|<item\s/i.test(
    probe,
  );
}

function extractRssAtomContent(rawXml: string): {
  title: string;
  content: string;
  feedInfo?: { title: string; description: string; items: Array<{ title: string; link: string; description: string; pubDate?: string }> };
} {
  const fallbackContent = "Nie udało się wyodrębnić treści z kanału RSS/Atom.";

  if (!rawXml) {
    return {
      title: "Untitled Feed",
      content: fallbackContent,
    };
  }

  if (typeof DOMParser === "undefined") {
    return {
      title: "Feed Title",
      content: rawXml.slice(0, MAX_CONTENT_LENGTH),
    };
  }

  try {
    const document = new DOMParser().parseFromString(rawXml, "application/xml");
    
    // Handle parsing errors
    const parseError = document.querySelector('parsererror');
    if (parseError) {
      browseLogger.warn("XML parsing error detected", { 
        error: parseError.textContent?.slice(0, 200) 
      });
      return {
        title: "Feed Parse Error",
        content: fallbackContent,
      };
    }

    // Detect feed type (RSS vs Atom)
    const isRss = document.querySelector('rss, rdf:rdf') !== null;
    const isAtom = document.querySelector('feed') !== null;

    let feedTitle = "";
    let feedDescription = "";
    const items: Array<{ title: string; link: string; description: string; pubDate?: string }> = [];

    if (isRss) {
      // RSS parsing
      const channel = document.querySelector('channel');
      feedTitle = normalizeText(channel?.querySelector('title')?.textContent || "") || "RSS Feed";
      feedDescription = normalizeText(channel?.querySelector('description')?.textContent || "") || "";

      const rssItems = document.querySelectorAll('item');
      rssItems.forEach((item) => {
        const title = normalizeText(item.querySelector('title')?.textContent || "");
        const link = item.querySelector('link')?.textContent || "";
        const description = normalizeText(item.querySelector('description')?.textContent || "");
        const pubDate = item.querySelector('pubDate')?.textContent || 
                        item.querySelector('dc:date')?.textContent || undefined;

        if (title || description) {
          items.push({ title, link, description, pubDate });
        }
      });
    } else if (isAtom) {
      // Atom parsing
      const feed = document.querySelector('feed');
      feedTitle = normalizeText(feed?.querySelector('title')?.textContent || "") || "Atom Feed";
      feedDescription = normalizeText(feed?.querySelector('subtitle')?.textContent || "") || "";

      const entries = document.querySelectorAll('entry');
      entries.forEach((entry) => {
        const title = normalizeText(entry.querySelector('title')?.textContent || "");
        const link = entry.querySelector('link')?.getAttribute('href') || "";
        const description = normalizeText(entry.querySelector('summary')?.textContent || "") ||
                           normalizeText(entry.querySelector('content')?.textContent || "");
        const pubDate = entry.querySelector('published')?.textContent || 
                        entry.querySelector('updated')?.textContent || undefined;

        if (title || description) {
          items.push({ title, link, description, pubDate });
        }
      });
    }

    // Format content for display
    let content = "";
    if (feedTitle || feedDescription) {
      content += `## ${feedTitle}\n\n`;
      if (feedDescription) {
        content += `${feedDescription}\n\n`;
      }
    }

    if (items.length > 0) {
      content += `### Ostatnie wpisy (${Math.min(items.length, 10)})\n\n`;
      items.slice(0, 10).forEach((item, index) => {
        content += `**${index + 1}. ${item.title || "Bez tytułu"}**\n`;
        if (item.pubDate) {
          content += `*Data:* ${item.pubDate}\n`;
        }
        if (item.description) {
          const desc = item.description.length > 300 
            ? item.description.slice(0, 300) + "..." 
            : item.description;
          content += `${desc}\n`;
        }
        if (item.link) {
          content += `[Link](${item.link})\n`;
        }
        content += "\n";
      });
    }

    const feedInfo = {
      title: feedTitle,
      description: feedDescription,
      items: items.slice(0, 10)
    };

    return {
      title: feedTitle || "Feed",
      content: content.slice(0, MAX_CONTENT_LENGTH) || fallbackContent,
      feedInfo,
    };
  } catch (error) {
    browseLogger.error("Error parsing RSS/Atom feed", { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return {
      title: "Feed Error",
      content: fallbackContent,
    };
  }
}

function normalizeBrowseResult(
  result: BrowseResult,
  source: "tauri" | "browser",
  requestedUrl?: string,
): BrowseResult {
  const rawUrl = typeof result.url === "string" ? result.url.trim() : "";
  const safeRequestedUrl =
    typeof requestedUrl === "string" ? requestedUrl.trim() : "";
  const safeUrl = rawUrl || safeRequestedUrl || "about:blank";
  const rawTitle = typeof result.title === "string" ? result.title : "";
  const rawContent = typeof result.content === "string" ? result.content : "";

  const title =
    normalizeText(rawTitle) || (source === "browser" ? "Untitled" : safeUrl);
  const contentWasHtml = looksLikeHtml(rawContent);
  const contentWasRssAtom = looksLikeRssOrAtom(rawContent);
  
  let extractedContent;
  if (contentWasHtml) {
    extractedContent = extractBrowserReadableContent(rawContent).content;
  } else if (contentWasRssAtom) {
    const feedResult = extractRssAtomContent(rawContent);
    extractedContent = feedResult.content;
  } else {
    extractedContent = rawContent;
  }
  
  const cookieStripped = stripCookieBannerText(extractedContent);
  const normalizedContent = cookieStripped.slice(0, MAX_CONTENT_LENGTH).trim();
  const fallbackContent =
    source === "browser"
      ? "Nie udało się wyodrębnić treści ze strony w trybie przeglądarki."
      : "Nie udało się wyodrębnić treści ze strony.";

  if (contentWasHtml) {
    browseLogger.warn(
      "Browse payload looked like raw HTML and was normalized",
      {
        source,
        url: safeUrl,
        originalLength: rawContent.length,
        normalizedLength: normalizedContent.length,
      },
    );
  }

  if (contentWasRssAtom) {
    browseLogger.info(
      "Browse payload detected as RSS/Atom feed and was parsed",
      {
        source,
        url: safeUrl,
        originalLength: rawContent.length,
        normalizedLength: normalizedContent.length,
      },
    );
  }

  if (!normalizedContent) {
    browseLogger.warn("Browse payload has empty content after normalization", {
      source,
      url: safeUrl,
      title,
    });
  }

  if (cookieStripped.length !== extractedContent.length) {
    browseLogger.info(
      "Cookie banner-like content stripped from browse payload",
      {
        source,
        url: safeUrl,
        originalLength: extractedContent.length,
        strippedLength: cookieStripped.length,
      },
    );
  }

  return {
    ...result,
    url: safeUrl,
    title,
    content: normalizedContent || fallbackContent,
  };
}

async function fetchViaAllOriginsJson(
  url: string,
): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const data = (await response.json()) as AllOriginsResponse;
        const statusCode = typeof data?.status?.http_code === "number" ? data.status.http_code : undefined;

        if (typeof statusCode === "number" && isProbablyTransientHttpStatus(statusCode)) {
          const err = new Error(`Source HTTP ${statusCode} via allorigins:get`);
          (err as any).status = statusCode;
          throw err;
        }

        return {
          proxyName: "allorigins:get",
          rawContent: typeof data?.contents === "string" ? data.contents : "",
          sourceHttpCode: data?.status?.http_code,
          sourceContentType: data?.status?.content_type,
          sourceContentLength: data?.status?.content_length,
          sourceUrl: data?.status?.url,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying allorigins:get", {
            url,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaAllOriginsRaw(
  url: string,
): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const rawContent = await response.text();
        return {
          proxyName: "allorigins:raw",
          rawContent,
          sourceHttpCode: response.status,
          sourceContentType: response.headers.get("content-type") || undefined,
          sourceContentLength: rawContent.length,
          sourceUrl: url,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying allorigins:raw", {
            url,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaCorsProxy(url: string): Promise<BrowserProxyPayload> {
  const targetUrl = withHttpScheme(url);
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const rawContent = await response.text();
        return {
          proxyName: "corsproxy.io",
          rawContent,
          sourceHttpCode: response.status,
          sourceContentType: response.headers.get("content-type") || undefined,
          sourceContentLength: rawContent.length,
          sourceUrl: targetUrl,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying corsproxy.io", {
            url: targetUrl,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaJina(url: string): Promise<BrowserProxyPayload> {
  const targetUrl = withHttpScheme(url);
  const proxyUrl = `https://r.jina.ai/${targetUrl}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await retry(
      async () => {
        const response = await fetch(proxyUrl, { signal: controller.signal });
        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}: ${response.statusText}`);
          (err as any).status = response.status;
          throw err;
        }

        const rawContent = await response.text();
        return {
          proxyName: "jina-ai",
          rawContent,
          sourceHttpCode: response.status,
          sourceContentType: response.headers.get("content-type") || undefined,
          sourceContentLength: rawContent.length,
          sourceUrl: targetUrl,
        };
      },
      {
        retries: 2,
        baseDelayMs: 300,
        maxDelayMs: 1200,
        shouldRetry: (error) => {
          const status = (error as any)?.status;
          if (typeof status === "number") {
            return {
              retry: isProbablyTransientHttpStatus(status),
              reason: `status ${status}`,
            };
          }
          return shouldRetryUnknownAsTransient(error);
        },
        onRetry: ({ attempt, delayMs, reason, error }) => {
          browseLogger.warn("Retrying jina-ai", {
            url: targetUrl,
            attempt,
            delayMs,
            reason,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function browseInBrowser(url: string): Promise<BrowseResult> {
  const runBrowseInBrowser = logAsyncDecorator(
    "browse:gateway",
    "browseInBrowser",
    async () => {
      const fetchers: Array<() => Promise<BrowserProxyPayload>> = [
        () => fetchViaAllOriginsJson(url),
        () => fetchViaCorsProxy(url),
        () => fetchViaAllOriginsRaw(url),
        () => fetchViaJina(url),
      ];

      const failures: string[] = [];

      for (const fetcher of fetchers) {
        try {
          const payload = await fetcher();
          const rawContent = payload.rawContent || "";

          browseLogger.info("Browser proxy payload received", {
            url,
            proxy: payload.proxyName,
            hasContents: !!rawContent,
            sourceHttpCode: payload.sourceHttpCode,
            sourceContentType: payload.sourceContentType,
            sourceContentLength: payload.sourceContentLength,
          });

          if (!rawContent.trim()) {
            const emptyMessage = `Empty payload from ${payload.proxyName}`;
            failures.push(emptyMessage);
            browseLogger.warn("Browser proxy returned empty payload", {
              url,
              proxy: payload.proxyName,
              sourceUrl: payload.sourceUrl,
            });
            continue;
          }

          const htmlPayload = looksLikeHtml(rawContent);
          const rssAtomPayload = looksLikeRssOrAtom(rawContent);
          let extracted;
          
          if (htmlPayload) {
            extracted = extractBrowserReadableContent(rawContent);
          } else if (rssAtomPayload) {
            extracted = extractRssAtomContent(rawContent);
          } else {
            extracted = {
              title: "Untitled",
              content: rawContent,
            };
          }

          const normalized = normalizeBrowseResult(
            {
              url,
              title: extracted.title,
              content: extracted.content,
            },
            "browser",
            url,
          );

          browseLogger.info("Browser fallback content prepared", {
            url,
            proxy: payload.proxyName,
            titleLength: normalized.title.length,
            contentLength: normalized.content.length,
            htmlPayload,
            rssAtomPayload,
          });

          return normalized;
        } catch (error) {
          const message = summarizeUnknownError(error);
          failures.push(message);
          browseLogger.warn("Browser proxy attempt failed", {
            url,
            error: message,
          });
        }
      }

      throw new Error(
        `Nie udało się pobrać strony: żaden z serwerów proxy nie odpowiedział. ` +
          `Strona może być niedostępna lub blokować dostęp. ` +
          `Spróbuj ponownie lub uruchom aplikację w trybie Tauri dla lepszych wyników.`,
      );
    },
  );

  return runBrowseInBrowser();
}

export async function executeBrowseCommand(
  url: string,
  runtimeIsTauri: boolean = isTauriRuntime(),
): Promise<BrowseResult> {
  const runExecuteBrowseCommand = logAsyncDecorator(
    "browse:gateway",
    "executeBrowseCommand",
    async () => {
      browseLogger.info("Dispatching browse command", {
        url,
        runtime: runtimeIsTauri ? "tauri" : "browser",
      });

      if (runtimeIsTauri) {
        const result = await invoke<BrowseResult>("browse", { url });
        const rawTitle = typeof result.title === "string" ? result.title : "";
        const rawContent =
          typeof result.content === "string" ? result.content : "";
        const normalized = normalizeBrowseResult(result, "tauri", url);

        browseLogger.info("Tauri browse command completed", {
          url: normalized.url,
          titleLength: normalized.title.length,
          contentLength: normalized.content.length,
          originalTitleLength: rawTitle.length,
          originalContentLength: rawContent.length,
          contentAppearedHtml: looksLikeHtml(rawContent),
        });

        return normalized;
      }

      const result = await browseInBrowser(url);
      browseLogger.info("Browser fallback browse completed", {
        url: result.url,
        contentLength: result.content.length,
      });
      return result;
    },
  );

  return runExecuteBrowseCommand();
}

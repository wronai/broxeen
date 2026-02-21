import { invoke } from "@tauri-apps/api/core";
import { logger, logAsyncDecorator } from "./logger";
import { isTauriRuntime } from "./runtime";

const browseLogger = logger.scope("browse:gateway");
const MAX_CONTENT_LENGTH = 5000;

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
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

function extractBrowserReadableContent(rawHtml: string): { title: string; content: string } {
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
    .querySelectorAll("script, style, noscript, template")
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

  const title = normalizeText(rawTitle) || (source === "browser" ? "Untitled" : safeUrl);
  const contentWasHtml = looksLikeHtml(rawContent);
  const extractedContent = contentWasHtml
    ? extractBrowserReadableContent(rawContent).content
    : rawContent;
  const normalizedContent = extractedContent.slice(0, MAX_CONTENT_LENGTH).trim();
  const fallbackContent =
    source === "browser"
      ? "Nie udało się wyodrębnić treści ze strony w trybie przeglądarki."
      : "Nie udało się wyodrębnić treści ze strony.";

  if (contentWasHtml) {
    browseLogger.warn("Browse payload looked like raw HTML and was normalized", {
      source,
      url: safeUrl,
      originalLength: rawContent.length,
      normalizedLength: normalizedContent.length,
    });
  }

  if (!normalizedContent) {
    browseLogger.warn("Browse payload has empty content after normalization", {
      source,
      url: safeUrl,
      title,
    });
  }

  return {
    ...result,
    url: safeUrl,
    title,
    content: normalizedContent || fallbackContent,
  };
}

async function fetchViaAllOriginsJson(url: string): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as AllOriginsResponse;
  return {
    proxyName: "allorigins:get",
    rawContent: typeof data?.contents === "string" ? data.contents : "",
    sourceHttpCode: data?.status?.http_code,
    sourceContentType: data?.status?.content_type,
    sourceContentLength: data?.status?.content_length,
    sourceUrl: data?.status?.url,
  };
}

async function fetchViaAllOriginsRaw(url: string): Promise<BrowserProxyPayload> {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
}

async function fetchViaJina(url: string): Promise<BrowserProxyPayload> {
  const targetUrl = withHttpScheme(url);
  const proxyUrl = `https://r.jina.ai/${targetUrl}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
}

async function browseInBrowser(url: string): Promise<BrowseResult> {
  const runBrowseInBrowser = logAsyncDecorator(
    "browse:gateway",
    "browseInBrowser",
    async () => {
      const fetchers: Array<() => Promise<BrowserProxyPayload>> = [
        () => fetchViaAllOriginsJson(url),
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
          const extracted = htmlPayload
            ? extractBrowserReadableContent(rawContent)
            : {
                title: "Untitled",
                content: rawContent,
              };

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
        `Nie udało się pobrać strony w trybie przeglądarkowym (CORS/proxy). Szczegóły: ${failures.join(" | ")}`,
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
        const rawContent = typeof result.content === "string" ? result.content : "";
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

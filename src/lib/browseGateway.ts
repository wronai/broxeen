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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
): BrowseResult {
  const rawTitle = typeof result.title === "string" ? result.title : "";
  const rawContent = typeof result.content === "string" ? result.content : "";

  const title = normalizeText(rawTitle) || (source === "browser" ? "Untitled" : result.url);
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
      url: result.url,
      originalLength: rawContent.length,
      normalizedLength: normalizedContent.length,
    });
  }

  if (!normalizedContent) {
    browseLogger.warn("Browse payload has empty content after normalization", {
      source,
      url: result.url,
      title,
    });
  }

  return {
    ...result,
    title,
    content: normalizedContent || fallbackContent,
  };
}

async function browseInBrowser(url: string): Promise<BrowseResult> {
  const runBrowseInBrowser = logAsyncDecorator(
    "browse:gateway",
    "browseInBrowser",
    async () => {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      browseLogger.info("Using browser fallback via AllOrigins", { url, proxyUrl });

      const response = await fetch(proxyUrl);
      browseLogger.info("Browser fallback HTTP response received", {
        url,
        status: response.status,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as AllOriginsResponse;
      const rawHtml = typeof data?.contents === "string" ? data.contents : "";

      browseLogger.info("AllOrigins payload received", {
        url,
        hasContents: !!rawHtml,
        sourceHttpCode: data?.status?.http_code,
        sourceContentType: data?.status?.content_type,
        sourceContentLength: data?.status?.content_length,
      });

      if (!rawHtml) {
        browseLogger.warn("AllOrigins response has empty `contents` payload", {
          url,
          sourceUrl: data?.status?.url,
        });
      }

      const extracted = extractBrowserReadableContent(rawHtml);
      const normalized = normalizeBrowseResult(
        {
          url,
          title: extracted.title,
          content: extracted.content,
        },
        "browser",
      );

      browseLogger.info("Browser fallback content prepared", {
        url,
        titleLength: normalized.title.length,
        contentLength: normalized.content.length,
      });

      return normalized;
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
        const normalized = normalizeBrowseResult(result, "tauri");

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

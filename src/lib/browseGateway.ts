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

      const data = await response.json();
      const rawHtml = typeof data?.contents === "string" ? data.contents : "";
      const extracted = extractBrowserReadableContent(rawHtml);

      browseLogger.info("Browser fallback content prepared", {
        url,
        titleLength: extracted.title.length,
        contentLength: extracted.content.length,
      });

      return {
        url,
        title: extracted.title,
        content: extracted.content,
      };
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
        browseLogger.info("Tauri browse command completed", {
          url: result.url,
          titleLength: result.title.length,
          contentLength: result.content.length,
        });
        return result;
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

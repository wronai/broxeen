import { invoke } from "@tauri-apps/api/core";
import { logger, logAsyncDecorator } from "./logger";
import { isTauriRuntime } from "./runtime";

const browseLogger = logger.scope("browse:gateway");

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
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
      const content =
        data.contents?.slice(0, 5000) ||
        "Content not available in browser mode. Please use the desktop app for full functionality.";

      browseLogger.info("Browser fallback content prepared", {
        url,
        contentLength: content.length,
      });

      return {
        url,
        title: "Page Title (Browser Mode)",
        content,
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

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import { isTauriRuntime } from "./runtime";

export interface BrowseResult {
  url: string;
  title: string;
  content: string;
}

async function browseInBrowser(url: string): Promise<BrowseResult> {
  const response = await fetch(
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    url,
    title: "Page Title (Browser Mode)",
    content:
      data.contents?.slice(0, 5000) ||
      "Content not available in browser mode. Please use the desktop app for full functionality.",
  };
}

export async function executeBrowseCommand(
  url: string,
  runtimeIsTauri: boolean = isTauriRuntime(),
): Promise<BrowseResult> {
  logger.debug(`Executing browse command for URL: ${url}`);

  if (runtimeIsTauri) {
    return invoke<BrowseResult>("browse", { url });
  }

  return browseInBrowser(url);
}

import type { BrowseResult } from "../lib/browseGateway";

/**
 * Interface for fetching web content.
 * Abstracts over Tauri backend vs browser proxy implementations.
 */
export interface BrowseService {
  fetch(url: string): Promise<BrowseResult>;
}

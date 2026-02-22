import type { BrowseService } from "./browseService";
import { executeBrowseCommand, type BrowseResult } from "../lib/browseGateway";

/**
 * Default implementation of BrowseService that delegates to the existing
 * executeBrowseCommand logic (which handles Tauri/fallback proxy).
 */
export class DefaultBrowseAdapter implements BrowseService {
  async fetch(url: string): Promise<BrowseResult> {
    return executeBrowseCommand(url);
  }
}

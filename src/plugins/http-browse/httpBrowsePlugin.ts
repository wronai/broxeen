/**
 * @module plugins/http-browse/httpBrowsePlugin
 * @description HTTP Browse plugin — refactored from browseGateway.ts.
 *
 * Key improvements:
 * - Implements DataSourcePlugin interface (DIP)
 * - Uses Strategy pattern for fetch methods (OCP)
 * - Single responsibility: HTTP content fetching
 * - Testable: strategies are injectable
 *
 * Migration path from existing code:
 * - browseGateway.fetchViaAllOriginsJson → AllOriginsJsonStrategy
 * - browseGateway.fetchViaAllOriginsRaw  → AllOriginsRawStrategy
 * - browseGateway.fetchViaCorsProxy      → CorsProxyStrategy
 * - browseGateway.fetchViaJina           → JinaStrategy
 * - browseGateway.browseInBrowser        → chain of strategies
 * - browseGateway.executeBrowseCommand   → HttpBrowsePlugin.execute()
 *
 * Content extraction logic stays in browseGateway.ts until fully migrated.
 */

import type {
  ContentBlock,
  DataSourcePlugin,
  PluginCapabilities,
  PluginId,
  PluginQuery,
  PluginResult,
  ResultMetadata,
} from "../../core/plugin.types";

// ─── Fetch Strategy Interface (OCP) ────────────────────────

export interface FetchStrategy {
  readonly name: string;
  readonly priority: number;

  /** Can this strategy be used in current environment? */
  isAvailable(): boolean;

  /** Fetch URL and return raw content */
  fetch(url: string): Promise<FetchStrategyResult>;
}

export interface FetchStrategyResult {
  readonly html: string;
  readonly finalUrl?: string;
  readonly source: string;
}

// ─── Strategy Implementations ───────────────────────────────

export class AllOriginsJsonStrategy implements FetchStrategy {
  readonly name = "allorigins-json";
  readonly priority = 80;

  isAvailable(): boolean {
    return true; // Always available in browser
  }

  async fetch(url: string): Promise<FetchStrategyResult> {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await globalThis.fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(`AllOrigins JSON returned ${response.status}`);
    }

    const data = await response.json();

    return {
      html: data.contents ?? "",
      finalUrl: data.status?.url,
      source: this.name,
    };
  }
}

export class AllOriginsRawStrategy implements FetchStrategy {
  readonly name = "allorigins-raw";
  readonly priority = 70;

  isAvailable(): boolean {
    return true;
  }

  async fetch(url: string): Promise<FetchStrategyResult> {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await globalThis.fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(`AllOrigins Raw returned ${response.status}`);
    }

    return {
      html: await response.text(),
      source: this.name,
    };
  }
}

export class CorsProxyStrategy implements FetchStrategy {
  readonly name = "cors-proxy";
  readonly priority = 60;

  isAvailable(): boolean {
    return true;
  }

  async fetch(url: string): Promise<FetchStrategyResult> {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const response = await globalThis.fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(`CORS Proxy returned ${response.status}`);
    }

    return {
      html: await response.text(),
      source: this.name,
    };
  }
}

export class JinaReaderStrategy implements FetchStrategy {
  readonly name = "jina-reader";
  readonly priority = 50;

  isAvailable(): boolean {
    return true;
  }

  async fetch(url: string): Promise<FetchStrategyResult> {
    const proxyUrl = `https://r.jina.ai/${url}`;
    const response = await globalThis.fetch(proxyUrl, {
      headers: { Accept: "text/html" },
    });

    if (!response.ok) {
      throw new Error(`Jina Reader returned ${response.status}`);
    }

    return {
      html: await response.text(),
      source: this.name,
    };
  }
}

/**
 * Tauri native fetch — highest priority when available.
 * Calls the Rust `browse` command directly.
 */
export class TauriFetchStrategy implements FetchStrategy {
  readonly name = "tauri-native";
  readonly priority = 100;

  private readonly invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  constructor(
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.invoke = invoke;
  }

  isAvailable(): boolean {
    return true; // Available by definition when constructed
  }

  async fetch(url: string): Promise<FetchStrategyResult> {
    const result = (await this.invoke("browse", { url })) as {
      title: string;
      content: string;
      url: string;
    };

    return {
      html: result.content,
      finalUrl: result.url,
      source: this.name,
    };
  }
}

// ─── Content Extractor (SRP) ────────────────────────────────

/**
 * Interface for content extraction.
 * Current implementation delegates to existing browseGateway functions.
 * Can be replaced with more advanced extractors.
 */
export interface ContentExtractor {
  extract(html: string, url: string): ExtractedContent;
}

export interface ExtractedContent {
  title: string;
  text: string;
  summary?: string;
}

/** Default extractor — wraps existing browseGateway logic */
export class DefaultContentExtractor implements ContentExtractor {
  extract(html: string, _url: string): ExtractedContent {
    // Simplified extraction — in real migration, delegate to
    // existing extractBrowserReadableContent() and stripCookieBannerText()
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? "Untitled";

    // Strip all tags for plain text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return { title, text };
  }
}

// ─── HTTP Browse Plugin ─────────────────────────────────────

export interface HttpBrowsePluginOptions {
  strategies?: FetchStrategy[];
  extractor?: ContentExtractor;
  maxContentLength?: number;
}

export class HttpBrowsePlugin implements DataSourcePlugin {
  readonly id: PluginId = "http-browse";
  readonly name = "HTTP Browse";
  readonly capabilities: PluginCapabilities = {
    intents: ["browse", "search"],
    streaming: false,
    requiresNetwork: true,
    browserCompatible: true,
    priority: 50,
  };

  private strategies: FetchStrategy[];
  private extractor: ContentExtractor;
  private maxContentLength: number;

  constructor(options: HttpBrowsePluginOptions = {}) {
    this.strategies = (
      options.strategies ?? [
        new AllOriginsJsonStrategy(),
        new AllOriginsRawStrategy(),
        new CorsProxyStrategy(),
        new JinaReaderStrategy(),
      ]
    ).sort((a, b) => b.priority - a.priority);

    this.extractor = options.extractor ?? new DefaultContentExtractor();
    this.maxContentLength = options.maxContentLength ?? 50_000;
  }

  async initialize(): Promise<void> {
    // No initialization needed for HTTP
  }

  async isAvailable(): Promise<boolean> {
    return this.strategies.some((s) => s.isAvailable());
  }

  async execute(query: PluginQuery): Promise<PluginResult> {
    const start = performance.now();
    const url = this.resolveUrl(query);

    // Try each strategy in priority order
    let lastError: Error | null = null;

    for (const strategy of this.strategies) {
      if (!strategy.isAvailable()) continue;

      try {
        const raw = await strategy.fetch(url);
        const extracted = this.extractor.extract(raw.html, url);

        const text =
          extracted.text.length > this.maxContentLength
            ? extracted.text.slice(0, this.maxContentLength)
            : extracted.text;

        const truncated = extracted.text.length > this.maxContentLength;

        const content: ContentBlock[] = [
          {
            type: "text",
            data: text,
            title: extracted.title,
            summary: extracted.summary ?? text.slice(0, 200),
          },
        ];

        return {
          pluginId: this.id,
          status: "success",
          content,
          metadata: {
            duration_ms: performance.now() - start,
            source_url: raw.finalUrl ?? url,
            cached: false,
            truncated,
          },
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Try next strategy
      }
    }

    return {
      pluginId: this.id,
      status: "error",
      content: [
        {
          type: "text",
          data: `Nie udało się pobrać strony: ${lastError?.message ?? "unknown error"}`,
        },
      ],
      metadata: {
        duration_ms: performance.now() - start,
        source_url: url,
        cached: false,
        truncated: false,
      },
    };
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }

  // ── Helpers ─────────────────────────────────────────────

  private resolveUrl(query: PluginQuery): string {
    const target = query.resolvedTarget ?? query.rawInput;
    if (/^https?:\/\//i.test(target)) return target;
    return `https://${target}`;
  }

  /**
   * Add a strategy at runtime (e.g., Tauri native fetch when detected).
   * Re-sorts by priority.
   */
  addStrategy(strategy: FetchStrategy): void {
    this.strategies.push(strategy);
    this.strategies.sort((a, b) => b.priority - a.priority);
  }
}

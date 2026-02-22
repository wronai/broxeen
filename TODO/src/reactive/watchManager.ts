/**
 * @module reactive/watchManager
 * @description Reactive monitoring system for Broxeen.
 *
 * Two components:
 *
 * 1. WatchManager — manages watch rules (time windows)
 *    - Auto-creates watches from recent user queries
 *    - Expires old watches
 *    - Persists rules to chat.db
 *
 * 2. ChangeDetector — polls endpoints and detects changes
 *    - Compares content hashes
 *    - For cameras: compares scene descriptions
 *    - Emits events when changes detected
 *    - Saves snapshots and change history to devices.db
 *
 * Time Window Logic:
 * ┌─────────────────────────────────────────────────────────┐
 * │ User asks about camera → WatchManager.autoWatch(1h)     │
 * │ ChangeDetector polls every 30s                          │
 * │ If scene changes → emit notification to chat            │
 * │ After 1h → watch expires, polling stops                 │
 * └─────────────────────────────────────────────────────────┘
 */

import type { IntentRouter } from "../core/intentRouter";
import { buildQuery } from "../core/intentRouter";
import type { PluginResult, ContentBlock } from "../core/plugin.types";
import type { ChatRepository, WatchRule } from "../persistence/chatRepository";
import type {
  ChangeRecord,
  ContentSnapshot,
  DeviceRepository,
} from "../persistence/deviceRepository";

// ─── Configuration ──────────────────────────────────────────

export interface WatchConfig {
  /** Default watch duration in ms (1 hour) */
  defaultWatchDurationMs: number;
  /** Minimum poll interval in ms (10s) */
  minPollIntervalMs: number;
  /** Poll intervals by intent type */
  pollIntervals: Record<string, number>;
  /** Change threshold (0-1): fraction of content that changed */
  changeThreshold: number;
  /** Intents that trigger auto-watch */
  autoWatchIntents: string[];
  /** Max concurrent watches */
  maxActiveWatches: number;
}

const DEFAULT_CONFIG: WatchConfig = {
  defaultWatchDurationMs: 60 * 60 * 1000, // 1 hour
  minPollIntervalMs: 10_000,               // 10 seconds
  pollIntervals: {
    "camera:describe": 30_000,   // 30s for cameras
    "browse":          60_000,   // 1min for web pages
    "iot:read":        15_000,   // 15s for sensors
    "api:query":       30_000,   // 30s for APIs
  },
  changeThreshold: 0.15,  // 15% change triggers notification
  autoWatchIntents: [
    "camera:describe",
    "browse",
    "iot:read",
    "api:query",
  ],
  maxActiveWatches: 20,
};

// ─── Events emitted by the system ───────────────────────────

export type WatchEventType =
  | "watch:created"
  | "watch:expired"
  | "change:detected"
  | "change:error";

export interface WatchEvent {
  type: WatchEventType;
  endpointId: string;
  data: WatchEventData;
  timestamp: number;
}

export type WatchEventData =
  | { rule: WatchRule }
  | { change: ChangeRecord; newContent?: ContentBlock }
  | { error: string };

export type WatchEventHandler = (event: WatchEvent) => void;

// ─── Watch Manager ──────────────────────────────────────────

export class WatchManager {
  private config: WatchConfig;
  private eventHandlers = new Set<WatchEventHandler>();

  constructor(
    private readonly chatRepo: ChatRepository,
    private readonly deviceRepo: DeviceRepository,
    config: Partial<WatchConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Auto-watch: called after every successful plugin query.
   * Creates a watch rule if the intent is in autoWatchIntents.
   */
  autoWatch(
    endpointId: string,
    intent: string,
    pluginId: string,
    queryText?: string,
  ): WatchRule | null {
    // Skip if intent not watchable
    if (!this.config.autoWatchIntents.includes(intent)) return null;

    // Skip if already watching this endpoint
    const existing = this.chatRepo.getWatchRuleForEndpoint(endpointId);
    if (existing) {
      // Extend the watch window
      this.chatRepo.deactivateWatchRule(existing.id!);
    }

    // Check limit
    const active = this.chatRepo.getActiveWatchRules();
    if (active.length >= this.config.maxActiveWatches) {
      // Expire oldest
      const oldest = active[active.length - 1];
      if (oldest.id) this.chatRepo.deactivateWatchRule(oldest.id);
    }

    const now = Date.now();
    const pollInterval =
      this.config.pollIntervals[intent] ?? this.config.defaultWatchDurationMs;

    const rule: WatchRule = {
      endpointId,
      intent,
      queryText,
      pluginId,
      pollIntervalMs: Math.max(pollInterval, this.config.minPollIntervalMs),
      watchUntil: now + this.config.defaultWatchDurationMs,
      isActive: true,
      createdAt: now,
      metadata: {},
    };

    const id = this.chatRepo.addWatchRule(rule);
    const saved = { ...rule, id };

    this.emit({
      type: "watch:created",
      endpointId,
      data: { rule: saved },
      timestamp: now,
    });

    return saved;
  }

  /**
   * Manually create a watch with custom duration.
   */
  createWatch(
    endpointId: string,
    intent: string,
    pluginId: string,
    durationMs: number,
    pollIntervalMs?: number,
  ): WatchRule {
    const now = Date.now();
    const rule: WatchRule = {
      endpointId,
      intent,
      pluginId,
      pollIntervalMs: pollIntervalMs ?? this.config.pollIntervals[intent] ?? 60_000,
      watchUntil: now + durationMs,
      isActive: true,
      createdAt: now,
      metadata: {},
    };

    const id = this.chatRepo.addWatchRule(rule);
    return { ...rule, id };
  }

  /** Get all currently active watches */
  getActiveWatches(): WatchRule[] {
    this.chatRepo.expireWatchRules();
    return this.chatRepo.getActiveWatchRules();
  }

  /** Stop watching a specific endpoint */
  stopWatch(endpointId: string): void {
    const rule = this.chatRepo.getWatchRuleForEndpoint(endpointId);
    if (rule?.id) {
      this.chatRepo.deactivateWatchRule(rule.id);
      this.emit({
        type: "watch:expired",
        endpointId,
        data: { rule },
        timestamp: Date.now(),
      });
    }
  }

  // ── Events ────────────────────────────────────────────────

  onEvent(handler: WatchEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: WatchEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* observer error */ }
    }
  }
}

// ─── Change Detector ────────────────────────────────────────

export class ChangeDetector {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = false;

  constructor(
    private readonly router: IntentRouter,
    private readonly watchManager: WatchManager,
    private readonly deviceRepo: DeviceRepository,
    private readonly chatRepo: ChatRepository,
    private readonly config: { changeThreshold: number } = {
      changeThreshold: DEFAULT_CONFIG.changeThreshold,
    },
  ) {}

  /**
   * Start the detection loop.
   * Polls all active watch rules at their configured intervals.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Main tick: check for new/expired rules every 5s
    const mainTimer = setInterval(() => this.tick(), 5000);
    this.timers.set("__main__", mainTimer);
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  private async tick(): Promise<void> {
    // Expire old rules
    this.chatRepo.expireWatchRules();

    const rules = this.chatRepo.getActiveWatchRules();

    // Start timers for new rules
    for (const rule of rules) {
      const key = `watch:${rule.id}`;
      if (this.timers.has(key)) continue;

      const timer = setInterval(
        () => this.pollEndpoint(rule),
        rule.pollIntervalMs,
      );
      this.timers.set(key, timer);

      // Also poll immediately on first start
      this.pollEndpoint(rule);
    }

    // Stop timers for expired/deactivated rules
    for (const [key, timer] of this.timers) {
      if (key === "__main__") continue;
      const ruleId = parseInt(key.split(":")[1], 10);
      const stillActive = rules.some((r) => r.id === ruleId);
      if (!stillActive) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
  }

  private async pollEndpoint(rule: WatchRule): Promise<void> {
    try {
      // Re-execute the original query
      const query = buildQuery(rule.intent, rule.queryText ?? rule.endpointId, {
        resolvedTarget: rule.endpointId,
      });

      const result = await this.router.route(query);
      if (result.status === "error") return;

      // Extract content for comparison
      const textContent = result.content
        .filter((b) => b.type === "text")
        .map((b) => b.data)
        .join("\n");

      const hash = await this.hashContent(textContent);

      // Get previous snapshot
      const lastSnapshot = this.deviceRepo.getLatestSnapshot(rule.endpointId);

      // Save new snapshot
      const snapshot: ContentSnapshot = {
        endpointId: rule.endpointId,
        contentHash: hash,
        contentText: textContent.slice(0, 10_000), // limit stored text
        contentSize: textContent.length,
        snapshotAt: Date.now(),
        metadata: {
          pluginId: result.pluginId,
          intent: rule.intent,
        },
      };
      this.deviceRepo.saveSnapshot(snapshot);

      // Update poll time
      if (rule.id) this.chatRepo.updateWatchPollTime(rule.id);

      // Compare with previous
      if (lastSnapshot && lastSnapshot.contentHash !== hash) {
        const changeRatio = this.computeChangeRatio(
          lastSnapshot.contentText ?? "",
          textContent,
        );

        if (changeRatio >= this.config.changeThreshold) {
          const description = this.describeChange(
            rule,
            changeRatio,
            lastSnapshot,
            textContent,
            result,
          );

          const severity = changeRatio > 0.5 ? "alert" : changeRatio > 0.3 ? "warning" : "info";

          const change: ChangeRecord = {
            endpointId: rule.endpointId,
            changeType: rule.intent.includes("camera")
              ? "scene_changed"
              : "content_changed",
            description,
            oldHash: lastSnapshot.contentHash,
            newHash: hash,
            diffSummary: `Zmienione: ${(changeRatio * 100).toFixed(0)}%`,
            severity,
            detectedAt: Date.now(),
            acknowledged: false,
          };

          this.deviceRepo.recordChange(change);

          // Emit event for UI notification
          this.watchManager.onEvent(() => {}); // ensure handlers exist
          // Use WatchManager's event system
          (this.watchManager as any).emit({
            type: "change:detected",
            endpointId: rule.endpointId,
            data: {
              change,
              newContent: result.content[0],
            },
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      // Polling error — don't crash the loop
      (this.watchManager as any).emit?.({
        type: "change:error",
        endpointId: rule.endpointId,
        data: {
          error: err instanceof Error ? err.message : String(err),
        },
        timestamp: Date.now(),
      });
    }
  }

  // ── Content Comparison ──────────────────────────────────

  private computeChangeRatio(oldText: string, newText: string): number {
    if (!oldText && !newText) return 0;
    if (!oldText || !newText) return 1;

    const oldWords = new Set(oldText.toLowerCase().split(/\s+/));
    const newWords = new Set(newText.toLowerCase().split(/\s+/));

    let changed = 0;
    for (const word of newWords) {
      if (!oldWords.has(word)) changed++;
    }
    for (const word of oldWords) {
      if (!newWords.has(word)) changed++;
    }

    const total = oldWords.size + newWords.size;
    return total > 0 ? changed / total : 0;
  }

  private describeChange(
    rule: WatchRule,
    changeRatio: number,
    _lastSnapshot: ContentSnapshot,
    newText: string,
    result: PluginResult,
  ): string {
    const pct = (changeRatio * 100).toFixed(0);
    const preview = newText.slice(0, 150).replace(/\n/g, " ");

    if (rule.intent.includes("camera")) {
      return `🔔 Zmiana na kamerze: ${preview}`;
    }
    if (rule.intent.includes("iot")) {
      return `📊 Nowy odczyt sensora (${rule.endpointId}): ${preview}`;
    }
    return `🔔 Zmiana treści (${pct}%) na ${rule.endpointId}: ${preview}...`;
  }

  private async hashContent(text: string): Promise<string> {
    // Use SubtleCrypto if available, otherwise simple hash
    if (typeof globalThis.crypto?.subtle !== "undefined") {
      const data = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // Fallback: simple string hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(16);
  }
}

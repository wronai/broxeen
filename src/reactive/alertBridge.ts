/**
 * AlertBridge — connects WatchManager change events and device status changes
 * to the chat EventStore, injecting assistant alert messages automatically.
 *
 * Usage:
 *   const bridge = new AlertBridge(eventStore);
 *   bridge.attachWatchManager(watchManager);
 *   bridge.notifyDeviceStatusChange('192.168.1.100', 'online', 'offline');
 *   bridge.dispose();
 */

import type { EventStore } from "../domain/eventStore";
import type { WatchManager } from "./watchManager";
import type { WatchManagerEvent, ChangeDetectedEvent } from "./types";
import type { ChatMessage } from "../domain/chatEvents";
import { logger } from "../lib/logger";

const alertLog = logger.scope("reactive:alertBridge");

export interface DeviceStatusChange {
  ip: string;
  deviceType?: string;
  hostname?: string;
  previousStatus: "online" | "offline" | "unknown";
  currentStatus: "online" | "offline";
  detectedAt: Date;
}

export interface AlertBridgeOptions {
  /** Suppress duplicate alerts for the same target within this window (ms) */
  dedupeWindowMs: number;
  /** Maximum alerts per minute before throttling */
  maxAlertsPerMinute: number;
  /** Severity thresholds for change score */
  warnThreshold: number;
  alertThreshold: number;
}

const DEFAULT_OPTIONS: AlertBridgeOptions = {
  dedupeWindowMs: 30_000,
  maxAlertsPerMinute: 10,
  warnThreshold: 0.4,
  alertThreshold: 0.7,
};

export class AlertBridge {
  private eventStore: EventStore;
  private options: AlertBridgeOptions;
  private watchManagerUnsubscribe: (() => void) | null = null;
  private lastAlertAt = new Map<string, number>();
  private alertsThisMinute = 0;
  private minuteResetTimer: ReturnType<typeof setInterval> | null = null;
  private nextMessageId: number;

  constructor(eventStore: EventStore, options: Partial<AlertBridgeOptions> = {}) {
    this.eventStore = eventStore;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.nextMessageId = Date.now();
    this.minuteResetTimer = setInterval(() => {
      this.alertsThisMinute = 0;
    }, 60_000);
  }

  // ── WatchManager integration ───────────────────────────────────────────────

  attachWatchManager(watchManager: WatchManager): void {
    if (this.watchManagerUnsubscribe) {
      this.watchManagerUnsubscribe();
    }
    watchManager.addEventListener(this.handleWatchEvent);
    this.watchManagerUnsubscribe = () => {
      watchManager.removeEventListener(this.handleWatchEvent);
    };
    alertLog.info("AlertBridge attached to WatchManager");
  }

  detachWatchManager(): void {
    if (this.watchManagerUnsubscribe) {
      this.watchManagerUnsubscribe();
      this.watchManagerUnsubscribe = null;
    }
  }

  private handleWatchEvent = (event: WatchManagerEvent): void => {
    if (event.type !== "change_detected") return;
    const change = event.data as ChangeDetectedEvent;
    this.emitChangeAlert(change);
  };

  private emitChangeAlert(change: ChangeDetectedEvent): void {
    const dedupeKey = `watch:${change.targetId}:${change.changeType}`;
    if (this.isDuplicate(dedupeKey)) return;
    if (this.isThrottled()) return;

    this.markSeen(dedupeKey);
    this.alertsThisMinute++;

    const severity = this.getSeverity(change.changeScore);
    const icon = severity === "alert" ? "🚨" : severity === "warning" ? "⚠️" : "🔔";
    const changeTypeLabel = this.changeTypeLabel(change.changeType);
    const scoreLabel = `${(change.changeScore * 100).toFixed(0)}%`;

    const text =
      `${icon} **Wykryto zmianę: ${change.targetType === "device" ? "urządzenie" : "usługa"} \`${change.targetId}\`**\n\n` +
      `**Typ zmiany:** ${changeTypeLabel}  |  **Stopień zmiany:** ${scoreLabel}\n\n` +
      `${change.summary}\n\n` +
      (change.currentContent
        ? `**Nowa treść (fragment):**\n\`\`\`\n${change.currentContent.slice(0, 300)}${change.currentContent.length > 300 ? "\n..." : ""}\n\`\`\`\n\n`
        : "") +
      `*${new Date(change.detectedAt).toLocaleString("pl-PL")}*\n\n` +
      `💡 \`monitoruj ${change.targetId}\` — zarządzaj monitoringiem`;

    this.injectMessage(text, severity);
  }

  // ── Device status change alerts ────────────────────────────────────────────

  notifyDeviceStatusChange(change: DeviceStatusChange): void {
    const dedupeKey = `device:${change.ip}:${change.currentStatus}`;
    if (this.isDuplicate(dedupeKey)) return;
    if (this.isThrottled()) return;

    this.markSeen(dedupeKey);
    this.alertsThisMinute++;

    const icon = change.currentStatus === "online" ? "🟢" : "🔴";
    const statusLabel = change.currentStatus === "online" ? "ONLINE" : "OFFLINE";
    const deviceLabel = change.hostname
      ? `\`${change.hostname}\` (${change.ip})`
      : `\`${change.ip}\``;
    const typeLabel = change.deviceType ? ` [${change.deviceType}]` : "";
    const severity = change.currentStatus === "offline" ? "warning" : "info";

    const text =
      `${icon} **Zmiana statusu urządzenia${typeLabel}**\n\n` +
      `**Urządzenie:** ${deviceLabel}\n` +
      `**Status:** ${change.previousStatus.toUpperCase()} → **${statusLabel}**\n` +
      `*${change.detectedAt.toLocaleString("pl-PL")}*\n\n` +
      (change.currentStatus === "offline"
        ? `💡 \`ping ${change.ip}\` — sprawdź połączenie\n` +
          `💡 \`skanuj porty ${change.ip}\` — sprawdź usługi`
        : `💡 \`status kamery ${change.ip}\` — sprawdź kamerę\n` +
          `💡 \`monitoruj ${change.ip}\` — włącz monitoring`);

    this.injectMessage(text, severity);
    alertLog.info(`Device status alert: ${change.ip} ${change.previousStatus} → ${change.currentStatus}`);
  }

  // ── Motion detection alerts ────────────────────────────────────────────────

  notifyMotionDetection(cameraId: string, label: string, confidence: number, llmLabel?: string): void {
    const dedupeKey = `motion:${cameraId}:${label}`;
    if (this.isDuplicate(dedupeKey)) return;
    if (this.isThrottled()) return;

    this.markSeen(dedupeKey);
    this.alertsThisMinute++;

    const icon = label === "person" ? "🚶" : label === "car" ? "🚗" : "🎯";
    const finalLabel = llmLabel ?? label;
    const confLabel = `${(confidence * 100).toFixed(0)}%`;
    const severity = label === "person" ? "warning" : "info";

    const text =
      `${icon} **Wykryto ruch: \`${cameraId}\`**\n\n` +
      `**Obiekt:** ${finalLabel}  |  **Pewność:** ${confLabel}` +
      (llmLabel && llmLabel !== label ? `  |  **LLM:** ${llmLabel}` : "") +
      `\n\n*${new Date().toLocaleString("pl-PL")}*\n\n` +
      `💡 \`wykrycia ${cameraId}\` — pokaż ostatnie wykrycia\n` +
      `💡 \`statystyki detekcji ${cameraId}\` — statystyki`;

    this.injectMessage(text, severity);
  }

  // ── Dispose ────────────────────────────────────────────────────────────────

  dispose(): void {
    this.detachWatchManager();
    if (this.minuteResetTimer) {
      clearInterval(this.minuteResetTimer);
      this.minuteResetTimer = null;
    }
    this.lastAlertAt.clear();
    alertLog.info("AlertBridge disposed");
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private isDuplicate(key: string): boolean {
    const last = this.lastAlertAt.get(key);
    if (last === undefined) return false;
    return Date.now() - last < this.options.dedupeWindowMs;
  }

  private markSeen(key: string): void {
    this.lastAlertAt.set(key, Date.now());
  }

  private isThrottled(): boolean {
    if (this.alertsThisMinute >= this.options.maxAlertsPerMinute) {
      alertLog.debug("AlertBridge throttled", { alertsThisMinute: this.alertsThisMinute });
      return true;
    }
    return false;
  }

  private getSeverity(score: number): "info" | "warning" | "alert" {
    if (score >= this.options.alertThreshold) return "alert";
    if (score >= this.options.warnThreshold) return "warning";
    return "info";
  }

  private changeTypeLabel(type: string): string {
    switch (type) {
      case "content": return "treść";
      case "status": return "status";
      case "metadata": return "metadane";
      default: return type;
    }
  }

  private injectMessage(text: string, _severity: "info" | "warning" | "alert"): void {
    const msg: ChatMessage = {
      id: this.nextMessageId++,
      role: "assistant",
      text,
      type: "content",
      timestamp: Date.now(),
    };
    this.eventStore.append({ type: "message_added", payload: msg });
  }
}

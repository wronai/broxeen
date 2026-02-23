/**
 * useAlertBridge — React hook that wires AlertBridge into the CqrsContext EventStore.
 *
 * Mount this inside CqrsProvider. It:
 *  1. Creates an AlertBridge backed by the EventStore
 *  2. Attaches it to the AutoScanScheduler for device status change alerts
 *  3. Listens for broxeen:motion_event Tauri events → motion detection alerts
 *  4. Exposes the bridge so callers can attach a WatchManager
 *
 * Usage (inside CqrsProvider):
 *   const bridge = useAlertBridge(autoScanScheduler);
 *   bridge?.attachWatchManager(watchManager);
 */

import { useEffect, useRef } from "react";
import { useCqrs } from "../contexts/CqrsContext";
import { AlertBridge } from "../reactive/alertBridge";
import type { AutoScanScheduler } from "../plugins/discovery/autoScanScheduler";
import { logger } from "../lib/logger";

const hookLog = logger.scope("hooks:alertBridge");

export function useAlertBridge(
  autoScanScheduler: AutoScanScheduler | null,
): AlertBridge | null {
  const { eventStore } = useCqrs();
  const bridgeRef = useRef<AlertBridge | null>(null);

  // Create bridge once
  if (!bridgeRef.current) {
    bridgeRef.current = new AlertBridge(eventStore);
  }

  // Wire AutoScanScheduler status change callback
  useEffect(() => {
    if (!autoScanScheduler || !bridgeRef.current) return;
    const bridge = bridgeRef.current;

    autoScanScheduler.setStatusChangeCallback((change) => {
      bridge.notifyDeviceStatusChange(change);
    });

    hookLog.info("AlertBridge wired to AutoScanScheduler");

    return () => {
      autoScanScheduler.setStatusChangeCallback(() => {});
    };
  }, [autoScanScheduler]);

  // Listen for Tauri motion events
  useEffect(() => {
    if (typeof window === "undefined") return;
    const bridge = bridgeRef.current;
    if (!bridge) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.type !== "detection") return;
      bridge.notifyMotionDetection(
        detail.camera_id ?? "cam",
        detail.label ?? "unknown",
        detail.confidence ?? 0,
        detail.llm_label,
      );
    };

    window.addEventListener("broxeen:motion_detection", handler);
    hookLog.info("AlertBridge listening for broxeen:motion_detection");

    return () => {
      window.removeEventListener("broxeen:motion_detection", handler);
    };
  }, []);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
    };
  }, []);

  return bridgeRef.current;
}

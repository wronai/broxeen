/**
 * @module hooks/useWatchNotifications
 * @description React hook for reactive change notifications.
 *
 * Subscribes to WatchManager events and provides:
 * - List of unacknowledged changes
 * - Active watch count
 * - Methods to acknowledge/dismiss notifications
 *
 * Usage in Chat.tsx:
 *   const { notifications, activeWatches, acknowledge } = useWatchNotifications();
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { WatchManager, WatchEvent } from "../reactive/watchManager";
import type { ChangeRecord, DeviceRepository } from "../persistence/deviceRepository";

export interface WatchNotification {
  id: number;
  endpointId: string;
  description: string;
  severity: "info" | "warning" | "alert";
  detectedAt: number;
  changeType: string;
  /** Preview of new content (for display) */
  preview?: string;
}

export interface UseWatchNotificationsReturn {
  /** Unacknowledged notifications, newest first */
  notifications: WatchNotification[];
  /** Number of active watch rules */
  activeWatchCount: number;
  /** Acknowledge (dismiss) a single notification */
  acknowledge: (notificationId: number) => void;
  /** Acknowledge all notifications for an endpoint */
  acknowledgeEndpoint: (endpointId: string) => void;
  /** Acknowledge all */
  acknowledgeAll: () => void;
  /** Stop watching an endpoint */
  stopWatch: (endpointId: string) => void;
}

export function useWatchNotifications(
  watchManager: WatchManager | null,
  deviceRepo: DeviceRepository | null,
): UseWatchNotificationsReturn {
  const [notifications, setNotifications] = useState<WatchNotification[]>([]);
  const [activeWatchCount, setActiveWatchCount] = useState(0);

  // Ref to avoid stale closures
  const deviceRepoRef = useRef(deviceRepo);
  deviceRepoRef.current = deviceRepo;

  // Load unacknowledged changes from DB on mount
  useEffect(() => {
    if (!deviceRepo) return;
    try {
      const changes = deviceRepo.getUnacknowledgedChanges();
      setNotifications(changes.map(mapChangeToNotification));
    } catch {
      // DB not ready yet
    }
  }, [deviceRepo]);

  // Subscribe to watch events
  useEffect(() => {
    if (!watchManager) return;

    const unsub = watchManager.onEvent((event: WatchEvent) => {
      if (event.type === "change:detected") {
        const data = event.data as { change: ChangeRecord; newContent?: { data: string } };
        const notif = mapChangeToNotification(data.change);
        if (data.newContent) {
          notif.preview = data.newContent.data.slice(0, 200);
        }

        setNotifications((prev) => [notif, ...prev]);
      }

      // Update active watch count
      setActiveWatchCount(watchManager.getActiveWatches().length);
    });

    // Initial count
    setActiveWatchCount(watchManager.getActiveWatches().length);

    return unsub;
  }, [watchManager]);

  // Periodic refresh of active watch count
  useEffect(() => {
    if (!watchManager) return;
    const timer = setInterval(() => {
      setActiveWatchCount(watchManager.getActiveWatches().length);
    }, 10_000);
    return () => clearInterval(timer);
  }, [watchManager]);

  const acknowledge = useCallback(
    (notificationId: number) => {
      deviceRepoRef.current?.acknowledgeChange(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    },
    [],
  );

  const acknowledgeEndpoint = useCallback(
    (endpointId: string) => {
      deviceRepoRef.current?.acknowledgeAllForEndpoint(endpointId);
      setNotifications((prev) =>
        prev.filter((n) => n.endpointId !== endpointId),
      );
    },
    [],
  );

  const acknowledgeAll = useCallback(() => {
    for (const n of notifications) {
      deviceRepoRef.current?.acknowledgeChange(n.id);
    }
    setNotifications([]);
  }, [notifications]);

  const stopWatch = useCallback(
    (endpointId: string) => {
      watchManager?.stopWatch(endpointId);
      setActiveWatchCount(watchManager?.getActiveWatches().length ?? 0);
    },
    [watchManager],
  );

  return {
    notifications,
    activeWatchCount,
    acknowledge,
    acknowledgeEndpoint,
    acknowledgeAll,
    stopWatch,
  };
}

// ─── Helpers ────────────────────────────────────────────────

function mapChangeToNotification(change: ChangeRecord): WatchNotification {
  return {
    id: change.id ?? 0,
    endpointId: change.endpointId,
    description: change.description,
    severity: change.severity,
    detectedAt: change.detectedAt,
    changeType: change.changeType,
  };
}

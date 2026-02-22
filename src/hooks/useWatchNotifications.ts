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
import type { WatchManager } from "../reactive/watchManager";
import type { ChangeDetectedEvent } from "../reactive/types";

export interface WatchNotification {
  id: string;
  targetId: string;
  targetType: 'device' | 'service';
  description: string;
  severity: "info" | "warning" | "alert";
  detectedAt: Date;
  changeType: 'content' | 'status' | 'metadata';
  /** Preview of new content (for display) */
  preview?: string;
  changeScore: number;
}

export interface UseWatchNotificationsReturn {
  /** Unacknowledged notifications, newest first */
  notifications: WatchNotification[];
  /** Number of active watch rules */
  activeWatchCount: number;
  /** Acknowledge (dismiss) a single notification */
  acknowledge: (notificationId: string) => void;
  /** Acknowledge all notifications for an endpoint */
  acknowledgeEndpoint: (targetId: string) => void;
  /** Acknowledge all */
  acknowledgeAll: () => void;
  /** Stop watching an endpoint */
  stopWatch: (targetId: string) => void;
}

export function useWatchNotifications(
  watchManager: WatchManager | null,
): UseWatchNotificationsReturn {
  const [notifications, setNotifications] = useState<WatchNotification[]>([]);
  const [activeWatchCount, setActiveWatchCount] = useState(0);

  // Subscribe to watch events
  useEffect(() => {
    if (!watchManager) return;

    const unsub = watchManager.addEventListener((event) => {
      if (event.type === "change_detected") {
        const changeEvent = event.data as ChangeDetectedEvent;
        const notif = mapChangeToNotification(changeEvent);
        
        setNotifications((prev) => [notif, ...prev]);
      }

      // Update active watch count
      setActiveWatchCount(watchManager.getActiveWatchCount());
    });

    // Initial count
    setActiveWatchCount(watchManager.getActiveWatchCount());

    return () => {
      if (unsub) {
        watchManager.removeEventListener(unsub);
      }
    };
  }, [watchManager]);

  // Periodic refresh of active watch count
  useEffect(() => {
    if (!watchManager) return;
    const timer = setInterval(() => {
      setActiveWatchCount(watchManager.getActiveWatchCount());
    }, 10_000);
    return () => clearInterval(timer);
  }, [watchManager]);

  const acknowledge = useCallback(
    (notificationId: string) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    },
    [],
  );

  const acknowledgeEndpoint = useCallback(
    (targetId: string) => {
      setNotifications((prev) =>
        prev.filter((n) => n.targetId !== targetId),
      );
    },
    [],
  );

  const acknowledgeAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const stopWatch = useCallback(
    (targetId: string) => {
      // This would integrate with WatchManager to stop watching
      // For now, just update the count
      setActiveWatchCount((prev) => Math.max(0, prev - 1));
    },
    [],
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

function mapChangeToNotification(change: ChangeDetectedEvent): WatchNotification {
  return {
    id: change.id,
    targetId: change.targetId,
    targetType: change.targetType,
    description: change.summary,
    severity: change.changeScore > 0.7 ? "alert" : change.changeScore > 0.4 ? "warning" : "info",
    detectedAt: change.detectedAt,
    changeType: change.changeType,
    preview: change.currentContent?.slice(0, 200),
    changeScore: change.changeScore,
  };
}

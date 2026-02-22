/**
 * WatchBadge - displays change notifications and watch status
 * Shows real-time alerts for monitored devices and services
 */

import React, { useState, useEffect } from 'react';
import type { ChangeDetectedEvent, WatchManagerEvent } from '../reactive/types';

interface WatchBadgeProps {
  onWatchEvent?: (event: WatchManagerEvent) => void;
  className?: string;
}

interface Notification {
  id: string;
  type: 'change_detected' | 'watch_started' | 'watch_expired' | 'watch_cancelled';
  message: string;
  timestamp: Date;
  details?: any;
}

export const WatchBadge: React.FC<WatchBadgeProps> = ({ 
  onWatchEvent, 
  className = '' 
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Simulate receiving watch events (in real implementation, this would come from WatchManager)
  useEffect(() => {
    // This would be replaced with actual event listener from WatchManager
    const handleWatchEvent = (event: WatchManagerEvent) => {
      const notification = createNotification(event);
      if (notification) {
        setNotifications(prev => [notification, ...prev].slice(0, 50)); // Keep last 50
        setUnreadCount(prev => prev + 1);
        
        if (onWatchEvent) {
          onWatchEvent(event);
        }
      }
    };

    // Simulate some events for demo
    const demoEvents: WatchManagerEvent[] = [
      {
        type: 'watch_started',
        timestamp: new Date(),
        data: { targetId: 'camera-salon', targetType: 'service' }
      },
      {
        type: 'change_detected',
        timestamp: new Date(),
        data: {
          targetId: 'camera-salon',
          targetType: 'service',
          summary: 'Motion detected in living room',
          changeScore: 0.75
        } as ChangeDetectedEvent
      }
    ];

    // Simulate receiving events
    const timer = setTimeout(() => {
      demoEvents.forEach(handleWatchEvent);
    }, 1000);

    return () => clearTimeout(timer);
  }, [onWatchEvent]);

  const createNotification = (event: WatchManagerEvent): Notification | null => {
    switch (event.type) {
      case 'change_detected':
        const changeEvent = event.data as ChangeDetectedEvent;
        return {
          id: changeEvent.id,
          type: 'change_detected',
          message: `🔔 ${changeEvent.summary}`,
          timestamp: changeEvent.detectedAt,
          details: changeEvent
        };

      case 'watch_started':
        return {
          id: crypto.randomUUID(),
          type: 'watch_started',
          message: `👁️ Started watching ${event.data.targetType}:${event.data.targetId}`,
          timestamp: event.timestamp,
          details: event.data
        };

      case 'watch_expired':
        return {
          id: crypto.randomUUID(),
          type: 'watch_expired',
          message: `⏰ Watch expired for ${event.data.targetType}:${event.data.targetId}`,
          timestamp: event.timestamp,
          details: event.data
        };

      case 'watch_cancelled':
        return {
          id: crypto.randomUUID(),
          type: 'watch_cancelled',
          message: `🚫 Cancelled watch for ${event.data.targetType}:${event.data.targetId}`,
          timestamp: event.timestamp,
          details: event.data
        };

      default:
        return null;
    }
  };

  const markAsRead = () => {
    setUnreadCount(0);
  };

  const clearNotifications = () => {
    setNotifications([]);
    setUnreadCount(0);
  };

  const formatTime = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) {
      return 'just now';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}m ago`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getNotificationIcon = (type: string): string => {
    switch (type) {
      case 'change_detected':
        return '🔔';
      case 'watch_started':
        return '👁️';
      case 'watch_expired':
        return '⏰';
      case 'watch_cancelled':
        return '🚫';
      default:
        return '📢';
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Badge button */}
      <button
        onClick={() => {
          setIsVisible(!isVisible);
          if (!isVisible) {
            markAsRead();
          }
        }}
        className="relative p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
        title="Watch Notifications"
      >
        <svg
          className="w-5 h-5 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        
        {/* Unread count indicator */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications dropdown */}
      {isVisible && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Watch Notifications</h3>
              <button
                onClick={clearNotifications}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No notifications yet
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start space-x-3">
                    <span className="text-lg flex-shrink-0">
                      {getNotificationIcon(notification.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 break-words">
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {formatTime(notification.timestamp)}
                      </p>
                      
                      {/* Additional details for change events */}
                      {notification.type === 'change_detected' && notification.details && (
                        <div className="mt-2 text-xs text-gray-600">
                          <div>Change score: {((notification.details as ChangeDetectedEvent).changeScore * 100).toFixed(1)}%</div>
                          {(notification.details as ChangeDetectedEvent).previousContent && (
                            <div className="mt-1">
                              <div className="font-medium">Previous:</div>
                              <div className="truncate text-gray-500">
                                {(notification.details as ChangeDetectedEvent).previousContent}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

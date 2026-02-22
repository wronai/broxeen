/**
 * WatchBadge - displays change notifications and watch status
 * Shows real-time alerts for monitored devices and services
 */

import React, { useState, useEffect } from 'react';
import { useWatchNotifications } from '../hooks/useWatchNotifications';
import type { WatchManager } from '../reactive/watchManager';

interface WatchBadgeProps {
  watchManager?: WatchManager | null;
  className?: string;
}

export const WatchBadge: React.FC<WatchBadgeProps> = ({ 
  watchManager, 
  className = '' 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const { notifications, activeWatchCount, acknowledge, acknowledgeAll } = useWatchNotifications(watchManager || null);

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
      case 'content':
        return '📄';
      case 'status':
        return '🔄';
      case 'metadata':
        return '⚙️';
      default:
        return '🔔';
    }
  };

  const getSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'alert':
        return 'bg-red-500';
      case 'warning':
        return 'bg-yellow-500';
      case 'info':
      default:
        return 'bg-blue-500';
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Badge button */}
      <button
        onClick={() => {
          setIsVisible(!isVisible);
        }}
        className="relative p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
        title={`Watch Notifications (${activeWatchCount} active)`}
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
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {notifications.length > 9 ? '9+' : notifications.length}
          </span>
        )}
        
        {/* Active watch count indicator */}
        {activeWatchCount > 0 && (
          <span className="absolute -bottom-1 -right-1 bg-green-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
            {activeWatchCount}
          </span>
        )}
      </button>

      {/* Notifications dropdown */}
      {isVisible && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Watch Notifications
                {activeWatchCount > 0 && (
                  <span className="ml-2 text-sm text-gray-500">
                    ({activeWatchCount} active)
                  </span>
                )}
              </h3>
              <div className="flex gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={acknowledgeAll}
                    className="text-sm text-blue-500 hover:text-blue-700"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && activeWatchCount === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No active watches or notifications
              </div>
            ) : notifications.length === 0 && activeWatchCount > 0 ? (
              <div className="p-4 text-center text-gray-500">
                {activeWatchCount} watches active, no changes detected yet
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start space-x-3">
                    <span className="text-lg flex-shrink-0">
                      {getNotificationIcon(notification.changeType)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {notification.targetType}:{notification.targetId}
                        </p>
                        <span className={`inline-block w-2 h-2 rounded-full ${getSeverityColor(notification.severity)}`}></span>
                      </div>
                      <p className="text-sm text-gray-600 break-words">
                        {notification.description}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-xs text-gray-500">
                          {formatTime(notification.detectedAt)}
                        </p>
                        <button
                          onClick={() => acknowledge(notification.id)}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          Dismiss
                        </button>
                      </div>
                      
                      {/* Change score and preview */}
                      <div className="mt-2 text-xs text-gray-600">
                        <div>Change score: {(notification.changeScore * 100).toFixed(1)}%</div>
                        {notification.preview && (
                          <div className="mt-1 p-2 bg-gray-50 rounded text-gray-700 truncate">
                            {notification.preview}
                          </div>
                        )}
                      </div>
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

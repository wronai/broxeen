/**
 * Simple WatchBadge - placeholder version without complex dependencies
 */

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface WatchBadgeProps {
  onWatchEvent?: (event: { type: string; timestamp: Date }) => void;
  className?: string;
}

export const WatchBadge: React.FC<WatchBadgeProps> = ({ 
  onWatchEvent, 
  className = '' 
}) => {
  const [isWatching, setIsWatching] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  const handleClick = () => {
    const newWatchingState = !isWatching;
    setIsWatching(newWatchingState);
    
    if (onWatchEvent) {
      onWatchEvent({
        type: newWatchingState ? 'watch_started' : 'watch_cancelled',
        timestamp: new Date()
      });
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
        isWatching 
          ? 'bg-green-600 text-white hover:bg-green-700' 
          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
      } ${className}`}
      title={isWatching ? 'Monitorowanie aktywne' : 'Włącz monitorowanie'}
    >
      {isWatching ? <Eye size={16} /> : <EyeOff size={16} />}
      <span>{isWatching ? 'Monitoruj' : 'Monitoruj'}</span>
      {notificationCount > 0 && (
        <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
          {notificationCount}
        </span>
      )}
    </button>
  );
};

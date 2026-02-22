/**
 * Quick Command History Component
 * Shows recent commands as a dropdown when input is focused
 */

import React, { useState, useEffect } from 'react';
import { Clock, Search } from 'lucide-react';
import type { CommandHistoryItem } from './CommandHistory';

interface QuickCommandHistoryProps {
  onSelect: (command: string) => void;
  className?: string;
  maxItems?: number;
  selectedNetwork?: { scope: string; name: string } | null;
}

export const QuickCommandHistory: React.FC<QuickCommandHistoryProps> = ({
  onSelect,
  className = '',
  maxItems = 5,
  selectedNetwork
}) => {
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('broxeen_command_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed.slice(0, maxItems));
      } catch (error) {
        console.error('Failed to load command history:', error);
      }
    }
  }, [maxItems]);

  const getCategoryIcon = (category: CommandHistoryItem['category']) => {
    switch (category) {
      case 'network': return '🌐';
      case 'browse': return '🌍';
      case 'chat': return '💬';
      case 'camera': return '📷';
      default: return '📝';
    }
  };

  const getSuccessIndicator = (success?: boolean) => {
    if (success === undefined) return null;
    return success ? '✅' : '❌';
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'przed chwilą';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
    return `${Math.floor(diff / 3600000)} h temu`;
  };

  // Popular commands based on network context
  const getPopularCommands = () => {
    const baseCommands = [
      { category: 'browse' as const, command: 'https://onet.pl', description: 'Przeglądaj popularny portal' },
      { category: 'browse' as const, command: 'https://google.com', description: 'Wyszukiwarka Google' },
      { category: 'chat' as const, command: 'jaka jest pogoda', description: 'Sprawdź pogodę' },
      { category: 'chat' as const, command: 'opisz aktualny czas', description: 'Sprawdź czas' },
      { category: 'chat' as const, command: 'pomoc', description: 'Pokaż pomoc' },
    ];

    const networkCommands = [
      { category: 'network' as const, command: 'znajdź kamere w sieci', description: 'Skanuj sieć w poszukiwaniu kamer' },
      { category: 'network' as const, command: 'skanuj siec lokalna', description: 'Odkryj urządzenia w sieci lokalnej' },
      { category: 'camera' as const, command: 'co widać na kamerze', description: 'Pokaż podgląd kamery' },
      { category: 'camera' as const, command: 'znajdź kamery ogrodowe', description: 'Wyszukaj kamery zewnętrzne' },
    ];

    // If network is selected, prioritize network commands
    if (selectedNetwork) {
      return [...networkCommands.slice(0, 3), ...baseCommands.slice(0, 2)];
    }

    return baseCommands;
  };

  const popularCommands = getPopularCommands();

  if (history.length === 0) {
    return (
      <div className={`bg-gray-800 rounded-lg border border-gray-700 ${className}`}>
        <div className="p-3 border-b border-gray-700">
          <div className="flex items-center space-x-2 text-sm text-gray-300">
            <Search className="w-4 h-4" />
            <span>Popularne komendy</span>
            {selectedNetwork && (
              <span className="text-xs text-broxeen-400 bg-gray-700 px-2 py-1 rounded">
                {selectedNetwork.name}
              </span>
            )}
          </div>
        </div>
        
        <div className="max-h-64 overflow-y-auto">
          {popularCommands.map((cmd, index) => {
            const categoryIcon = getCategoryIcon(cmd.category);
            
            return (
              <div
                key={index}
                className="flex items-center space-x-3 p-3 hover:bg-gray-700 cursor-pointer transition-colors border-b border-gray-700 last:border-b-0"
                onClick={() => onSelect(cmd.command)}
              >
                <div className="flex items-center space-x-2 text-sm">
                  <span className="text-lg">{categoryIcon}</span>
                  <span className="text-gray-500 text-xs">
                    #{index + 1}
                  </span>
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate font-medium">
                    {cmd.command}
                  </div>
                  
                  <div className="text-xs text-gray-400 truncate mt-1">
                    {cmd.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="p-2 border-t border-gray-700">
          <div className="text-xs text-gray-400 text-center">
            💡 Kliknij komendę, aby ją wykonać
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 rounded-lg border border-gray-700 ${className}`} data-testid="quick-history">
      <div className="p-3 border-b border-gray-700">
        <div className="flex items-center space-x-2 text-sm text-gray-300">
          <Clock className="w-4 h-4" />
          <span>Ostatnie komendy</span>
        </div>
      </div>
      
      <div className="max-h-64 overflow-y-auto">
        {history.map((item, index) => {
          const categoryIcon = getCategoryIcon(item.category);
          const successIndicator = getSuccessIndicator(item.success);
          
          return (
            <div
              key={item.id}
              className="flex items-center space-x-3 p-3 hover:bg-gray-700 cursor-pointer transition-colors border-b border-gray-700 last:border-b-0"
              onClick={() => onSelect(item.command)}
              data-testid={`quick-history-item-${index}`}
            >
              <div className="flex items-center space-x-2 text-sm">
                <span className="text-lg">{categoryIcon}</span>
                {successIndicator && (
                  <span className="text-xs">{successIndicator}</span>
                )}
                <span className="text-gray-500 text-xs">
                  #{index + 1}
                </span>
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-200 truncate font-medium">
                  {item.command}
                </div>
                
                {item.result && (
                  <div className="text-xs text-gray-400 truncate mt-1">
                    {item.result}
                  </div>
                )}
                
                <div className="flex items-center space-x-2 mt-1">
                  <span className="text-xs text-gray-500">
                    {formatTimestamp(item.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="p-2 border-t border-gray-700">
        <div className="text-xs text-gray-400 text-center">
          {history.length} ostatnich komend
        </div>
      </div>
    </div>
  );
};

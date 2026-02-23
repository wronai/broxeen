/**
 * Command History Component
 * Displays recently used commands for quick access
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Clock, Search, Trash2, RefreshCw, Command, Wifi, Globe, Camera, MessageCircle, MoreHorizontal } from 'lucide-react';

export interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: number;
  result?: string;
  category: 'network' | 'browse' | 'chat' | 'camera' | 'other';
  success?: boolean;
}

interface CommandHistoryProps {
  onSelect: (command: string) => void;
  className?: string;
  maxItems?: number;
}

type CategoryFilter = 'all' | CommandHistoryItem['category'];

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string; icon: React.ReactNode; color: string }> = [
  { id: 'all', label: 'Wszystko', icon: <Command size={12} />, color: 'text-gray-300' },
  { id: 'network', label: 'Sieć', icon: <Wifi size={12} />, color: 'text-blue-400' },
  { id: 'camera', label: 'Kamery', icon: <Camera size={12} />, color: 'text-orange-400' },
  { id: 'browse', label: 'Strony', icon: <Globe size={12} />, color: 'text-green-400' },
  { id: 'chat', label: 'Czat', icon: <MessageCircle size={12} />, color: 'text-purple-400' },
  { id: 'other', label: 'Inne', icon: <MoreHorizontal size={12} />, color: 'text-gray-400' },
];

export const CommandHistory: React.FC<CommandHistoryProps> = ({
  onSelect,
  className = '',
  maxItems = 10
}) => {
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredHistory, setFilteredHistory] = useState<CommandHistoryItem[]>([]);
  const [showDetails, setShowDetails] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  // Count items per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: history.length };
    for (const item of history) {
      counts[item.category] = (counts[item.category] || 0) + 1;
    }
    return counts;
  }, [history]);

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('broxeen_command_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
        setFilteredHistory(parsed);
      } catch (error) {
        console.error('Failed to load command history:', error);
      }
    }
  }, []);

  // Filter history based on search query AND active category
  useEffect(() => {
    let filtered = activeCategory === 'all'
      ? history
      : history.filter(item => item.category === activeCategory);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.command.toLowerCase().includes(q) ||
        item.result?.toLowerCase().includes(q)
      );
    }

    setFilteredHistory(filtered.slice(0, maxItems));
  }, [searchQuery, history, maxItems, activeCategory]);

  // Save history to localStorage
  const saveHistory = (newHistory: CommandHistoryItem[]) => {
    localStorage.setItem('broxeen_command_history', JSON.stringify(newHistory));
    setHistory(newHistory);
    setFilteredHistory(newHistory.slice(0, maxItems));
  };

  // Add new command to history
  const addToHistory = (command: string, result?: string, category: CommandHistoryItem['category'] = 'other', success: boolean = true) => {
    const newItem: CommandHistoryItem = {
      id: Date.now().toString(),
      command: command.trim(),
      timestamp: Date.now(),
      result,
      category,
      success
    };

    // Remove existing entry with same command
    const existingIndex = history.findIndex(item => item.command === newItem.command);
    let newHistory = [...history];
    
    if (existingIndex >= 0) {
      // Update existing entry
      newHistory[existingIndex] = {
        ...newHistory[existingIndex],
        timestamp: Date.now(),
        result,
        category,
        success
      };
    } else {
      // Add new entry
      newHistory.unshift(newItem);
    }

    // Keep only last 50 entries
    newHistory = newHistory.slice(0, 50);
    
    saveHistory(newHistory);
  };

  // Remove item from history
  const removeFromHistory = (id: string) => {
    const newHistory = history.filter(item => item.id !== id);
    saveHistory(newHistory);
  };

  // Clear all history
  const clearHistory = () => {
    saveHistory([]);
  };

  // Re-execute command
  const handleSelect = (item: CommandHistoryItem) => {
    onSelect(item.command);
    // Update usage timestamp
    addToHistory(item.command, item.result, item.category, item.success);
  };

  // Get category icon and color
  const getCategoryInfo = (category: CommandHistoryItem['category']) => {
    switch (category) {
      case 'network':
        return { icon: '🌐', color: 'text-blue-400', label: 'Sieć' };
      case 'browse':
        return { icon: '🌍', color: 'text-green-400', label: 'Przeglądaj' };
      case 'chat':
        return { icon: '💬', color: 'text-purple-400', label: 'Czat' };
      case 'camera':
        return { icon: '📷', color: 'text-orange-400', label: 'Kamera' };
      default:
        return { icon: '📝', color: 'text-gray-400', label: 'Inne' };
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'przed chwilą';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} h temu`;
    return `${Math.floor(diff / 86400000)} dni temu`;
  };

  // Get success indicator
  const getSuccessIndicator = (success?: boolean) => {
    if (success === undefined) return null;
    return success ? '✅' : '❌';
  };

  // Make function available globally for other components
  useEffect(() => {
    (window as any).broxeenCommandHistory = {
      addToHistory,
      clearHistory,
      getHistory: () => history
    };
  }, [history]);

  if (filteredHistory.length === 0) {
    return (
      <div className={`bg-gray-800 rounded-lg p-6 ${className}`}>
        <div className="text-center py-8 text-gray-400">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Brak historii komend</p>
          <p className="text-sm mt-1">Rozpocznij korzystanie z aplikacji, aby zobaczyć ostatnie komendy</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 rounded-lg p-6 ${className}`} data-testid="command-history">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-200 flex items-center space-x-2">
            <Command className="w-5 h-5" />
            <span>Ostatnie komendy</span>
          </h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setFilteredHistory(history.slice(0, maxItems))}
              className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
              title="Odśwież"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={clearHistory}
              className="p-2 text-gray-400 hover:text-red-400 transition-colors"
              title="Wyczyść historię"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <p className="text-gray-400 text-sm">
          Kliknij komendę, aby ponownie ją wykonać
        </p>
      </div>

      {/* Category filter tabs */}
      <div className="mb-3 flex flex-wrap gap-1" data-testid="category-tabs">
        {CATEGORY_TABS.map(tab => {
          const count = categoryCounts[tab.id] || 0;
          const isActive = activeCategory === tab.id;
          if (tab.id !== 'all' && count === 0) return null;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveCategory(tab.id)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isActive
                  ? `bg-broxeen-600/30 border border-broxeen-500/40 ${tab.color}`
                  : 'bg-gray-700/50 border border-transparent text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
              data-testid={`category-tab-${tab.id}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {count > 0 && (
                <span className={`ml-0.5 text-[10px] ${isActive ? 'opacity-80' : 'opacity-50'}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Szukaj komendy..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-700 text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-broxeen-500"
          />
        </div>
      </div>

      {/* Command list */}
      <div className="space-y-2">
        {filteredHistory.map((item, index) => {
          const categoryInfo = getCategoryInfo(item.category);
          const successIndicator = getSuccessIndicator(item.success);
          
          return (
            <div
              key={item.id}
              className="group relative"
            >
              <div
                className="flex items-start justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer"
                onClick={() => handleSelect(item)}
              >
                <div className="flex items-start space-x-3 flex-1">
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-lg">{categoryInfo.icon}</span>
                    {successIndicator && (
                      <span className="text-sm">{successIndicator}</span>
                    )}
                    <span className="text-xs text-gray-400">
                      #{index + 1}
                    </span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-200 truncate">
                      {item.command}
                    </div>
                    
                    {item.result && (
                      <div className="text-sm text-gray-400 truncate mt-1">
                        {item.result}
                      </div>
                    )}
                    
                    <div className="flex items-center space-x-3 mt-1">
                      <span className={`text-xs ${categoryInfo.color}`}>
                        {categoryInfo.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTimestamp(item.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromHistory(item.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400 transition-all"
                  title="Usuń z historii"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              
              {/* Expandable details */}
              {showDetails === item.id && (
                <div className="mt-2 p-3 bg-gray-750 rounded-lg border border-gray-600">
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-400">Komenda:</span>
                      <span className="text-gray-200 ml-2">{item.command}</span>
                    </div>
                    
                    {item.result && (
                      <div>
                        <span className="text-gray-400">Wynik:</span>
                        <div className="text-gray-200 mt-1 p-2 bg-gray-800 rounded">
                          {item.result}
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <span className="text-gray-400">Kategoria:</span>
                      <span className={`ml-2 ${categoryInfo.color}`}>{categoryInfo.label}</span>
                    </div>
                    
                    <div>
                      <span className="text-gray-400">Status:</span>
                      <span className="ml-2">
                        {item.success === undefined ? 'Nieznany' : item.success ? 'Sukces' : 'Błąd'}
                      </span>
                    </div>
                    
                    <div>
                      <span className="text-gray-400">Data:</span>
                      <span className="ml-2">{new Date(item.timestamp).toLocaleString('pl-PL')}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            Wyświetlono {filteredHistory.length} z {history.length} komend
          </span>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-broxeen-400 hover:text-broxeen-300"
            >
              Wyczyść wyszukiwanie
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

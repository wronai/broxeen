import React, { useState, useEffect, useMemo } from 'react';
import { Command, Zap, Globe, Wifi, Camera, Search, Clock, TrendingUp, Filter, Star, History } from 'lucide-react';

interface QuickCommand {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  query: string;
  category: 'browse' | 'network' | 'camera' | 'search';
  usageCount?: number;
  isFavorite?: boolean;
}

interface SavedCommandHistoryItem {
  id: string;
  command: string;
  timestamp: number;
  result?: string;
  category?: QuickCommand['category'] | 'other';
  success?: boolean;
}

interface QuickCommandsProps {
  onCommandSelect: (query: string) => void;
  recentCommands?: string[];
  className?: string;
}

export const QuickCommands: React.FC<QuickCommandsProps> = ({
  onCommandSelect,
  recentCommands = [],
  className = '',
}) => {
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [filter, setFilter] = useState<'all' | 'browse' | 'network' | 'camera' | 'search'>('all');
  const [showFavorites, setShowFavorites] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [historyRecords, setHistoryRecords] = useState<SavedCommandHistoryItem[]>([]);

  // Load command history for intelligent suggestions
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const saved = localStorage.getItem('broxeen_command_history');
      if (saved) {
        const parsed = JSON.parse(saved) as SavedCommandHistoryItem[];
        setHistoryRecords(parsed);
      }
    } catch (error) {
      console.warn('[QuickCommands] Failed to parse command history', error);
    }
  }, []);

  const quickCommands: QuickCommand[] = [
    // Browse commands
    {
      id: 'browse-onet',
      title: 'Onet',
      description: 'Portal informacyjny',
      icon: <Globe className="w-4 h-4" />,
      query: 'onet.pl',
      category: 'browse',
      usageCount: 15,
    },
    {
      id: 'browse-wp',
      title: 'WP',
      description: 'Wiadomości, sport',
      icon: <Globe className="w-4 h-4" />,
      query: 'wp.pl',
      category: 'browse',
      usageCount: 12,
    },
    {
      id: 'browse-interia',
      title: 'Interia',
      description: 'Portal internetowy',
      icon: <Globe className="w-4 h-4" />,
      query: 'interia.pl',
      category: 'browse',
      usageCount: 8,
    },
    {
      id: 'browse-youtube',
      title: 'YouTube',
      description: 'Wideo online',
      icon: <Globe className="w-4 h-4" />,
      query: 'youtube.com',
      category: 'browse',
      usageCount: 20,
      isFavorite: true,
    },
    {
      id: 'browse-facebook',
      title: 'Facebook',
      description: 'Social media',
      icon: <Globe className="w-4 h-4" />,
      query: 'facebook.com',
      category: 'browse',
      usageCount: 18,
    },
    
    // Network commands
    {
      id: 'network-scan',
      title: 'Skanuj sieć',
      description: 'Znajdź urządzenia',
      icon: <Wifi className="w-4 h-4" />,
      query: 'znajdź kamere w sieci',
      category: 'network',
      usageCount: 25,
      isFavorite: true,
    },
    {
      id: 'network-status',
      title: 'Status sieci',
      description: 'Sprawdź połączenia',
      icon: <Wifi className="w-4 h-4" />,
      query: 'status sieci',
      category: 'network',
      usageCount: 10,
    },
    
    // Camera commands
    {
      id: 'camera-preview',
      title: 'Podgląd kamer',
      description: 'Znajdź kamery',
      icon: <Camera className="w-4 h-4" />,
      query: 'pokaż kamery',
      category: 'camera',
      usageCount: 22,
      isFavorite: true,
    },
    {
      id: 'camera-details',
      title: 'Szczegóły kamer',
      description: 'Informacje o kamerach',
      icon: <Camera className="w-4 h-4" />,
      query: 'szczegóły kamer',
      category: 'camera',
      usageCount: 7,
    },
    
    // Search commands
    {
      id: 'search-news',
      title: 'Wiadomości',
      description: 'Najnowsze informacje',
      icon: <Search className="w-4 h-4" />,
      query: 'wyszukaj wiadomości dzisiaj',
      category: 'search',
      usageCount: 14,
    },
    {
      id: 'search-weather',
      title: 'Pogoda',
      description: 'Prognoza pogody',
      icon: <Search className="w-4 h-4" />,
      query: 'wyszukaj pogoda warszawa',
      category: 'search',
      usageCount: 11,
    },
    {
      id: 'search-react',
      title: 'React Tutorial',
      description: 'Nauka React',
      icon: <Search className="w-4 h-4" />,
      query: 'wyszukaj React tutorial',
      category: 'search',
      usageCount: 9,
    },
  ];

  // Helper functions - must be defined before useMemo
  const formatCommandTitle = (command: string): string => {
    // Truncate long commands
    if (command.length > 30) {
      return command.slice(0, 27) + '...';
    }
    // Capitalize first letter
    return command.charAt(0).toUpperCase() + command.slice(1);
  };

  const inferCategory = (storedCategory: string | undefined, command: string): QuickCommand['category'] => {
    // If we have a valid stored category, use it
    if (storedCategory && ['browse', 'network', 'camera', 'search'].includes(storedCategory)) {
      return storedCategory as QuickCommand['category'];
    }
    
    // Otherwise infer from command text
    const lower = command.toLowerCase();
    if (lower.includes('kamer') || lower.includes('camera')) return 'camera';
    if (lower.includes('sieci') || lower.includes('network') || lower.includes('skanuj')) return 'network';
    if (lower.includes('.pl') || lower.includes('.com') || lower.includes('http')) return 'browse';
    if (lower.includes('wyszukaj') || lower.includes('search')) return 'search';
    
    // Default to browse
    return 'browse';
  };

  const getCategoryIcon = (category: QuickCommand['category']) => {
    switch (category) {
      case 'browse':
        return <Globe className="w-3 h-3" />;
      case 'network':
        return <Wifi className="w-3 h-3" />;
      case 'camera':
        return <Camera className="w-3 h-3" />;
      case 'search':
        return <Search className="w-3 h-3" />;
      default:
        return <Command className="w-3 h-3" />;
    }
  };

  useEffect(() => {
    // Sort by usage count and favorites
    const sortedCommands = [...quickCommands].sort((a, b) => {
      // Favorites first
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      // Then by usage count
      return (b.usageCount || 0) - (a.usageCount || 0);
    });
    
    setCommands(sortedCommands);
  }, []);

  const historySuggestions: QuickCommand[] = useMemo(() => {
    if (!historyRecords.length) return [];

    const aggregation = new Map<string, { count: number; lastUsed: number; category: QuickCommand['category'] }>();

    historyRecords.forEach((record) => {
      const command = record.command?.trim();
      if (!command) return;
      const category = inferCategory(record.category, command);
      const existing = aggregation.get(command) || { count: 0, lastUsed: 0, category };
      aggregation.set(command, {
        count: existing.count + 1,
        lastUsed: Math.max(existing.lastUsed, record.timestamp || 0),
        category,
      });
    });

    return Array.from(aggregation.entries())
      .sort((a, b) => {
        if (b[1].count !== a[1].count) return b[1].count - a[1].count;
        return b[1].lastUsed - a[1].lastUsed;
      })
      .slice(0, 5)
      .map(([command, meta], index) => ({
        id: `history-${index}`,
        title: formatCommandTitle(command),
        description: 'Najczęściej używane',
        icon: getCategoryIcon(meta.category),
        query: command,
        category: meta.category,
        usageCount: meta.count,
      }));
  }, [historyRecords]);

  const mergedCommands = useMemo(() => {
    const combined = [...historySuggestions, ...commands];
    const seen = new Set<string>();
    return combined.filter((cmd) => {
      if (seen.has(cmd.query)) return false;
      seen.add(cmd.query);
      return true;
    });
  }, [commands, historySuggestions]);

  const filteredCommands = mergedCommands.filter(cmd => {
    const categoryMatch = filter === 'all' || cmd.category === filter;
    const favoriteMatch = !showFavorites || cmd.isFavorite;
    const searchMatch = searchTerm
      ? `${cmd.title} ${cmd.description} ${cmd.query}`.toLowerCase().includes(searchTerm.toLowerCase())
      : true;
    return categoryMatch && favoriteMatch && searchMatch;
  });

  const getCategoryColor = (category: QuickCommand['category']) => {
    switch (category) {
      case 'browse':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'network':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'camera':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'search':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const handleCommandClick = (command: QuickCommand) => {
    onCommandSelect(command.query);
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  const toggleFavorite = (commandId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCommands(prev => prev.map(cmd => 
      cmd.id === commandId 
        ? { ...cmd, isFavorite: !cmd.isFavorite }
        : cmd
    ));
  };

  return (
    <div className={`bg-gray-800/50 rounded-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-medium text-gray-200">Szybkie komendy</h3>
          </div>
          <button
            onClick={() => setShowFavorites(!showFavorites)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              showFavorites 
                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' 
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {showFavorites ? 'Ulubione' : 'Wszystkie'}
          </button>
        </div>
        
        {/* Search + Filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 bg-gray-900/60 rounded-lg px-3 py-2 border border-gray-700">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Szukaj komendy lub wpisz zapytanie..."
              className="bg-transparent text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none flex-1"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="text-xs text-gray-400 hover:text-gray-200"
              >
                Wyczyść
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Filter className="w-3 h-3" />
            <span>
              {filter === 'all' ? 'Wszystkie kategorie' : `Filtr: ${filter}`}
            </span>
          </div>
        </div>
        
        {/* Category filters */}
        <div className="flex flex-wrap gap-1">
          {['all', 'browse', 'network', 'camera', 'search'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat as any)}
              className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                filter === cat
                  ? 'bg-broxeen-500/20 text-broxeen-400 border border-broxeen-500/30'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {cat !== 'all' && getCategoryIcon(cat as any)}
              {cat === 'all' && 'Wszystkie'}
              {cat === 'browse' && 'Przeglądaj'}
              {cat === 'network' && 'Sieć'}
              {cat === 'camera' && 'Kamery'}
              {cat === 'search' && 'Szukaj'}
            </button>
          ))}
        </div>
      </div>

      {/* Commands grid */}
      <div className="p-4">
        {historySuggestions.length > 0 && !searchTerm && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <History className="w-3 h-3 text-broxeen-400" />
              <span className="text-xs text-gray-400">Najczęściej używane</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {historySuggestions.map((command) => (
                <button
                  key={command.id}
                  onClick={() => handleCommandClick(command)}
                  className="px-3 py-2 rounded-lg bg-gray-800/80 border border-gray-700 text-left text-sm text-gray-200 hover:border-broxeen-500 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {command.icon}
                    <div className="flex flex-col">
                      <span className="font-medium">{command.title}</span>
                      <span className="text-xs text-gray-400">{command.query}</span>
                    </div>
                    <div className="ml-auto flex items-center text-xs text-gray-400 gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {command.usageCount}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {filteredCommands.slice(0, 12).map((command) => (
            <button
              key={command.id}
              onClick={() => handleCommandClick(command)}
              className={`
                relative p-3 rounded-lg border transition-all
                hover:bg-gray-700/50 hover:border-gray-600
                active:scale-95 text-left group
                ${getCategoryColor(command.category)}
              `}
            >
              {/* Favorite indicator */}
              <div
                onClick={(e) => toggleFavorite(command.id, e)}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleFavorite(command.id, e as any);
                  }
                }}
              >
                <div className={`w-3 h-3 ${
                  command.isFavorite 
                    ? 'text-yellow-400 fill-current' 
                    : 'text-gray-500'
                }`}>
                  <Star className="w-3 h-3" fill={command.isFavorite ? 'currentColor' : 'none'} />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 mt-0.5">
                  {command.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {command.title}
                  </div>
                  <div className="text-xs opacity-75 truncate">
                    {command.description}
                  </div>
                  {command.usageCount && (
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className="w-2 h-2 opacity-50" />
                      <span className="text-xs opacity-50">
                        {command.usageCount}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Recent commands */}
        {recentCommands.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-3 h-3 text-gray-400" />
              <div className="text-xs text-gray-400">Ostatnio używane:</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {recentCommands.slice(-4).map((cmd, index) => (
                <button
                  key={index}
                  onClick={() => onCommandSelect(cmd)}
                  className="px-2 py-1 text-xs bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600/50 transition-colors"
                >
                  {cmd.length > 25 ? `${cmd.slice(0, 25)}...` : cmd}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

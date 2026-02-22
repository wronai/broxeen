import React, { useState, useEffect } from 'react';
import { Lightbulb, Sparkles, Target, Wifi, Camera, Search, Globe } from 'lucide-react';

interface ActionSuggestion {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  query: string;
  category: 'network' | 'browse' | 'camera' | 'search' | 'general';
  priority: number;
}

interface ActionSuggestionsProps {
  onActionSelect: (query: string) => void;
  recentQueries?: string[];
  isVisible?: boolean;
}

export const ActionSuggestions: React.FC<ActionSuggestionsProps> = ({
  onActionSelect,
  recentQueries = [],
  isVisible = true,
}) => {
  const [suggestions, setSuggestions] = useState<ActionSuggestion[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<ActionSuggestion[]>([]);

  const baseSuggestions: ActionSuggestion[] = [
    {
      id: 'scan-network',
      title: 'Skanuj sieć lokalną',
      description: 'Znajdź urządzenia w Twojej sieci',
      icon: <Wifi className="w-4 h-4" />,
      query: 'znajdź kamere w sieci',
      category: 'network',
      priority: 10,
    },
    {
      id: 'browse-popular',
      title: 'Przeglądaj popularne strony',
      description: 'Onet, WP, Interia',
      icon: <Globe className="w-4 h-4" />,
      query: 'onet.pl',
      category: 'browse',
      priority: 8,
    },
    {
      id: 'camera-preview',
      title: 'Podgląd kamer',
      description: 'Zobacz znalezione kamery',
      icon: <Camera className="w-4 h-4" />,
      query: 'pokaż kamery',
      category: 'camera',
      priority: 9,
    },
    {
      id: 'search-web',
      title: 'Szukaj w internecie',
      description: 'Wyszukaj informacje',
      icon: <Search className="w-4 h-4" />,
      query: 'wyszukaj React tutorial',
      category: 'search',
      priority: 7,
    },
    {
      id: 'network-status',
      title: 'Status sieci',
      description: 'Sprawdź stan urządzeń',
      icon: <Target className="w-4 h-4" />,
      query: 'status sieci',
      category: 'network',
      priority: 6,
    },
  ];

  useEffect(() => {
    // Combine base suggestions with context-aware suggestions
    const combinedSuggestions = [...baseSuggestions];
    
    // Add suggestions based on recent queries
    if (recentQueries.length > 0) {
      const lastQuery = recentQueries[recentQueries.length - 1];
      
      // If user was browsing, suggest more browse actions
      if (lastQuery.includes('.pl') || lastQuery.includes('.com')) {
        combinedSuggestions.push({
          id: 'more-browse',
          title: 'Kontynuuj przeglądanie',
          description: 'Odkryj więcej stron',
          icon: <Globe className="w-4 h-4" />,
          query: 'wp.pl',
          category: 'browse',
          priority: 5,
        });
      }
      
      // If user was looking for cameras, suggest camera actions
      if (lastQuery.includes('kamera') || lastQuery.includes('camera')) {
        combinedSuggestions.push({
          id: 'camera-details',
          title: 'Szczegóły kamer',
          description: 'Sprawdź szczegóły znalezionych kamer',
          icon: <Camera className="w-4 h-4" />,
          query: 'szczegóły kamer',
          category: 'camera',
          priority: 8,
        });
      }
    }
    
    // Sort by priority and limit to 6 suggestions
    const sortedSuggestions = combinedSuggestions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 6);
    
    setSuggestions(sortedSuggestions);
    setFilteredSuggestions(sortedSuggestions);
  }, [recentQueries]);

  const getCategoryColor = (category: ActionSuggestion['category']) => {
    switch (category) {
      case 'network': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'browse': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'camera': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'search': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const handleSuggestionClick = (suggestion: ActionSuggestion) => {
    onActionSelect(suggestion.query);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="mb-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-yellow-400" />
        <h3 className="text-sm font-medium text-gray-200">Sugerowane akcje</h3>
        <Lightbulb className="w-3 h-3 text-amber-400 ml-auto" />
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {filteredSuggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            onClick={() => handleSuggestionClick(suggestion)}
            className={`
              flex items-center gap-2 p-3 rounded-lg border transition-all
              hover:bg-gray-700/50 hover:border-gray-600
              active:scale-95 text-left
              ${getCategoryColor(suggestion.category)}
            `}
          >
            <div className="flex-shrink-0">
              {suggestion.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {suggestion.title}
              </div>
              <div className="text-xs opacity-75 truncate">
                {suggestion.description}
              </div>
            </div>
          </button>
        ))}
      </div>
      
      {recentQueries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="text-xs text-gray-400 mb-2">Ostatnie zapytania:</div>
          <div className="flex flex-wrap gap-1">
            {recentQueries.slice(-3).map((query, index) => (
              <button
                key={index}
                onClick={() => onActionSelect(query)}
                className="px-2 py-1 text-xs bg-gray-700/50 text-gray-300 rounded hover:bg-gray-600/50 transition-colors"
              >
                {query.length > 20 ? `${query.slice(0, 20)}...` : query}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { Lightbulb, Sparkles, Target, Wifi, Camera, Search, Globe, Brain, TrendingUp, Clock, ArrowRight, FileText } from 'lucide-react';

interface ActionSuggestion {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  query: string;
  category: 'network' | 'browse' | 'camera' | 'search' | 'general' | 'smart' | 'contextual' | 'file';
  priority: number;
  usageCount?: number;
  isFavorite?: boolean;
  isContextual?: boolean;
  confidence?: number;
  reasoning?: string;
}

interface ActionSuggestionsProps {
  onActionSelect: (query: string) => void;
  recentQueries?: string[];
  isVisible?: boolean;
  currentContext?: {
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
    lastCategory?: string;
    deviceCount?: number;
    hasActiveCameras?: boolean;
    isNetworkAvailable?: boolean;
  };
  onLearn?: (query: string, category: string, success: boolean) => void;
}

export const ActionSuggestions: React.FC<ActionSuggestionsProps> = ({
  onActionSelect,
  recentQueries = [],
  isVisible = true,
  currentContext,
  onLearn,
}) => {
  const [suggestions, setSuggestions] = useState<ActionSuggestion[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<ActionSuggestion[]>([]);
  const [learningData, setLearningData] = useState<Record<string, { count: number; category: string; success: number }>>({});

  // Load learning data from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('broxeen_suggestions_learning');
      if (saved) {
        setLearningData(JSON.parse(saved));
      }
    } catch (error) {
      console.warn('Failed to load suggestions learning data:', error);
    }
  }, []);

  // Save learning data when it changes
  useEffect(() => {
    try {
      localStorage.setItem('broxeen_suggestions_learning', JSON.stringify(learningData));
    } catch (error) {
      console.warn('Failed to save suggestions learning data:', error);
    }
  }, [learningData]);

  // Get time of day
  const getTimeOfDay = useCallback((): 'morning' | 'afternoon' | 'evening' | 'night' => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
  }, []);

  // Generate contextual suggestions based on current state
  const generateContextualSuggestions = useCallback((): ActionSuggestion[] => {
    const contextual: ActionSuggestion[] = [];
    const timeOfDay = currentContext?.timeOfDay || getTimeOfDay();
    
    // Time-based suggestions
    if (timeOfDay === 'morning') {
      contextual.push({
        id: 'morning-news',
        title: 'Poranne wiadomości',
        description: 'Start dnia z najnowszymi informacjami',
        icon: <Globe className="w-4 h-4" />,
        query: 'wyszukaj wiadomości dzisiaj',
        category: 'contextual',
        priority: 8,
        isContextual: true,
        confidence: 0.8,
        reasoning: 'Poranne przeglądanie wiadomości'
      });
    }
    
    if (timeOfDay === 'evening' && currentContext?.hasActiveCameras) {
      contextual.push({
        id: 'evening-camera-check',
        title: 'Sprawdź kamery',
        description: 'Wieczorny przegląd monitoringu',
        icon: <Camera className="w-4 h-4" />,
        query: 'status kamer',
        category: 'contextual',
        priority: 9,
        isContextual: true,
        confidence: 0.9,
        reasoning: 'Wieczorna kontrola bezpieczeństwa'
      });
    }
    
    // Network status suggestions
    if (currentContext?.deviceCount && currentContext.deviceCount > 0) {
      contextual.push({
        id: 'device-status',
        title: 'Status urządzeń',
        description: `${currentContext.deviceCount} urządzeń w sieci`,
        icon: <Wifi className="w-4 h-4" />,
        query: 'status sieci',
        category: 'contextual',
        priority: 7,
        isContextual: true,
        confidence: 0.7,
        reasoning: `Wykryto ${currentContext.deviceCount} urządzeń`
      });
    }
    
    // File management suggestions based on time
    if (timeOfDay === 'morning') {
      contextual.push({
        id: 'morning-documents',
        title: 'Przegląd dokumentów',
        description: 'Sprawdź najnowsze pliki',
        icon: <FileText className="w-4 h-4" />,
        query: 'znajdź ostatnie dokumenty',
        category: 'contextual',
        priority: 6,
        isContextual: true,
        confidence: 0.6,
        reasoning: 'Poranne przeglądanie dokumentów'
      });
    }
    
    return contextual;
  }, [currentContext, getTimeOfDay]);

  // Generate smart suggestions based on learning data
  const generateSmartSuggestions = useCallback((): ActionSuggestion[] => {
    const smart: ActionSuggestion[] = [];
    
    // Sort learning data by usage and success rate
    const sortedLearning = Object.entries(learningData)
      .map(([query, data]) => ({ query, ...data }))
      .sort((a, b) => {
        const aScore = a.count * (a.success / Math.max(a.count, 1));
        const bScore = b.count * (b.success / Math.max(b.count, 1));
        return bScore - aScore;
      });
    
    // Add top learned suggestions
    sortedLearning.slice(0, 3).forEach((item, index) => {
      const category = item.category as ActionSuggestion['category'];
      smart.push({
        id: `learned-${index}`,
        title: getSmartTitle(item.query),
        description: `Często używane (${item.count}x)`,
        icon: getSmartIcon(category),
        query: item.query,
        category: 'smart',
        priority: 6 + index,
        confidence: item.success / Math.max(item.count, 1),
        reasoning: `Używane ${item.count} razy, ${Math.round(item.success / Math.max(item.count, 1) * 100)}% sukcesu`
      });
    });
    
    return smart;
  }, [learningData]);

  const getSmartTitle = (query: string): string => {
    if (query.includes('kamer')) return 'Sprawdź kamery';
    if (query.includes('sieci')) return 'Skanuj sieć';
    if (query.includes('pdf')) return 'Znajdź PDF';
    if (query.includes('plik') || query.includes('dokument')) return 'Przeglądaj dokumenty';
    if (query.includes('.pl') || query.includes('.com')) return 'Przeglądaj stronę';
    if (query.includes('wyszukaj')) return 'Wyszukaj';
    return query.length > 20 ? `${query.slice(0, 20)}...` : query;
  };

  const getSmartIcon = (category: string): React.ReactNode => {
    switch (category) {
      case 'network': return <Wifi className="w-4 h-4" />;
      case 'camera': return <Camera className="w-4 h-4" />;
      case 'browse': return <Globe className="w-4 h-4" />;
      case 'search': return <Search className="w-4 h-4" />;
      case 'file': return <FileText className="w-4 h-4" />;
      default: return <Brain className="w-4 h-4" />;
    }
  };
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
      id: 'find-pdfs',
      title: 'Znajdź pliki PDF',
      description: 'Przeszukaj dokumenty PDF',
      icon: <FileText className="w-4 h-4" />,
      query: 'znajdź pliki pdf',
      category: 'search',
      priority: 9,
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
      id: 'search-documents',
      title: 'Przeszukaj dokumenty',
      description: 'Znajdź w Dokumentach i Pulpicie',
      icon: <FileText className="w-4 h-4" />,
      query: 'znajdź dokumenty',
      category: 'search',
      priority: 7,
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

  // Track suggestion usage for learning
  const trackSuggestionUsage = useCallback((query: string, category: string, success: boolean = true) => {
    setLearningData(prev => {
      const key = query.toLowerCase();
      const existing = prev[key] || { count: 0, category, success: 0 };
      const updated = {
        ...existing,
        count: existing.count + 1,
        success: existing.success + (success ? 1 : 0),
        category: category || existing.category
      };
      
      // Notify parent component for learning
      if (onLearn) {
        onLearn(query, category, success);
      }
      
      return { ...prev, [key]: updated };
    });
  }, [onLearn]);

  useEffect(() => {
    // Combine all suggestion types
    const contextual = generateContextualSuggestions();
    const smart = generateSmartSuggestions();
    const combinedSuggestions = [...baseSuggestions, ...contextual, ...smart];
    
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
      
      // If user was searching for files, suggest more file actions
      if (lastQuery.includes('pdf') || lastQuery.includes('plik') || lastQuery.includes('dokument')) {
        combinedSuggestions.push({
          id: 'more-files',
          title: 'Przeglądaj dokumenty',
          description: 'Otwórz znalezione pliki',
          icon: <FileText className="w-4 h-4" />,
          query: 'przeglądaj dokumenty pdf',
          category: 'file',
          priority: 8,
        });
      }
    }
    
    // Sort by priority, confidence, and usage
    const sortedSuggestions = combinedSuggestions
      .sort((a, b) => {
        // Priority first
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        // Then confidence for smart/contextual suggestions
        if (a.confidence && b.confidence) {
          return b.confidence - a.confidence;
        }
        if (a.confidence && !b.confidence) return -1;
        if (!a.confidence && b.confidence) return 1;
        // Then usage count
        return (b.usageCount || 0) - (a.usageCount || 0);
      })
      .slice(0, 8); // Limit to 8 suggestions
    
    setSuggestions(sortedSuggestions);
    setFilteredSuggestions(sortedSuggestions);
  }, [recentQueries, generateContextualSuggestions, generateSmartSuggestions]);

  const getCategoryColor = (category: ActionSuggestion['category']) => {
    switch (category) {
      case 'network': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'browse': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'camera': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'search': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'file': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'smart': return 'bg-pink-500/20 text-pink-400 border-pink-500/30';
      case 'contextual': return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getCategoryIcon = (category: ActionSuggestion['category']) => {
    switch (category) {
      case 'network': return <Wifi className="w-3 h-3" />;
      case 'browse': return <Globe className="w-3 h-3" />;
      case 'camera': return <Camera className="w-3 h-3" />;
      case 'search': return <Search className="w-3 h-3" />;
      case 'file': return <FileText className="w-3 h-3" />;
      case 'smart': return <Brain className="w-3 h-3" />;
      case 'contextual': return <Clock className="w-3 h-3" />;
      default: return <Lightbulb className="w-3 h-3" />;
    }
  };

  const handleSuggestionClick = (suggestion: ActionSuggestion) => {
    // Track usage for learning
    trackSuggestionUsage(suggestion.query, suggestion.category);
    onActionSelect(suggestion.query);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="mb-4 p-4 bg-gray-800/50 rounded-xl border border-gray-700">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-yellow-400" />
        <h3 className="text-sm font-medium text-gray-200">Inteligentne sugestie</h3>
        <div className="ml-auto flex items-center gap-1">
          {suggestions.some(s => s.isContextual) && (
            <div className="flex items-center gap-1 px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded text-xs">
              <Clock className="w-3 h-3" />
              Kontekstowe
            </div>
          )}
          {suggestions.some(s => s.category === 'smart') && (
            <div className="flex items-center gap-1 px-2 py-1 bg-pink-500/20 text-pink-400 rounded text-xs">
              <Brain className="w-3 h-3" />
              Uczące się
            </div>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {filteredSuggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            onClick={() => handleSuggestionClick(suggestion)}
            className={`
              relative p-3 rounded-lg border transition-all
              hover:bg-gray-700/50 hover:border-gray-600
              active:scale-95 text-left group
              ${getCategoryColor(suggestion.category)}
            `}
          >
            {/* Confidence indicator for smart/contextual suggestions */}
            {suggestion.confidence && (
              <div className="absolute top-1 right-1 opacity-60 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-1 text-xs">
                  <div className={`w-1 h-3 rounded-full ${
                    suggestion.confidence > 0.8 ? 'bg-green-400' :
                    suggestion.confidence > 0.6 ? 'bg-yellow-400' : 'bg-red-400'
                  }`} />
                  <span className="text-xs opacity-75">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                </div>
              </div>
            )}
            
            {/* Category badge */}
            <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {getCategoryIcon(suggestion.category)}
            </div>

            <div className="flex items-start gap-2 pt-2">
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
                {suggestion.reasoning && (
                  <div className="flex items-center gap-1 mt-1 text-xs opacity-60">
                    <ArrowRight className="w-2 h-2" />
                    <span className="truncate">{suggestion.reasoning}</span>
                  </div>
                )}
                {suggestion.usageCount && (
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-2 h-2 opacity-50" />
                    <span className="text-xs opacity-50">
                      {suggestion.usageCount}x
                    </span>
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      
      {recentQueries.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-3 h-3 text-gray-400" />
            <div className="text-xs text-gray-400">Ostatnie zapytania:</div>
          </div>
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

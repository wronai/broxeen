/**
 * Network History Selector Component
 * Allows users to select from recently used network addresses
 * Supports both click and voice selection
 */

import React, { useState, useEffect } from 'react';
import { Clock, Mic, MicOff, Plus, Search, Trash2 } from 'lucide-react';

export interface NetworkHistoryItem {
  id: string;
  address: string;
  name: string;
  scope: 'local' | 'global' | 'tor' | 'vpn' | 'custom';
  lastUsed: number;
  usageCount: number;
  description?: string;
}

interface NetworkHistorySelectorProps {
  onSelect: (item: NetworkHistoryItem) => void;
  onNewNetwork: () => void;
  onVoiceSelect?: (item: NetworkHistoryItem) => void;
  className?: string;
}

export const NetworkHistorySelector: React.FC<NetworkHistorySelectorProps> = ({
  onSelect,
  onNewNetwork,
  onVoiceSelect,
  className = ''
}) => {
  const [history, setHistory] = useState<NetworkHistoryItem[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [voiceCommand, setVoiceCommand] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredHistory, setFilteredHistory] = useState<NetworkHistoryItem[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem('broxeen_network_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
        setFilteredHistory(parsed);
      } catch (error) {
        console.error('Failed to load network history:', error);
      }
    }
  }, []);

  // Filter history based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredHistory(history);
    } else {
      const filtered = history.filter(item =>
        item.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredHistory(filtered);
    }
  }, [searchQuery, history]);

  // Save history to localStorage
  const saveHistory = (newHistory: NetworkHistoryItem[]) => {
    localStorage.setItem('broxeen_network_history', JSON.stringify(newHistory));
    setHistory(newHistory);
    setFilteredHistory(newHistory);
  };

  // Add new network to history
  const addToHistory = (address: string, name: string, scope: NetworkHistoryItem['scope']) => {
    const newItem: NetworkHistoryItem = {
      id: Date.now().toString(),
      address,
      name,
      scope,
      lastUsed: Date.now(),
      usageCount: 1,
      description: `${scope === 'local' ? 'Sieć lokalna' : scope === 'global' ? 'Internet globalny' : scope === 'tor' ? 'Sieć Tor' : scope === 'vpn' ? 'VPN' : 'Custom'} - ${address}`
    };

    // Remove existing entry with same address
    const existingIndex = history.findIndex(item => item.address === address);
    let newHistory = [...history];
    
    if (existingIndex >= 0) {
      // Update existing entry
      newHistory[existingIndex] = {
        ...newHistory[existingIndex],
        lastUsed: Date.now(),
        usageCount: newHistory[existingIndex].usageCount + 1
      };
    } else {
      // Add new entry
      newHistory.unshift(newItem);
    }

    // Keep only last 10 entries
    newHistory = newHistory.slice(0, 10);
    
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

  // Voice recognition
  const startVoiceRecognition = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Twoja przeglądarka nie obsługuje rozpoznawania mowy');
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = 'pl-PL';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceCommand('');
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      setVoiceCommand(transcript);

      // Parse voice command
      const parsed = parseVoiceCommand(transcript);
      if (parsed) {
        if (parsed.type === 'select') {
          const item = history.find(h => 
            h.address.toLowerCase().includes(parsed.address!) ||
            h.name.toLowerCase().includes(parsed.address!)
          );
          if (item) {
            onVoiceSelect?.(item);
            setIsListening(false);
          }
        } else if (parsed.type === 'new') {
          onNewNetwork();
          setIsListening(false);
        } else if (parsed.type === 'clear') {
          clearHistory();
          setIsListening(false);
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const stopVoiceRecognition = () => {
    setIsListening(false);
  };

  // Parse voice commands
  const parseVoiceCommand = (command: string) => {
    // Select by number: "wybierz jeden", "wybierz drugi"
    const numberMatch = command.match(/wybierz (\w+)/);
    if (numberMatch) {
      const numberWord = numberMatch[1];
      const numberMap: Record<string, number> = {
        'pierwszy': 1, 'jeden': 1,
        'drugi': 2, 'dwa': 2,
        'trzeci': 3, 'trzy': 3,
        'czwarty': 4, 'cztery': 4,
        'piąty': 5, 'pięć': 5,
        'szósty': 6, 'sześć': 6,
        'siódmy': 7, 'siedem': 7,
        'ósmy': 8, 'osiem': 8,
        'dziewiąty': 9, 'dziewięć': 9,
        'dziesiąty': 10, 'dziesięć': 10
      };
      const number = numberMap[numberWord];
      if (number && number <= filteredHistory.length) {
        return { type: 'select', index: number - 1 };
      }
    }

    // Select by address/name: "wybierz 192.168", "wybierz biuro"
    const addressMatch = command.match(/wybierz (.+)/);
    if (addressMatch) {
      return { type: 'select', address: addressMatch[1] };
    }

    // New network: "nowa sieć", "dodaj sieć"
    if (command.includes('nowa') || command.includes('dodaj')) {
      return { type: 'new' };
    }

    // Clear history: "wyczyść", "usuń historię"
    if (command.includes('wyczyść') || command.includes('usuń')) {
      return { type: 'clear' };
    }

    return null;
  };

  const getScopeIcon = (scope: NetworkHistoryItem['scope']) => {
    switch (scope) {
      case 'local': return '🏠';
      case 'global': return '🌐';
      case 'tor': return '🔒';
      case 'vpn': return '🏢';
      case 'custom': return '⚙️';
      default: return '📡';
    }
  };

  const formatLastUsed = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'przed chwilą';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min temu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} h temu`;
    return `${Math.floor(diff / 86400000)} dni temu`;
  };

  return (
    <div className={`bg-gray-800 rounded-lg p-6 ${className}`}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-200 mb-2">
          Ostatnio używane sieci
        </h3>
        <p className="text-gray-400 text-sm">
          Wybierz z historii lub dodaj nową sieć
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Szukaj adresu lub nazwy..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-700 text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-broxeen-500"
          />
        </div>
      </div>

      {/* Voice control */}
      <div className="mb-4 p-4 bg-gray-700 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <Mic className="w-4 h-4 text-broxeen-400" />
            <span className="text-sm font-medium text-gray-200">
              Sterowanie głosowe
            </span>
          </div>
          <button
            onClick={isListening ? stopVoiceRecognition : startVoiceRecognition}
            className={`p-2 rounded-lg transition-colors ${
              isListening 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
            }`}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
        
        {isListening && (
          <div className="text-sm text-gray-300">
            🎤 Słucham... Mów: "wybierz jeden", "wybierz 192.168", "nowa sieć"
          </div>
        )}
        
        {voiceCommand && !isListening && (
          <div className="text-sm text-gray-400">
            🗣️ Rozpoznano: "{voiceCommand}"
          </div>
        )}
      </div>

      {/* History list */}
      {filteredHistory.length > 0 ? (
        <div className="space-y-2 mb-4">
          {filteredHistory.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors cursor-pointer"
              onClick={() => onSelect(item)}
            >
              <div className="flex items-center space-x-3">
                <span className="text-lg">{getScopeIcon(item.scope)}</span>
                <div>
                  <div className="font-medium text-gray-200">
                    {item.name}
                  </div>
                  <div className="text-sm text-gray-400">
                    {item.address}
                  </div>
                  <div className="text-xs text-gray-500">
                    Używane {item.usageCount}x • {formatLastUsed(item.lastUsed)}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-400">
                  #{index + 1}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromHistory(item.id);
                  }}
                  className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                  title="Usuń z historii"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Brak historii sieci</p>
          <p className="text-sm mt-1">Dodaj pierwszą sieć, aby zobaczyć ją tutaj</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex space-x-3">
        <button
          onClick={onNewNetwork}
          className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-broxeen-600 text-white rounded-lg hover:bg-broxeen-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Nowa sieć</span>
        </button>
        
        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
          >
            Wyczyść
          </button>
        )}
      </div>

      {/* Voice commands help */}
      <div className="mt-4 p-3 bg-gray-700 rounded-lg">
        <h4 className="text-sm font-medium text-gray-200 mb-2">
          Komendy głosowe:
        </h4>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>• "wybierz [numer]" - wybierz z listy (np. "wybierz pierwszy")</li>
          <li>• "wybierz [adres]" - wybierz po adresie (np. "wybierz 192.168")</li>
          <li>• "nowa sieć" - dodaj nową sieć</li>
          <li>• "wyczyść" - usuń całą historię</li>
        </ul>
      </div>
    </div>
  );
};

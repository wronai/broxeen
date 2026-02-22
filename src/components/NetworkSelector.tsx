/**
 * Network Selector Component
 * Allows users to choose network scope for scanning
 */

import React, { useState } from 'react';
import { Globe, Wifi, Shield, Server, Settings } from 'lucide-react';

export type NetworkScope = 'local' | 'global' | 'tor' | 'vpn' | 'custom';

export interface NetworkConfig {
  scope: NetworkScope;
  name: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  requirements?: string[];
}

const networkConfigs: NetworkConfig[] = [
  {
    scope: 'local',
    name: 'Sieć lokalna',
    description: 'Skanuj urządzenia w Twojej sieci domowej/biurowej',
    icon: <Wifi className="w-5 h-5" />,
    features: [
      'Szybkie skanowanie (1-3 sekundy)',
      'Wykrywanie kamer IP, serwerów NAS, IoT',
      'Bezpieczne - tylko Twoja sieć',
      'Pełne informacje o urządzeniach'
    ]
  },
  {
    scope: 'global',
    name: 'Internet globalny',
    description: 'Przeszukuj publiczne urządzenia w sieci',
    icon: <Globe className="w-5 h-5" />,
    features: [
      'Szeroki zasięg skanowania',
      'Publiczne kamery i serwery',
      'Wymaga uprawnień administratora',
      'Ograniczone informacje o bezpieczeństwie'
    ],
    requirements: [
      'Uprawnienia administratora',
      'Stabilne połączenie internetowe',
      'Zgodność z regulaminem serwisu'
    ]
  },
  {
    scope: 'tor',
    name: 'Sieć Tor',
    description: 'Anonimowe skanowanie przez sieć Tor',
    icon: <Shield className="w-5 h-5" />,
    features: [
      'Pełna anonimowość',
      'Ominięcie geo-restrykcji',
      'Wolniejsze połączenia',
      'Ograniczony dostęp do usług'
    ],
    requirements: [
      'Zainstalowany Tor Browser',
      'Konfiguracja proxy',
      'Dodatkowy czas na połączenie'
    ]
  },
  {
    scope: 'vpn',
    name: 'Połączenie VPN',
    description: 'Skanuj przez zewnętrzną sieć VPN',
    icon: <Server className="w-5 h-5" />,
    features: [
      'Zdalny dostęp do sieci',
      'Szyfrowane połączenie',
      'Dostęp do zasobów firmowych',
      'Zależne od konfiguracji VPN'
    ],
    requirements: [
      'Aktywne połączenie VPN',
      'Konfiguracja klienta VPN',
      'Uprawnienia do zdalnej sieci'
    ]
  },
  {
    scope: 'custom',
    name: 'Konfiguracja niestandardowa',
    description: 'Zdefiniuj własne ustawienia sieciowe',
    icon: <Settings className="w-5 h-5" />,
    features: [
      'Pełna kontrola nad ustawieniami',
      'Niestandardowe zakresy IP',
      'Konfiguracja portów i protokołów',
      'Zaawansowane opcje skanowania'
    ],
    requirements: [
      'Znajomość konfiguracji sieci',
      'Uprawnienia administratora',
      'Rozumienie protokołów sieciowych'
    ]
  }
];

interface NetworkSelectorProps {
  onNetworkSelect: (config: NetworkConfig) => void;
  className?: string;
}

export const NetworkSelector: React.FC<NetworkSelectorProps> = ({
  onNetworkSelect,
  className = ''
}) => {
  const [selectedScope, setSelectedScope] = useState<NetworkScope>('local');
  const [showDetails, setShowDetails] = useState<NetworkScope | null>(null);

  const handleSelect = (config: NetworkConfig) => {
    setSelectedScope(config.scope);
    onNetworkSelect(config);
  };

  return (
    <div className={`bg-gray-800 rounded-lg p-6 ${className}`}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-200 mb-2">
          Wybierz zakres skanowania sieci
        </h3>
        <p className="text-gray-400 text-sm">
          Określ, którą sieć chcesz przeskanować w poszukiwaniu urządzeń
        </p>
      </div>

      <div className="grid gap-4">
        {networkConfigs.map((config) => (
          <div
            key={config.scope}
            className={`
              border rounded-lg p-4 cursor-pointer transition-all
              ${selectedScope === config.scope
                ? 'border-broxeen-500 bg-gray-700'
                : 'border-gray-600 hover:border-gray-500 hover:bg-gray-750'
              }
            `}
            onClick={() => handleSelect(config)}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className={`
                  p-2 rounded-lg
                  ${selectedScope === config.scope
                    ? 'bg-broxeen-600 text-white'
                    : 'bg-gray-600 text-gray-300'
                  }
                `}>
                  {config.icon}
                </div>
                <div>
                  <h4 className="font-medium text-gray-200">
                    {config.name}
                  </h4>
                  <p className="text-sm text-gray-400">
                    {config.description}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center">
                <div className={`
                  w-4 h-4 rounded-full border-2
                  ${selectedScope === config.scope
                    ? 'border-broxeen-500 bg-broxeen-500'
                    : 'border-gray-500'
                  }
                `}>
                  {selectedScope === config.scope && (
                    <div className="w-full h-full rounded-full bg-white scale-50" />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {config.features.slice(0, 3).map((feature, index) => (
                  <span
                    key={index}
                    className="text-xs px-2 py-1 bg-gray-600 text-gray-300 rounded"
                  >
                    {feature}
                  </span>
                ))}
                {config.features.length > 3 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDetails(showDetails === config.scope ? null : config.scope);
                    }}
                    className="text-xs px-2 py-1 bg-gray-600 text-gray-300 rounded hover:bg-gray-500"
                  >
                    +{config.features.length - 3} więcej
                  </button>
                )}
              </div>

              {showDetails === config.scope && (
                <div className="mt-3 p-3 bg-gray-800 rounded-lg">
                  <h5 className="text-sm font-medium text-gray-200 mb-2">
                    Wszystkie funkcje:
                  </h5>
                  <ul className="text-xs text-gray-400 space-y-1">
                    {config.features.map((feature, index) => (
                      <li key={index} className="flex items-center space-x-2">
                        <span className="text-broxeen-400">•</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  {config.requirements && config.requirements.length > 0 && (
                    <div className="mt-3">
                      <h5 className="text-sm font-medium text-gray-200 mb-2">
                        Wymagania:
                      </h5>
                      <ul className="text-xs text-gray-400 space-y-1">
                        {config.requirements.map((req, index) => (
                          <li key={index} className="flex items-center space-x-2">
                            <span className="text-yellow-400">⚠</span>
                            <span>{req}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-gray-700 rounded-lg">
        <div className="flex items-center space-x-2 mb-2">
          <Shield className="w-4 h-4 text-broxeen-400" />
          <span className="text-sm font-medium text-gray-200">
            Bezpieczeństwo i prywatność
          </span>
        </div>
        <p className="text-xs text-gray-400">
          Broxeen szanuje Twoją prywatność. Skanowanie sieci lokalnej jest w pełni bezpieczne 
          i nie wysyła danych poza Twoją sieć. Inne opcje mogą wymagać dodatkowych uprawnień 
          i konfiguracji.
        </p>
      </div>
    </div>
  );
};

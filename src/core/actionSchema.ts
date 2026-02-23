/**
 * Action Schema — Extracts structured action descriptions from all registered
 * plugins/intents. Used as LLM context for fallback intent routing.
 *
 * Each ActionSchema describes a user-facing action with:
 * - domain grouping (camera, network, system, browse, etc.)
 * - intent id matching the IntentRouter pattern key
 * - human-readable label + description
 * - example queries the user can type
 * - an executeQuery that the system can run directly
 */

import type { ConfigAction } from '../components/ChatConfigPrompt';

// ── Types ────────────────────────────────────────────────────

export type ActionDomain =
  | 'camera'
  | 'network'
  | 'system'
  | 'browse'
  | 'monitor'
  | 'iot'
  | 'bridge'
  | 'marketplace'
  | 'chat'
  | 'file'
  | 'email';

export interface ActionSchema {
  /** Intent id, e.g. "camera:snapshot" */
  readonly intent: string;
  /** Domain group */
  readonly domain: ActionDomain;
  /** Short human label */
  readonly label: string;
  /** One-line description (shown to user) */
  readonly description: string;
  /** Icon emoji */
  readonly icon: string;
  /** Keywords for matching (lowercase) */
  readonly keywords: readonly string[];
  /** Example user queries */
  readonly examples: readonly string[];
  /** Query to execute when user clicks the action button */
  readonly executeQuery: string;
}

// ── Built-in Action Schemas ──────────────────────────────────

export const ACTION_SCHEMAS: readonly ActionSchema[] = [
  // ── Camera domain ────────────────────────────────
  {
    intent: 'camera:describe',
    domain: 'camera',
    label: 'Opisz obraz z kamery',
    description: 'AI opisze co widzi na wybranej kamerze',
    icon: '📷',
    keywords: ['kamera', 'kamer', 'kamery', 'widać', 'obraz', 'widzi', 'dzieje', 'podgląd', 'camera', 'describe', 'see'],
    examples: ['co widać na kamerze', 'co się dzieje na kamerze wejściowej'],
    executeQuery: 'co widać na kamerze',
  },
  {
    intent: 'camera:snapshot',
    domain: 'camera',
    label: 'Zrób zdjęcie z kamery',
    description: 'Pobierz aktualną klatkę z kamery IP',
    icon: '📸',
    keywords: ['zdjęcie', 'snapshot', 'klatka', 'zrzut', 'capture', 'foto', 'kamera', 'kamer', 'kamery'],
    examples: ['zrób zdjęcie z kamery', 'snapshot kamery wejściowej'],
    executeQuery: 'zrób zdjęcie z kamery',
  },
  {
    intent: 'camera:health',
    domain: 'camera',
    label: 'Status kamer',
    description: 'Sprawdź czy kamery są online i działają poprawnie',
    icon: '🩺',
    keywords: ['status', 'stan', 'zdrowie', 'health', 'działa', 'online', 'sprawdź', 'kamera', 'kamer', 'kamery'],
    examples: ['status kamer', 'sprawdź kamerę', 'czy kamery działają'],
    executeQuery: 'sprawdź status kamer',
  },
  {
    intent: 'camera:ptz',
    domain: 'camera',
    label: 'Steruj kamerą PTZ',
    description: 'Obróć, przesuń lub przybliż kamerę PTZ',
    icon: '🎮',
    keywords: ['obróć', 'przesuń', 'zoom', 'ptz', 'lewo', 'prawo', 'góra', 'dół', 'steruj', 'kamera', 'kamer', 'kamery'],
    examples: ['obróć kamerę w lewo', 'zoom kamery', 'ptz'],
    executeQuery: 'ptz',
  },
  {
    intent: 'camera:live',
    domain: 'camera',
    label: 'Podgląd live kamery',
    description: 'Uruchom podgląd na żywo z kamery RTSP',
    icon: '🎥',
    keywords: ['live', 'rtsp', 'podgląd', 'na żywo', 'stream', 'preview', 'kamera', 'kamer', 'kamery'],
    examples: ['pokaż live kamery', 'live preview', 'rtsp://...'],
    executeQuery: 'pokaż live kamery',
  },
  {
    intent: 'camera:onvif',
    domain: 'camera',
    label: 'Wykryj kamery ONVIF',
    description: 'Automatycznie znajdź kamery IP z obsługą ONVIF',
    icon: '🔎',
    keywords: ['onvif', 'odkryj', 'wykryj', 'kamery ip', 'discover', 'kamera', 'kamer', 'kamery'],
    examples: ['onvif', 'wykryj kamery', 'kamery ip'],
    executeQuery: 'onvif',
  },

  // ── Network domain ───────────────────────────────
  {
    intent: 'network:scan',
    domain: 'network',
    label: 'Skanuj sieć',
    description: 'Znajdź urządzenia w sieci lokalnej (kamery, komputery, IoT)',
    icon: '🔍',
    keywords: ['skanuj', 'sieć', 'odkryj', 'znajdź', 'urządzenia', 'scan', 'network', 'kamery w sieci'],
    examples: ['skanuj sieć', 'znajdź kamery w sieci', 'pokaż kamery'],
    executeQuery: 'skanuj sieć',
  },
  {
    intent: 'network:ping',
    domain: 'network',
    label: 'Ping hosta',
    description: 'Sprawdź dostępność urządzenia w sieci',
    icon: '📡',
    keywords: ['ping', 'sprawdź', 'host', 'dostępność', 'odpowiada'],
    examples: ['ping 192.168.1.1', 'sprawdź host'],
    executeQuery: 'ping ',
  },
  {
    intent: 'network:port-scan',
    domain: 'network',
    label: 'Skanuj porty',
    description: 'Sprawdź otwarte porty na urządzeniu',
    icon: '🔓',
    keywords: ['porty', 'port', 'otwarte', 'scan port'],
    examples: ['skanuj porty 192.168.1.1', 'otwarte porty'],
    executeQuery: 'skanuj porty ',
  },
  {
    intent: 'network:arp',
    domain: 'network',
    label: 'Tablica ARP',
    description: 'Pokaż adresy MAC urządzeń w sieci',
    icon: '🏷️',
    keywords: ['arp', 'mac', 'tablica', 'adresy', 'kto w sieci'],
    examples: ['tablica arp', 'kto jest w sieci', 'adresy mac'],
    executeQuery: 'tablica arp',
  },
  {
    intent: 'network:wol',
    domain: 'network',
    label: 'Wake-on-LAN',
    description: 'Zdalnie włącz komputer przez sieć',
    icon: '⏰',
    keywords: ['wake', 'wol', 'obudź', 'włącz', 'komputer'],
    examples: ['wake on lan', 'obudź urządzenie'],
    executeQuery: 'wake on lan ',
  },
  {
    intent: 'network:mdns',
    domain: 'network',
    label: 'Usługi mDNS/Bonjour',
    description: 'Odkryj usługi lokalne (drukarki, smart home, etc.)',
    icon: '📋',
    keywords: ['mdns', 'bonjour', 'zeroconf', 'usługi', 'lokalne'],
    examples: ['mdns', 'odkryj usługi', 'usługi lokalne'],
    executeQuery: 'mdns',
  },

  // ── System domain ────────────────────────────────
  {
    intent: 'disk:info',
    domain: 'system',
    label: 'Informacje o dyskach',
    description: 'Pokaż wolne miejsce i partycje',
    icon: '💾',
    keywords: ['dysk', 'disk', 'partycja', 'miejsce', 'wolne', 'storage', 'df'],
    examples: ['pokaż dyski', 'ile wolnego miejsca', 'disk info'],
    executeQuery: 'pokaż dyski',
  },
  {
    intent: 'ssh:execute',
    domain: 'system',
    label: 'Wykonaj polecenie SSH',
    description: 'Uruchom zdalną komendę przez SSH',
    icon: '🖥️',
    keywords: ['ssh', 'zdalne', 'wykonaj', 'polecenie', 'remote'],
    examples: ['ssh 192.168.1.1 uptime', 'połącz ssh'],
    executeQuery: 'ssh ',
  },
  {
    intent: 'ssh:hosts',
    domain: 'system',
    label: 'Hosty SSH',
    description: 'Pokaż znane hosty SSH',
    icon: '📡',
    keywords: ['ssh', 'hosty', 'known', 'hosts'],
    examples: ['ssh hosty', 'znane hosty'],
    executeQuery: 'ssh hosty',
  },
  {
    intent: 'system:processes',
    domain: 'system',
    label: 'Procesy systemowe',
    description: 'Pokaż uruchomione procesy',
    icon: '⚙️',
    keywords: ['procesy', 'processes', 'uruchomione', 'running'],
    examples: ['procesy', 'processes'],
    executeQuery: 'procesy',
  },

  // ── File domain ───────────────────────────────────
  {
    intent: 'file:search',
    domain: 'file',
    label: 'Wyszukaj pliki',
    description: 'Znajdź pliki na dysku lokalnym po nazwie lub rozszerzeniu',
    icon: '📁',
    keywords: ['plik', 'pliki', 'znajdź', 'szukaj', 'wyszukaj', 'dokument', 'folder', 'katalog', 'file', 'search'],
    examples: ['znajdź pliki pdf', 'wyszukaj dokumenty', 'pliki w folderze domowym'],
    executeQuery: 'znajdź pliki ',
  },
  {
    intent: 'file:list',
    domain: 'file',
    label: 'Lista plików',
    description: 'Pokaż zawartość folderu (pliki i katalogi)',
    icon: '📂',
    keywords: ['lista', 'listuj', 'pokaż', 'wylistuj', 'zawartość', 'folderu', 'katalogu', 'usera', 'użytkownika', 'domowy', 'home', 'ls'],
    examples: ['lista plików w folderze usera', 'pokaż pliki na pulpicie', 'co jest w katalogu domowym'],
    executeQuery: 'lista plików w folderze usera',
  },
  {
    intent: 'file:read',
    domain: 'file',
    label: 'Przeczytaj plik',
    description: 'Odczytaj zawartość pliku tekstowego',
    icon: '📄',
    keywords: ['przeczytaj', 'odczytaj', 'otwórz', 'zawartość', 'plik', 'treść'],
    examples: ['przeczytaj plik /home/user/notes.txt', 'co jest w pliku config.json'],
    executeQuery: 'przeczytaj plik ',
  },

  // ── Email domain ──────────────────────────────────
  {
    intent: 'email:check',
    domain: 'email',
    label: 'Sprawdź pocztę',
    description: 'Odczytaj nowe wiadomości email ze skrzynki',
    icon: '📬',
    keywords: ['email', 'poczta', 'skrzynka', 'inbox', 'wiadomości', 'mail', 'sprawdź'],
    examples: ['sprawdź skrzynkę email', 'nowe wiadomości', 'inbox'],
    executeQuery: 'sprawdź skrzynkę email',
  },
  {
    intent: 'email:send',
    domain: 'email',
    label: 'Wyślij email',
    description: 'Wyślij wiadomość email lub plik jako załącznik',
    icon: '📧',
    keywords: ['wyślij', 'email', 'mail', 'załącznik', 'send', 'smtp'],
    examples: ['wyślij email', 'wyślij plik na email'],
    executeQuery: 'wyślij email ',
  },
  {
    intent: 'email:config',
    domain: 'email',
    label: 'Konfiguracja email',
    description: 'Skonfiguruj połączenie ze skrzynką email (IMAP/SMTP)',
    icon: '⚙️',
    keywords: ['konfiguruj', 'email', 'imap', 'smtp', 'skonfiguruj', 'poczta'],
    examples: ['konfiguruj email', 'ustaw pocztę'],
    executeQuery: 'konfiguruj email',
  },

  // ── Monitor domain ───────────────────────────────
  {
    intent: 'monitor:start',
    domain: 'monitor',
    label: 'Monitoruj zmiany',
    description: 'Śledź zmiany na kamerze lub urządzeniu',
    icon: '👁️',
    keywords: ['monitoruj', 'obserwuj', 'śledź', 'monitor', 'zmiany', 'logi'],
    examples: ['monitoruj kamerę', 'obserwuj zmiany', 'logi monitora'],
    executeQuery: 'monitoruj ',
  },

  // ── Browse domain ────────────────────────────────
  {
    intent: 'browse:url',
    domain: 'browse',
    label: 'Przeglądaj stronę',
    description: 'Otwórz i przeczytaj zawartość strony internetowej',
    icon: '🌍',
    keywords: ['http', 'https', 'www', 'strona', 'stronę', 'przeglądaj', 'browse', 'url'],
    examples: ['onet.pl', 'https://example.com', 'przeglądaj stronę'],
    executeQuery: 'przeglądaj ',
  },
  {
    intent: 'search:web',
    domain: 'browse',
    label: 'Szukaj w internecie',
    description: 'Wyszukaj informacje w internecie',
    icon: '🔎',
    keywords: ['wyszukaj', 'szukaj', 'znajdź', 'search', 'google'],
    examples: ['wyszukaj informacje o...', 'szukaj w google'],
    executeQuery: 'wyszukaj ',
  },

  // ── IoT domain ───────────────────────────────────
  {
    intent: 'iot:read',
    domain: 'iot',
    label: 'Odczyt czujników',
    description: 'Odczytaj dane z czujników IoT (temperatura, wilgotność)',
    icon: '🌡️',
    keywords: ['temperatura', 'wilgotność', 'czujnik', 'sensor', 'iot'],
    examples: ['jaka temperatura', 'odczytaj czujnik'],
    executeQuery: 'jaka temperatura',
  },

  // ── Protocol Bridge domain ───────────────────────
  {
    intent: 'bridge:read',
    domain: 'bridge',
    label: 'Bridge — odczytaj',
    description: 'Odczytaj dane z MQTT, REST, WebSocket, SSE lub GraphQL',
    icon: '🔗',
    keywords: ['bridge', 'mqtt', 'rest', 'api', 'websocket', 'sse', 'graphql'],
    examples: ['bridge mqtt', 'odczytaj rest api'],
    executeQuery: 'bridge mqtt ',
  },
  {
    intent: 'bridge:send',
    domain: 'bridge',
    label: 'Bridge — wyślij',
    description: 'Wyślij dane przez MQTT, REST, WebSocket lub GraphQL',
    icon: '📤',
    keywords: ['wyślij', 'publish', 'send', 'mqtt', 'rest', 'post'],
    examples: ['wyślij mqtt', 'publish rest'],
    executeQuery: 'wyślij mqtt ',
  },

  // ── Marketplace domain ───────────────────────────
  {
    intent: 'marketplace:browse',
    domain: 'marketplace',
    label: 'Marketplace pluginów',
    description: 'Przeglądaj, instaluj i zarządzaj pluginami',
    icon: '🛒',
    keywords: ['marketplace', 'plugin', 'zainstaluj', 'install', 'sklep'],
    examples: ['marketplace', 'zainstaluj plugin'],
    executeQuery: 'marketplace',
  },
] as const;

// ── Query helpers ────────────────────────────────────────────

/** Get all schemas for a specific domain */
export function getSchemasByDomain(domain: ActionDomain): ActionSchema[] {
  return ACTION_SCHEMAS.filter(s => s.domain === domain);
}

/** Get all unique domains */
export function getAllDomains(): ActionDomain[] {
  return [...new Set(ACTION_SCHEMAS.map(s => s.domain))];
}

/** Score how well a user query matches a schema (0..1) */
export function scoreMatch(query: string, schema: ActionSchema): number {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let hits = 0;
  for (const kw of schema.keywords) {
    if (lower.includes(kw)) hits++;
  }

  // Bonus for example match
  for (const ex of schema.examples) {
    if (lower.includes(ex.toLowerCase())) hits += 2;
  }

  const maxPossible = schema.keywords.length + schema.examples.length * 2;
  return maxPossible > 0 ? Math.min(1, hits / Math.max(3, maxPossible * 0.3)) : 0;
}

/** Find top-N matching schemas for a user query, sorted by relevance */
export function findMatchingSchemas(query: string, limit = 5): Array<ActionSchema & { score: number }> {
  return ACTION_SCHEMAS
    .map(schema => ({ ...schema, score: scoreMatch(query, schema) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Find schemas by domain relevance to query keywords */
export function findDomainSchemas(query: string): ActionSchema[] {
  const lower = query.toLowerCase();
  const domainHints: Record<string, ActionDomain> = {
    'kamer': 'camera',
    'camera': 'camera',
    'zdjęci': 'camera',
    'snapshot': 'camera',
    'rtsp': 'camera',
    'live': 'camera',
    'onvif': 'camera',
    'sieć': 'network',
    'siec': 'network',
    'network': 'network',
    'ping': 'network',
    'port': 'network',
    'arp': 'network',
    'mac': 'network',
    'wol': 'network',
    'mdns': 'network',
    'scan': 'network',
    'dysk': 'system',
    'ssh': 'system',
    'proces': 'system',
    'monitor': 'monitor',
    'obserwuj': 'monitor',
    'śledź': 'monitor',
    'stron': 'browse',
    'http': 'browse',
    'www': 'browse',
    'wyszukaj': 'browse',
    'szukaj': 'browse',
    'mqtt': 'bridge',
    'bridge': 'bridge',
    'rest': 'bridge',
    'websocket': 'bridge',
    'czujnik': 'iot',
    'sensor': 'iot',
    'temperatur': 'iot',
    'marketplace': 'marketplace',
    'plugin': 'marketplace',
    'plik': 'file',
    'pliki': 'file',
    'folder': 'file',
    'katalog': 'file',
    'dokument': 'file',
    'file': 'file',
    'lista plik': 'file',
    'usera': 'file',
    'email': 'email',
    'mail': 'email',
    'poczta': 'email',
    'skrzynk': 'email',
    'inbox': 'email',
    'smtp': 'email',
    'imap': 'email',
  };

  const matchedDomains = new Set<ActionDomain>();
  for (const [hint, domain] of Object.entries(domainHints)) {
    if (lower.includes(hint)) {
      matchedDomains.add(domain);
    }
  }

  if (matchedDomains.size === 0) return [];
  return ACTION_SCHEMAS.filter(s => matchedDomains.has(s.domain));
}

/** Convert ActionSchema[] to ConfigAction[] for ChatConfigPrompt rendering */
export function schemasToConfigActions(schemas: ActionSchema[]): ConfigAction[] {
  return schemas.map(schema => ({
    id: `action-${schema.intent}`,
    label: schema.label,
    description: schema.description,
    icon: schema.icon,
    type: 'execute' as const,
    executeQuery: schema.executeQuery,
    variant: 'primary' as const,
  }));
}

/** Build a compact text summary of schemas for LLM context */
export function schemasToLlmContext(schemas: ActionSchema[]): string {
  const byDomain = new Map<ActionDomain, ActionSchema[]>();
  for (const s of schemas) {
    const list = byDomain.get(s.domain) || [];
    list.push(s);
    byDomain.set(s.domain, list);
  }

  const domainLabels: Record<ActionDomain, string> = {
    camera: 'Kamery',
    network: 'Sieć',
    system: 'System',
    browse: 'Przeglądanie',
    monitor: 'Monitoring',
    iot: 'IoT / Czujniki',
    bridge: 'Protocol Bridge',
    marketplace: 'Marketplace',
    chat: 'Rozmowa',
    file: 'Pliki',
    email: 'Email',
  };

  const lines: string[] = [];
  for (const [domain, actions] of byDomain) {
    lines.push(`## ${domainLabels[domain] || domain}`);
    for (const a of actions) {
      lines.push(`- ${a.icon} **${a.label}** (intent: ${a.intent}): ${a.description}`);
      lines.push(`  Przykłady: ${a.examples.join(', ')}`);
    }
  }
  return lines.join('\n');
}

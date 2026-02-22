/**
 * AppConfig — Centralized configuration for all Broxeen services and plugins.
 * Replaces all hardcoded values with a single source of truth.
 * Values are persisted to localStorage and auto-discovered at startup.
 */

// ── LLM / AI Configuration ─────────────────────────────────

export interface LlmAppConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  httpReferer: string;
  appTitle: string;
}

export interface SttAppConfig {
  model: string;
  language: string;
  maxTokens: number;
  temperature: number;
}

// ── Network Configuration ───────────────────────────────────

export interface NetworkScanConfig {
  commonCameraIpOffsets: number[];
  commonDeviceIpOffsets: number[];
  cameraPorts: number[];
  generalPorts: number[];
  probeTimeoutMs: number;
  gatewayProbeTimeoutMs: number;
  batchSize: number;
  defaultSubnet: string;
  commonSubnets: string[];
}

export interface ServiceProbeConfig {
  ports: {
    http: number[];
    rtsp: number[];
    mqtt: number[];
    ssh: number[];
    api: number[];
  };
  timeoutMs: number;
  maxConcurrent: number;
  retryAttempts: number;
}

// ── SSH Configuration ───────────────────────────────────────

export interface SshAppConfig {
  defaultTimeoutSec: number;
  defaultPort: number;
  defaultUser?: string;
}

// ── Locale / UI Configuration ───────────────────────────────

export interface LocaleConfig {
  language: string;
  locale: string;
}

// ── Camera Configuration ────────────────────────────────────

export interface CameraDefaults {
  rtspPort: number;
  httpPort: number;
  defaultStreamPath: string;
}

// ── Full App Configuration ──────────────────────────────────

export interface AppConfig {
  llm: LlmAppConfig;
  stt: SttAppConfig;
  network: NetworkScanConfig;
  serviceProbe: ServiceProbeConfig;
  ssh: SshAppConfig;
  locale: LocaleConfig;
  camera: CameraDefaults;
}

// ── Defaults ────────────────────────────────────────────────

export const DEFAULT_CONFIG: AppConfig = {
  llm: {
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: '',
    model: 'google/gemini-3-flash-preview',
    maxTokens: 2048,
    temperature: 0.7,
    httpReferer: 'https://broxeen.local',
    appTitle: 'broxeen',
  },
  stt: {
    model: 'google/gemini-2.0-flash',
    language: 'pl',
    maxTokens: 256,
    temperature: 0.0,
  },
  network: {
    commonCameraIpOffsets: [100, 101, 102, 103, 108, 110, 150, 200, 201, 250],
    commonDeviceIpOffsets: [2, 10, 20, 30, 50, 60, 70, 80, 90, 120, 130, 140, 160, 170, 180, 190, 210, 220, 240],
    cameraPorts: [554, 8554, 80, 8080],
    generalPorts: [80, 443, 8080],
    probeTimeoutMs: 1500,
    gatewayProbeTimeoutMs: 1200,
    batchSize: 10,
    defaultSubnet: '192.168.1',
    commonSubnets: [
      '192.168.188', '192.168.0', '192.168.1', '192.168.2',
      '192.168.10', '192.168.100',
      '10.0.0', '10.0.1', '10.1.1', '10.10.10',
      '172.16.0', '172.16.1', '172.31.0',
    ],
  },
  serviceProbe: {
    ports: {
      http: [80, 8080, 8000, 3000, 5000],
      rtsp: [554, 8554],
      mqtt: [1883, 9001],
      ssh: [22, 2222],
      api: [8001, 3001, 5001, 8081],
    },
    timeoutMs: 3000,
    maxConcurrent: 5,
    retryAttempts: 2,
  },
  ssh: {
    defaultTimeoutSec: 15,
    defaultPort: 22,
  },
  locale: {
    language: 'pl',
    locale: 'pl-PL',
  },
  camera: {
    rtspPort: 554,
    httpPort: 80,
    defaultStreamPath: '/stream',
  },
};

// ── Config metadata for interactive UI ──────────────────────

export interface ConfigFieldMeta {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'string[]' | 'number[]' | 'password';
  category: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export const CONFIG_FIELD_META: ConfigFieldMeta[] = [
  // LLM
  {
    key: 'llm.apiKey',
    label: 'Klucz API (OpenRouter)',
    description: 'Klucz API do OpenRouter dla LLM i STT',
    type: 'password',
    category: 'llm',
    required: true,
    placeholder: 'sk-or-v1-...',
  },
  {
    key: 'llm.model',
    label: 'Model LLM',
    description: 'Model AI do rozmów i analizy',
    type: 'string',
    category: 'llm',
    options: [
      { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (szybki)' },
      { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4o', label: 'GPT-4o' },
      { value: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B' },
    ],
  },
  {
    key: 'llm.apiUrl',
    label: 'URL API LLM',
    description: 'Endpoint API (domyślnie OpenRouter)',
    type: 'string',
    category: 'llm',
    placeholder: 'https://openrouter.ai/api/v1/chat/completions',
  },
  {
    key: 'llm.maxTokens',
    label: 'Max tokenów',
    description: 'Maksymalna liczba tokenów w odpowiedzi',
    type: 'number',
    category: 'llm',
  },
  {
    key: 'llm.temperature',
    label: 'Temperatura',
    description: 'Kreatywność modelu (0.0–1.0)',
    type: 'number',
    category: 'llm',
  },
  // STT
  {
    key: 'stt.model',
    label: 'Model STT',
    description: 'Model do transkrypcji mowy',
    type: 'string',
    category: 'stt',
    options: [
      { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'openai/whisper-large-v3', label: 'Whisper Large v3' },
    ],
  },
  {
    key: 'stt.language',
    label: 'Język STT',
    description: 'Język transkrypcji mowy',
    type: 'string',
    category: 'stt',
    options: [
      { value: 'pl', label: 'Polski' },
      { value: 'en', label: 'English' },
      { value: 'de', label: 'Deutsch' },
      { value: 'uk', label: 'Українська' },
    ],
  },
  // Network
  {
    key: 'network.defaultSubnet',
    label: 'Domyślna podsieć',
    description: 'Podsieć do skanowania (np. 192.168.1)',
    type: 'string',
    category: 'network',
    placeholder: '192.168.1',
  },
  {
    key: 'network.cameraPorts',
    label: 'Porty kamer',
    description: 'Porty do skanowania kamer (rozdzielone przecinkami)',
    type: 'number[]',
    category: 'network',
  },
  {
    key: 'network.generalPorts',
    label: 'Porty ogólne',
    description: 'Porty do skanowania sieci (rozdzielone przecinkami)',
    type: 'number[]',
    category: 'network',
  },
  {
    key: 'network.probeTimeoutMs',
    label: 'Timeout skanowania (ms)',
    description: 'Timeout w milisekundach dla skanowania portów',
    type: 'number',
    category: 'network',
  },
  {
    key: 'network.batchSize',
    label: 'Rozmiar paczki',
    description: 'Ile adresów IP skanować jednocześnie',
    type: 'number',
    category: 'network',
  },
  // SSH
  {
    key: 'ssh.defaultTimeoutSec',
    label: 'SSH timeout (s)',
    description: 'Timeout połączenia SSH w sekundach',
    type: 'number',
    category: 'ssh',
  },
  {
    key: 'ssh.defaultPort',
    label: 'Domyślny port SSH',
    description: 'Port SSH (domyślnie 22)',
    type: 'number',
    category: 'ssh',
  },
  {
    key: 'ssh.defaultUser',
    label: 'Domyślny użytkownik SSH',
    description: 'Użytkownik SSH (opcjonalny)',
    type: 'string',
    category: 'ssh',
    placeholder: 'root',
  },
  // Camera
  {
    key: 'camera.rtspPort',
    label: 'Port RTSP kamery',
    description: 'Domyślny port RTSP',
    type: 'number',
    category: 'camera',
  },
  {
    key: 'camera.defaultStreamPath',
    label: 'Ścieżka strumienia',
    description: 'Domyślna ścieżka RTSP',
    type: 'string',
    category: 'camera',
    placeholder: '/stream',
  },
  // Locale
  {
    key: 'locale.language',
    label: 'Język interfejsu',
    description: 'Język aplikacji',
    type: 'string',
    category: 'locale',
    options: [
      { value: 'pl', label: 'Polski' },
      { value: 'en', label: 'English' },
    ],
  },
];

/** Group config fields by category */
export function getConfigFieldsByCategory(): Map<string, ConfigFieldMeta[]> {
  const map = new Map<string, ConfigFieldMeta[]>();
  for (const field of CONFIG_FIELD_META) {
    const list = map.get(field.category) || [];
    list.push(field);
    map.set(field.category, list);
  }
  return map;
}

/** Category labels for UI */
export const CONFIG_CATEGORIES: Record<string, { label: string; icon: string; description: string }> = {
  llm: { label: 'AI / LLM', icon: '🧠', description: 'Konfiguracja modeli AI' },
  stt: { label: 'Mowa (STT)', icon: '🎙️', description: 'Rozpoznawanie mowy' },
  network: { label: 'Sieć', icon: '🌐', description: 'Skanowanie i odkrywanie sieci' },
  ssh: { label: 'SSH', icon: '📡', description: 'Zdalne połączenia SSH' },
  camera: { label: 'Kamery', icon: '📷', description: 'Kamery IP / RTSP' },
  locale: { label: 'Język', icon: '🌍', description: 'Ustawienia regionalne' },
};

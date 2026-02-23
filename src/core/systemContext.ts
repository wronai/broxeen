/**
 * SystemContext — Detects and exposes runtime environment information.
 *
 * Provides OS, user, home directory, runtime type (Tauri/browser),
 * and available capabilities so that LLM prompts and intent routing
 * can generate context-aware, actionable responses instead of
 * generic cross-platform tutorials.
 */

import { isTauriRuntime } from '../lib/runtime';
import { logger } from '../lib/logger';

const log = logger.scope('system-context');

// ── Types ────────────────────────────────────────────────────

export type OsPlatform = 'linux' | 'macos' | 'windows' | 'unknown';
export type RuntimeType = 'tauri' | 'browser';

export interface SystemContext {
  /** Operating system */
  os: OsPlatform;
  /** Runtime environment */
  runtime: RuntimeType;
  /** Current username (best effort) */
  user: string;
  /** Home directory path */
  homeDir: string;
  /** Hostname (if available) */
  hostname: string;
  /** Shell (bash, zsh, powershell, etc.) */
  shell: string;
  /** Available system capabilities */
  capabilities: string[];
}

// ── Detection ────────────────────────────────────────────────

function detectOs(): OsPlatform {
  if (typeof navigator === 'undefined') return 'linux'; // SSR/test → assume Linux
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  if (platform.includes('linux') || ua.includes('linux')) return 'linux';
  if (platform.includes('mac') || ua.includes('mac')) return 'macos';
  if (platform.includes('win') || ua.includes('win')) return 'windows';
  return 'linux'; // Tauri on Linux is the primary target
}

function detectUser(): string {
  // In Tauri, we can try environment variables via Rust backend.
  // For now, best-effort from common sources.
  if (typeof process !== 'undefined' && process.env) {
    return process.env.USER || process.env.USERNAME || 'user';
  }
  return 'user';
}

function detectHomeDir(os: OsPlatform, user: string): string {
  if (typeof process !== 'undefined' && process.env?.HOME) {
    return process.env.HOME;
  }
  switch (os) {
    case 'linux': return `/home/${user}`;
    case 'macos': return `/Users/${user}`;
    case 'windows': return `C:\\Users\\${user}`;
    default: return `/home/${user}`;
  }
}

function detectShell(os: OsPlatform): string {
  if (typeof process !== 'undefined' && process.env?.SHELL) {
    return process.env.SHELL.split('/').pop() || 'bash';
  }
  switch (os) {
    case 'linux': return 'bash';
    case 'macos': return 'zsh';
    case 'windows': return 'powershell';
    default: return 'bash';
  }
}

function detectCapabilities(runtime: RuntimeType): string[] {
  const caps: string[] = [];

  // Core capabilities always present
  caps.push('chat', 'browse', 'network_scan', 'camera_discovery');

  if (runtime === 'tauri') {
    caps.push(
      'file_search',
      'file_read',
      'ssh_execute',
      'system_info',
      'disk_info',
      'rtsp_capture',
      'tts_local',
      'database_sqlite',
      'monitor_changes',
    );
  }

  return caps;
}

// ── Singleton ────────────────────────────────────────────────

let _cached: SystemContext | null = null;

/**
 * Get the current system context (cached after first call).
 */
export function getSystemContext(): SystemContext {
  if (_cached) return _cached;

  const os = detectOs();
  const runtime: RuntimeType = isTauriRuntime() ? 'tauri' : 'browser';
  const user = detectUser();
  const homeDir = detectHomeDir(os, user);
  const shell = detectShell(os);
  const hostname = typeof location !== 'undefined' ? location.hostname : 'localhost';
  const capabilities = detectCapabilities(runtime);

  _cached = { os, runtime, user, homeDir, hostname, shell, capabilities };

  log.info('System context detected', _cached);
  return _cached;
}

/**
 * Update system context with info from Tauri backend (call after Tauri init).
 * This allows the Rust backend to provide accurate OS/user/home data.
 */
export function updateSystemContext(patch: Partial<SystemContext>): void {
  const ctx = getSystemContext();
  Object.assign(ctx, patch);
  log.info('System context updated', patch);
}

/**
 * Reset cached context (for testing).
 */
export function resetSystemContext(): void {
  _cached = null;
}

// ── Prompt builder ───────────────────────────────────────────

/**
 * Build a context block for inclusion in LLM system prompts.
 * This tells the LLM what system it's running on and what it can do.
 */
export function buildSystemContextPrompt(): string {
  const ctx = getSystemContext();

  const osLabels: Record<OsPlatform, string> = {
    linux: 'Linux',
    macos: 'macOS',
    windows: 'Windows',
    unknown: 'Unknown OS',
  };

  const capDescriptions: Record<string, string> = {
    chat: 'rozmowa z użytkownikiem',
    browse: 'przeglądanie stron internetowych',
    network_scan: 'skanowanie sieci lokalnej (urządzenia, kamery, porty)',
    camera_discovery: 'odkrywanie i podgląd kamer IP (RTSP/ONVIF)',
    file_search: 'wyszukiwanie plików na dysku lokalnym',
    file_read: 'odczyt zawartości plików',
    ssh_execute: 'zdalne polecenia przez SSH',
    system_info: 'informacje o systemie (uptime, procesy)',
    disk_info: 'informacje o dyskach i partycjach',
    rtsp_capture: 'przechwytywanie klatek z kamer RTSP',
    tts_local: 'synteza mowy (TTS) lokalna',
    database_sqlite: 'baza danych SQLite (historia, urządzenia)',
    monitor_changes: 'monitorowanie zmian na stronach/kamerach',
  };

  const capsText = ctx.capabilities
    .map(c => `- ${capDescriptions[c] || c}`)
    .join('\n');

  return `## Kontekst systemowy
- **System operacyjny:** ${osLabels[ctx.os]}
- **Runtime:** ${ctx.runtime === 'tauri' ? 'Tauri (aplikacja desktopowa z pełnym dostępem do systemu)' : 'Przeglądarka (ograniczony dostęp)'}
- **Użytkownik:** ${ctx.user}
- **Katalog domowy:** ${ctx.homeDir}
- **Shell:** ${ctx.shell}
- **Hostname:** ${ctx.hostname}

## Dostępne możliwości systemu Broxeen
${capsText}

## WAŻNE zasady odpowiadania
- ZAWSZE odpowiadaj w kontekście systemu ${osLabels[ctx.os]} — nie podawaj instrukcji dla innych systemów.
- Jeśli użytkownik pyta o pliki, foldery, procesy — ${ctx.runtime === 'tauri' ? 'WYKONAJ akcję bezpośrednio (masz dostęp do systemu plików)' : 'zaproponuj polecenie dla ' + ctx.shell}.
- Zamiast poradników "jak to zrobić" — proponuj KONKRETNE komendy gotowe do wykonania.
- Ścieżki podawaj w formacie ${ctx.os === 'windows' ? 'Windows (C:\\Users\\...)' : 'Unix (/home/...)'}.
- Katalog domowy użytkownika to: ${ctx.homeDir}
- Jeśli masz dostępną akcję systemową — UŻYJ JEJ zamiast opisywać jak to zrobić ręcznie.`;
}

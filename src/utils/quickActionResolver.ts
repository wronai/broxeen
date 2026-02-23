/**
 * quickActionResolver — Analyzes assistant message content and generates
 * contextual quick-action buttons for the user to click.
 *
 * Each action maps to a chat command that gets executed immediately on click.
 */

import type { ConfigAction } from '../components/ChatConfigPrompt';
import type { ChatMessage } from '../domain/chatEvents';

export interface QuickActionSet {
  actions: ConfigAction[];
  layout: 'inline' | 'buttons';
}

// ── IP / URL detectors ──────────────────────────────────────

const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const SUBNET_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.0\/24\b/;

// ── Keyword matchers ────────────────────────────────────────

const CAMERA_KEYWORDS = /kamer[aąęy]|camera|rtsp|onvif|podgląd|preview|snapshot|live/i;
const NETWORK_KEYWORDS = /sieć|sieci|network|skanow|scan|urządze[nń]|device|host|interfejs/i;
const SCAN_RESULT_KEYWORDS = /znaleziono|discovered|found|wykryto|online|active|port\s+\d/i;
const BROWSE_KEYWORDS = /strona|stron[ęy]|website|browse|przeglądaj|http|url|tytuł/i;
const SSH_KEYWORDS = /ssh|terminal|uptime|remote|host/i;
const MONITOR_KEYWORDS = /monitor|obserwuj|change|zmian[ayę]|alert|watch/i;
const CONFIG_KEYWORDS = /konfigur|config|ustawieni[ae]|setup|api\s*key|model|podsie[ćc]/i;
const HELP_KEYWORDS = /pomoc|help|co\s+umiesz|co\s+potrafisz/i;
const PING_KEYWORDS = /ping|reachable|osiągaln|rtt|latenc/i;
const PORT_KEYWORDS = /port|tcp|udp|open|otwart/i;

/**
 * Resolve contextual quick-actions for an assistant message.
 * Returns null if no useful actions can be derived.
 */
export function resolveQuickActions(msg: ChatMessage): QuickActionSet | null {
  if (msg.role !== 'assistant') return null;
  if (msg.loading) return null;
  if (msg.type === 'config_prompt') return null; // already has ChatConfigPrompt
  if (!msg.text || msg.text.length < 10) return null;

  const text = msg.text;
  const actions: ConfigAction[] = [];

  // Extract IPs found in the message
  const ips = [...new Set(Array.from(text.matchAll(IP_RE), m => m[1]))].filter(
    ip => !ip.startsWith('0.') && !ip.startsWith('255.') && ip !== '0.0.0.0',
  );

  // Extract URLs
  const urls = [...new Set(Array.from(text.matchAll(URL_RE), m => m[0]))];

  // Detect subnet
  const subnetMatch = text.match(SUBNET_RE);

  // ── Camera-related message ──────────────────────────────
  if (CAMERA_KEYWORDS.test(text)) {
    if (ips.length > 0) {
      const ip = ips[0];
      actions.push(
        { id: `qa-cam-live-${ip}`, label: `▶ Live ${ip}`, icon: '📹', type: 'execute', executeQuery: `pokaż kamerę ${ip}`, variant: 'primary' },
        { id: `qa-cam-snap-${ip}`, label: 'Snapshot', icon: '📸', type: 'execute', executeQuery: `snapshot ${ip}`, variant: 'secondary' },
        { id: `qa-cam-monitor-${ip}`, label: 'Monitoruj', icon: '👁️', type: 'execute', executeQuery: `monitoruj ${ip}`, variant: 'secondary' },
      );
    }
    if (!actions.some(a => a.id.includes('cam-live'))) {
      actions.push(
        { id: 'qa-find-cameras', label: 'Szukaj kamer', icon: '🔍', type: 'execute', executeQuery: 'znajdź kamery w sieci', variant: 'primary' },
      );
    }
  }

  // ── Network scan results ────────────────────────────────
  if (NETWORK_KEYWORDS.test(text) && SCAN_RESULT_KEYWORDS.test(text)) {
    for (const ip of ips.slice(0, 3)) {
      if (!actions.some(a => a.executeQuery?.includes(ip))) {
        actions.push(
          { id: `qa-ping-${ip}`, label: `Ping ${ip}`, icon: '📡', type: 'execute', executeQuery: `ping ${ip}`, variant: 'secondary' },
          { id: `qa-ports-${ip}`, label: `Porty ${ip}`, icon: '🔍', type: 'execute', executeQuery: `skanuj porty ${ip}`, variant: 'secondary' },
        );
      }
    }
    if (subnetMatch) {
      actions.push(
        { id: 'qa-rescan', label: 'Skanuj ponownie', icon: '🔄', type: 'execute', executeQuery: `skanuj ${subnetMatch[1]}`, variant: 'primary' },
      );
    }
  }

  // ── Ping results → offer port scan ──────────────────────
  if (PING_KEYWORDS.test(text) && ips.length > 0) {
    const ip = ips[0];
    if (!actions.some(a => a.id.includes(`ports-${ip}`))) {
      actions.push(
        { id: `qa-ports-${ip}`, label: `Skanuj porty ${ip}`, icon: '🔍', type: 'execute', executeQuery: `skanuj porty ${ip}`, variant: 'primary' },
      );
    }
    if (!actions.some(a => a.id.includes(`ssh-${ip}`))) {
      actions.push(
        { id: `qa-ssh-${ip}`, label: `SSH ${ip}`, icon: '💻', type: 'prefill', prefillText: `ssh ${ip} `, variant: 'secondary' },
      );
    }
  }

  // ── Port scan results → offer SSH / browse ──────────────
  if (PORT_KEYWORDS.test(text) && ips.length > 0) {
    const ip = ips[0];
    if (/22/i.test(text) && !actions.some(a => a.id.includes('ssh'))) {
      actions.push(
        { id: `qa-ssh-${ip}`, label: `SSH ${ip}`, icon: '💻', type: 'prefill', prefillText: `ssh ${ip} uptime`, variant: 'primary' },
      );
    }
    if (/80|443|8080/i.test(text)) {
      const proto = /443/.test(text) ? 'https' : 'http';
      actions.push(
        { id: `qa-browse-${ip}`, label: `Otwórz ${ip}`, icon: '🌍', type: 'execute', executeQuery: `${proto}://${ip}`, variant: 'secondary' },
      );
    }
    if (!actions.some(a => a.id.includes('monitor'))) {
      actions.push(
        { id: `qa-monitor-${ip}`, label: 'Monitoruj', icon: '👁️', type: 'execute', executeQuery: `monitoruj ${ip}`, variant: 'secondary' },
      );
    }
  }

  // ── Browse results → offer more actions ─────────────────
  if (BROWSE_KEYWORDS.test(text) && urls.length > 0) {
    const url = urls[0];
    if (!actions.some(a => a.executeQuery === url)) {
      actions.push(
        { id: 'qa-refresh-page', label: 'Odśwież', icon: '🔄', type: 'execute', executeQuery: url, variant: 'secondary' },
      );
    }
    actions.push(
      { id: 'qa-search-more', label: 'Szukaj więcej', icon: '🔍', type: 'prefill', prefillText: 'wyszukaj ', variant: 'secondary' },
    );
  }

  // ── SSH results → offer more commands ───────────────────
  if (SSH_KEYWORDS.test(text) && ips.length > 0) {
    const ip = ips[0];
    actions.push(
      { id: `qa-ssh-df-${ip}`, label: 'Dyski', icon: '💾', type: 'execute', executeQuery: `ssh ${ip} df -h`, variant: 'secondary' },
      { id: `qa-ssh-top-${ip}`, label: 'Procesy', icon: '📊', type: 'execute', executeQuery: `ssh ${ip} top -bn1 | head -20`, variant: 'secondary' },
    );
  }

  // ── Monitor active → offer logs/stop ────────────────────
  if (MONITOR_KEYWORDS.test(text)) {
    if (!actions.some(a => a.id.includes('mon-logs'))) {
      actions.push(
        { id: 'qa-mon-logs', label: 'Logi monitoringu', icon: '📋', type: 'execute', executeQuery: 'pokaż logi monitoringu', variant: 'secondary' },
        { id: 'qa-mon-list', label: 'Aktywne monitoringi', icon: '📊', type: 'execute', executeQuery: 'aktywne monitoringi', variant: 'secondary' },
      );
    }
  }

  // ── Config-related → offer config actions ───────────────
  if (CONFIG_KEYWORDS.test(text)) {
    if (!actions.some(a => a.id.includes('config'))) {
      actions.push(
        { id: 'qa-config-overview', label: 'Konfiguracja', icon: '⚙️', type: 'execute', executeQuery: 'konfiguracja', variant: 'secondary' },
      );
    }
  }

  // ── Help / general → offer starting actions ─────────────
  if (HELP_KEYWORDS.test(text)) {
    actions.push(
      { id: 'qa-help-scan', label: 'Skanuj sieć', icon: '🔍', type: 'execute', executeQuery: 'skanuj sieć', variant: 'primary' },
      { id: 'qa-help-cameras', label: 'Znajdź kamery', icon: '📷', type: 'execute', executeQuery: 'znajdź kamery w sieci', variant: 'primary' },
      { id: 'qa-help-browse', label: 'Przeglądaj', icon: '🌍', type: 'prefill', prefillText: 'przeglądaj ', variant: 'secondary' },
      { id: 'qa-help-config', label: 'Konfiguracja', icon: '⚙️', type: 'execute', executeQuery: 'konfiguracja', variant: 'secondary' },
    );
  }

  // ── Fallback: generic IPs without other context ─────────
  if (actions.length === 0 && ips.length > 0) {
    const ip = ips[0];
    actions.push(
      { id: `qa-ping-${ip}`, label: `Ping ${ip}`, icon: '📡', type: 'execute', executeQuery: `ping ${ip}`, variant: 'secondary' },
      { id: `qa-ports-${ip}`, label: `Porty ${ip}`, icon: '🔍', type: 'execute', executeQuery: `skanuj porty ${ip}`, variant: 'secondary' },
    );
  }

  // ── Fallback: generic URLs without other context ────────
  if (actions.length === 0 && urls.length > 0) {
    actions.push(
      { id: 'qa-browse-again', label: 'Przeglądaj ponownie', icon: '🔄', type: 'execute', executeQuery: urls[0], variant: 'secondary' },
    );
  }

  if (actions.length === 0) return null;

  // Deduplicate by id
  const seen = new Set<string>();
  const deduped = actions.filter(a => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  // Limit to 5 actions max
  return {
    actions: deduped.slice(0, 5),
    layout: deduped.length <= 3 ? 'inline' : 'buttons',
  };
}

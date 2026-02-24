import { describe, it, expect } from 'vitest';
import { resolveQuickActions } from './quickActionResolver';
import type { ChatMessage } from '../domain/chatEvents';

function msg(text: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 1, role: 'assistant', text, ...overrides };
}

describe('resolveQuickActions', () => {
  it('returns null for user messages', () => {
    expect(resolveQuickActions(msg('hello', { role: 'user' }))).toBeNull();
  });

  it('returns null for loading messages', () => {
    expect(resolveQuickActions(msg('loading...', { loading: true }))).toBeNull();
  });

  it('returns null for config_prompt messages', () => {
    expect(resolveQuickActions(msg('config', { type: 'config_prompt' }))).toBeNull();
  });

  it('returns null for short messages', () => {
    expect(resolveQuickActions(msg('ok'))).toBeNull();
  });

  it('returns null when no patterns match', () => {
    expect(resolveQuickActions(msg('Lorem ipsum dolor sit amet consectetur adipiscing elit'))).toBeNull();
  });

  // ── Network scan results ────────────────────────────────

  it('generates ping/port actions for network scan with IPs', () => {
    const result = resolveQuickActions(msg(
      'Skanowanie sieci zakończone. Znaleziono 3 urządzenia:\n- 192.168.1.10 (online)\n- 192.168.1.20 (online)\n- 192.168.1.30 (online)',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.length).toBeGreaterThan(0);
    const queries = result!.actions.map(a => a.executeQuery || a.prefillText);
    expect(queries.some(q => q?.includes('ping'))).toBe(true);
    expect(queries.some(q => q?.includes('porty') || q?.includes('port'))).toBe(true);
  });

  it('generates rescan action when subnet is present', () => {
    const result = resolveQuickActions(msg(
      'Skanowanie sieci 192.168.1.0/24 zakończone. Znaleziono 2 urządzenia: 192.168.1.10, 192.168.1.20',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-rescan')).toBe(true);
  });

  // ── Camera results ──────────────────────────────────────

  it('generates camera actions when camera keywords + IP present', () => {
    const result = resolveQuickActions(msg(
      'Znaleziono kamerę IP pod adresem 192.168.1.100. Podgląd dostępny przez RTSP.',
    ));
    expect(result).not.toBeNull();
    const ids = result!.actions.map(a => a.id);
    expect(ids.some(id => id.includes('cam-live'))).toBe(true);
    expect(ids.some(id => id.includes('cam-snap') || id.includes('cam-monitor'))).toBe(true);
  });

  it('generates find-cameras action when no IP but camera keywords', () => {
    const result = resolveQuickActions(msg(
      'Nie znaleziono kamer w sieci. Spróbuj ponownie lub zmień podsieć.',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-find-cameras')).toBe(true);
  });

  // ── Ping results ────────────────────────────────────────

  it('generates port scan action after ping result', () => {
    const result = resolveQuickActions(msg(
      'Ping 192.168.1.50: reachable, avg RTT 1.2ms, 3/3 packets received',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.executeQuery?.includes('porty'))).toBe(true);
  });

  // ── Port scan results ───────────────────────────────────

  it('generates SSH action when port 22 found', () => {
    const result = resolveQuickActions(msg(
      'Port scan 192.168.1.10:\n- Port 22 (SSH) - open\n- Port 80 (HTTP) - open',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.prefillText?.includes('ssh'))).toBe(true);
  });

  it('generates browse action when port 80/443 found', () => {
    const result = resolveQuickActions(msg(
      'Port scan 192.168.1.10:\n- Port 443 (HTTPS) - open\n- Port 8080 - open',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.executeQuery?.includes('https://'))).toBe(true);
  });

  // ── Browse results ──────────────────────────────────────

  it('generates refresh/search actions for browse results', () => {
    const result = resolveQuickActions(msg(
      'Strona https://example.com załadowana. Tytuł: Example Domain. Treść...',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-refresh-page')).toBe(true);
    expect(result!.actions.some(a => a.id === 'qa-search-more')).toBe(true);
  });

  // ── RSS feeds ────────────────────────────────────────────

  it('generates RSS monitoring actions for RSS feeds', () => {
    const result = resolveQuickActions(msg(
      'rss.wp.pl:\nWykryto adres RSS serwisu WP.pl. Mogę monitorować ten kanał dla Ciebie i powiadamiać Cię o nowych wpisach.\n\nJeśli chcesz, abym pobrał aktualne nagłówki z tego źródła, wykonam następujące polecenie:\n\n```bash\ncurl -s https://rss.wp.pl/rss.xml | grep -oPm1 "(?<=<title>)[^<]+" | sed \'1d\'\n```\n\nCzy mam dodać ten adres do stałego monitoringu Broxeen, aby sprawdzać zmiany automatycznie?',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-rss-monitor')).toBe(true);
    expect(result!.actions.some(a => a.id === 'qa-rss-refresh')).toBe(true);
    
    const monitorAction = result!.actions.find(a => a.id === 'qa-rss-monitor');
    expect(monitorAction?.label).toBe('Dodaj do monitoringu');
    expect(monitorAction?.executeQuery).toBe('dodaj do monitorowania https://rss.wp.pl/rss.xml');
    
    const refreshAction = result!.actions.find(a => a.id === 'qa-rss-refresh');
    expect(refreshAction?.label).toBe('Odśwież');
    expect(refreshAction?.executeQuery).toBe('bridge rss https://rss.wp.pl/rss.xml');
  });

  it('generates RSS actions for generic RSS feeds', () => {
    const result = resolveQuickActions(msg(
      'Wykryto kanał RSS: https://example.com/feed.xml. Kanał zawiera najnowsze artykuły.',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-rss-monitor')).toBe(true);
    expect(result!.actions.some(a => a.id === 'qa-rss-refresh')).toBe(true);
  });

  // ── SSH results ─────────────────────────────────────────

  it('generates follow-up SSH commands after SSH result', () => {
    const result = resolveQuickActions(msg(
      'SSH 192.168.1.10: uptime: 14:32:01 up 5 days, load average: 0.01',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.executeQuery?.includes('df -h'))).toBe(true);
  });

  // ── Monitor results ─────────────────────────────────────

  it('generates logs/list actions for monitor messages', () => {
    const result = resolveQuickActions(msg(
      'Monitoring uruchomiony. Obserwuję zmiany na kamerze wejściowej co 30s.',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-mon-logs')).toBe(true);
    expect(result!.actions.some(a => a.id === 'qa-mon-list')).toBe(true);
  });

  // ── Help ────────────────────────────────────────────────

  it('generates starting actions for help messages', () => {
    const result = resolveQuickActions(msg(
      'Oto co mogę dla Ciebie zrobić. Pomoc i dostępne komendy:',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.id === 'qa-help-scan')).toBe(true);
    expect(result!.actions.some(a => a.id === 'qa-help-cameras')).toBe(true);
  });

  // ── Fallback IP ─────────────────────────────────────────

  it('generates fallback ping/port for messages with IPs but no other context', () => {
    const result = resolveQuickActions(msg(
      'Odpowiedź z serwera 10.0.0.5 została przetworzona pomyślnie.',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.some(a => a.executeQuery?.includes('ping 10.0.0.5'))).toBe(true);
  });

  // ── Deduplication and limits ────────────────────────────

  it('limits actions to 5 max', () => {
    const result = resolveQuickActions(msg(
      'Skanowanie sieci zakończone. Znaleziono urządzenia: 192.168.1.1, 192.168.1.2, 192.168.1.3, 192.168.1.4, 192.168.1.5 (all online). Kamera wykryta.',
    ));
    expect(result).not.toBeNull();
    expect(result!.actions.length).toBeLessThanOrEqual(5);
  });

  it('deduplicates actions by id', () => {
    const result = resolveQuickActions(msg(
      'Ping 192.168.1.10 reachable. Sieć skanowana, znaleziono 192.168.1.10 online.',
    ));
    if (result) {
      const ids = result.actions.map(a => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

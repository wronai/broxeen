/**
 * MessageResultCard — Wraps assistant message content with visual domain
 * indicators: colored left border, domain icon badge, and status pill.
 *
 * Auto-detects the domain from message text content using keyword matching.
 * Falls through gracefully — if no domain is detected, renders children as-is.
 */

import { type ReactNode } from 'react';
import {
  Wifi, Camera, Globe, Terminal, Eye, Thermometer,
  Link2, ShoppingBag, MessageCircle, HelpCircle,
  CheckCircle2, XCircle, AlertTriangle, Info,
  FolderSearch, Mail,
} from 'lucide-react';

// ── Domain detection ────────────────────────────────────────

type ResultDomain = 'camera' | 'network' | 'system' | 'browse' | 'monitor' | 'iot' | 'bridge' | 'marketplace' | 'chat' | 'error' | 'fallback' | 'file' | 'email';

interface DomainMeta {
  icon: ReactNode;
  label: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
}

const DOMAIN_META: Record<ResultDomain, DomainMeta> = {
  camera: {
    icon: <Camera size={12} />,
    label: 'Kamera',
    borderColor: 'border-l-purple-500',
    badgeBg: 'bg-purple-500/20',
    badgeText: 'text-purple-400',
  },
  network: {
    icon: <Wifi size={12} />,
    label: 'Sieć',
    borderColor: 'border-l-blue-500',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-blue-400',
  },
  system: {
    icon: <Terminal size={12} />,
    label: 'System',
    borderColor: 'border-l-emerald-500',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-emerald-400',
  },
  browse: {
    icon: <Globe size={12} />,
    label: 'Przeglądanie',
    borderColor: 'border-l-cyan-500',
    badgeBg: 'bg-cyan-500/20',
    badgeText: 'text-cyan-400',
  },
  monitor: {
    icon: <Eye size={12} />,
    label: 'Monitoring',
    borderColor: 'border-l-amber-500',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-400',
  },
  iot: {
    icon: <Thermometer size={12} />,
    label: 'IoT',
    borderColor: 'border-l-orange-500',
    badgeBg: 'bg-orange-500/20',
    badgeText: 'text-orange-400',
  },
  bridge: {
    icon: <Link2 size={12} />,
    label: 'Bridge',
    borderColor: 'border-l-indigo-500',
    badgeBg: 'bg-indigo-500/20',
    badgeText: 'text-indigo-400',
  },
  marketplace: {
    icon: <ShoppingBag size={12} />,
    label: 'Marketplace',
    borderColor: 'border-l-pink-500',
    badgeBg: 'bg-pink-500/20',
    badgeText: 'text-pink-400',
  },
  chat: {
    icon: <MessageCircle size={12} />,
    label: 'Chat',
    borderColor: 'border-l-gray-500',
    badgeBg: 'bg-gray-500/20',
    badgeText: 'text-gray-400',
  },
  error: {
    icon: <XCircle size={12} />,
    label: 'Błąd',
    borderColor: 'border-l-red-500',
    badgeBg: 'bg-red-500/20',
    badgeText: 'text-red-400',
  },
  fallback: {
    icon: <HelpCircle size={12} />,
    label: 'Sugestie',
    borderColor: 'border-l-yellow-500',
    badgeBg: 'bg-yellow-500/20',
    badgeText: 'text-yellow-400',
  },
  file: {
    icon: <FolderSearch size={12} />,
    label: 'Pliki',
    borderColor: 'border-l-teal-500',
    badgeBg: 'bg-teal-500/20',
    badgeText: 'text-teal-400',
  },
  email: {
    icon: <Mail size={12} />,
    label: 'Email',
    borderColor: 'border-l-violet-500',
    badgeBg: 'bg-violet-500/20',
    badgeText: 'text-violet-400',
  },
};

type ResultStatus = 'success' | 'error' | 'info' | 'warning';

const STATUS_META: Record<ResultStatus, { icon: ReactNode; label: string; className: string }> = {
  success: { icon: <CheckCircle2 size={10} />, label: 'OK', className: 'text-green-400' },
  error: { icon: <XCircle size={10} />, label: 'Błąd', className: 'text-red-400' },
  info: { icon: <Info size={10} />, label: 'Info', className: 'text-blue-400' },
  warning: { icon: <AlertTriangle size={10} />, label: 'Uwaga', className: 'text-amber-400' },
};

// ── Detection logic ─────────────────────────────────────────

const DOMAIN_PATTERNS: Array<{ domain: ResultDomain; patterns: RegExp[] }> = [
  {
    domain: 'camera',
    patterns: [/kamer[ayię]/i, /camera/i, /rtsp/i, /onvif/i, /snapshot/i, /podgląd/i, /live.*kamer/i, /zdjęci/i],
  },
  {
    domain: 'network',
    patterns: [/skanow/i, /sieć|siec/i, /ping\s/i, /port[yów]/i, /arp/i, /mdns/i, /bonjour/i, /urządz/i, /mac\s*add/i, /scan/i, /wake.*lan/i],
  },
  {
    domain: 'system',
    patterns: [/dysk[iów]/i, /disk/i, /ssh/i, /proces[yów]/i, /uptime/i, /host[yów]/i],
  },
  {
    domain: 'browse',
    patterns: [/https?:\/\//i, /stron[ayię]/i, /przeglądaj/i, /wyszukaj/i, /google/i],
  },
  {
    domain: 'monitor',
    patterns: [/monitoruj/i, /monitorow/i, /monitoring/i, /obserwuj/i, /logi.*monitor/i, /zmian/i],
  },
  {
    domain: 'iot',
    patterns: [/temperatur/i, /wilgotność/i, /czujnik/i, /sensor/i],
  },
  {
    domain: 'bridge',
    patterns: [/bridge/i, /mqtt/i, /websocket/i, /rest\s*api/i, /graphql/i, /sse/i],
  },
  {
    domain: 'marketplace',
    patterns: [/marketplace/i, /plugin[yów]/i, /zainstaluj/i, /odinstaluj/i],
  },
  {
    domain: 'file',
    patterns: [/plik[iów]?/i, /dokument[yów]?/i, /folder/i, /katalog/i, /wyszukiwan.*plik/i, /znaleziono.*plik/i, /file.*search/i],
  },
  {
    domain: 'email',
    patterns: [/email/i, /e-mail/i, /smtp/i, /imap/i, /skrzynk/i, /inbox/i, /poczt[aę]/i, /wiadomoś/i, /mail.*wysłan/i],
  },
];

function detectDomain(text: string, msgType?: string): ResultDomain | null {
  if (msgType === 'error') return 'error';
  if (msgType === 'config_prompt') return 'fallback';

  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return domain;
    }
  }
  return null;
}

function detectStatus(text: string, msgType?: string): ResultStatus {
  if (msgType === 'error') return 'error';
  if (/błąd|error|nie udało|failed|nie znaleziono|timeout/i.test(text)) return 'error';
  if (/uwaga|warning|ostrzeżenie/i.test(text)) return 'warning';
  if (/znaleziono|sukces|gotowe|✅|online|działa|ok\b/i.test(text)) return 'success';
  return 'info';
}

// ── Component ───────────────────────────────────────────────

interface MessageResultCardProps {
  text: string;
  msgType?: string;
  children: ReactNode;
}

export function MessageResultCard({ text, msgType, children }: MessageResultCardProps) {
  const domain = detectDomain(text, msgType);

  // No decoration for undetected domain or very short messages
  if (!domain || text.length < 30) {
    return <>{children}</>;
  }

  const meta = DOMAIN_META[domain];
  const status = detectStatus(text, msgType);
  const statusMeta = STATUS_META[status];

  return (
    <div className={`border-l-2 ${meta.borderColor} pl-3 -ml-1`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.badgeBg} ${meta.badgeText}`}>
          {meta.icon}
          {meta.label}
        </span>
        <span className={`inline-flex items-center gap-0.5 text-[10px] ${statusMeta.className}`}>
          {statusMeta.icon}
          {statusMeta.label}
        </span>
      </div>
      {children}
    </div>
  );
}

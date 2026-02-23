#!/usr/bin/env node
/**
 * Broxeen Chat CLI — interact with the plugin system from terminal
 * Usage: node scripts/chat-cli.mjs
 *        BROXEEN_URL=http://localhost:5173 node scripts/chat-cli.mjs
 */

import { execSync } from 'child_process';
import { networkInterfaces } from 'os';
import { createInterface } from 'readline';

// ── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', gray: '\x1b[90m',
};
const col = (text, ...keys) => keys.map(k => C[k]).join('') + text + C.reset;

// ── System helpers ────────────────────────────────────────────────────────────
function run(cmd, timeout = 8000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}
const hasCmd = n => !!run(`which ${n}`);

function getLocalIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const a of ifaces) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}
const subnet = ip => ip ? ip.split('.').slice(0, 3).join('.') : '192.168.1';

function getLocalCidrs() {
  if (tools.ip) {
    const out = run('ip -4 -o addr show scope global');
    if (out) {
      const cidrs = out.split('\n')
        .map((line) => {
          const m = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+\/\d+)/);
          return m?.[1] || null;
        })
        .filter(Boolean);

      const uniq = [...new Set(cidrs)];
      if (uniq.length) return uniq;
    }
  }

  const ip = getLocalIp();
  if (!ip) return [];
  return [`${subnet(ip)}.0/24`];
}

// ── Available tools ───────────────────────────────────────────────────────────
const tools = {
  nmap: hasCmd('nmap'),
  arp: hasCmd('arp'),
  ip: hasCmd('ip'),
  nc: hasCmd('nc'),
  avahi: hasCmd('avahi-browse'),
};

// ── Intent patterns ───────────────────────────────────────────────────────────
const INTENTS = [
  { name: 'network:ping',      re: /ping\s+(\d[\d.]+)/i },
  { name: 'network:port-scan', re: /(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i },
  { name: 'network:arp',       re: /\barp\b|mac\s+address|lista\s+urządzeń/i },
  { name: 'network:mdns',      re: /\bmdns\b|\bbonjour\b|usługi\s+w\s+sieci/i },
  { name: 'camera:onvif',      re: /\bonvif\b|kamery\s+ip/i },
  { name: 'network:find-rpi',  re: /znajd[źz]\s+rpi|raspberry\s*pi|\brpi\b/i },
  { name: 'network:scan',      re: /skanuj\s+sieć|scan\s+net|pokaż\s+kamery|kamery\s+w\s+sieci|urządzenia\s+w\s+sieci|znajdź\s+urządzenia/i },
  { name: 'browse:url',        re: /https?:\/\/\S+/i },
  { name: 'system:processes',  re: /^procesy\b|^processes\b|^stop\s+proc|^zatrzymaj\s+proc/i },
  { name: 'monitor:list',      re: /aktywne\s+monitor|lista\s+monitor|monitor.*list/i },
  { name: 'monitor:logs',      re: /logi\s+monitor|pokaż\s+logi|monitor.*log/i },
  { name: 'monitor:config',    re: /(?:zmien|zmień|ustaw).*(?:interwał|interwal|próg|prog)/i },
  { name: 'frigate:status',    re: /frigate\s+status|status\s+frigate|stan\s+frigate/i },
  { name: 'frigate:start',     re: /frigate\s+start|uruchom\s+frigate/i },
  { name: 'frigate:stop',      re: /frigate\s+stop|zatrzymaj\s+frigate/i },
];
function detectIntent(q) {
  for (const { name, re } of INTENTS) if (re.test(q)) return name;
  return 'chat:fallback';
}

// ── Network handlers ──────────────────────────────────────────────────────────
function handlePing(q) {
  const m = q.match(/ping\s+(\d[\d.]+)/i);
  const host = m?.[1] ?? '8.8.8.8';
  const out = run(`ping -c 3 -W 2 ${host}`);
  return out ? `🔧 ping ${host}\n\n${out}` : `❌ Nie można wykonać ping ${host}`;
}

function parseArpEntries() {
  const raw = tools.ip ? run('ip neigh show') : (tools.arp ? run('arp -a') : null);
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const ip = line.match(/^(\d[\d.]+)/)?.[1];
    const mac = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i)?.[1];
    const state = /REACH/.test(line) ? 'reachable' : /STALE/.test(line) ? 'stale' : 'known';
    return ip ? { ip, mac, state } : null;
  }).filter(Boolean);
}

function parseNmapHosts(out) {
  return [...out.matchAll(/Nmap scan report for\s+(?:\S+\s+\()?(\d[\d.]+)/g)].map(m => {
    const ip = m[1];
    const block = out.slice(m.index, out.indexOf('\n\n', m.index));
    const ports = [...block.matchAll(/(\d+)\/tcp\s+open/g)].map(p => +p[1]);
    const hasCam = ports.some(p => [554, 8554].includes(p));
    return { ip, ports, hasCam };
  });
}

function handleFindRpi(q) {
  const cidrs = getLocalCidrs();
  const lines = [
    '🥧 **Znajdź Raspberry Pi w sieci** *(tryb systemowy)*',
    'Skanuję sieć lokalną w poszukiwaniu urządzeń Raspberry Pi na podstawie wpisów MAC/vendor z nmap.',
    '',
    cidrs.length ? `🌐 Zakres(y): ${cidrs.join(', ')}` : '🌐 Zakres(y): (nie wykryto)',
    '',
  ];

  if (!cidrs.length) {
    lines.push('❌ Nie udało się wykryć podsieci.');
    lines.push('💡 Uruchom w systemie: `ip -4 a` i sprawdź adres IPv4 interfejsu LAN.');
    return lines.join('\n');
  }

  if (!tools.nmap) {
    lines.push('❌ nmap nie jest zainstalowany.');
    lines.push('💡 Zainstaluj: `sudo apt install nmap`');
    return lines.join('\n');
  }

  const allHits = [];
  for (const cidr of cidrs) {
    lines.push(`⏳ Skanuję: ${cidr} ...`);
    const cmd = `sudo nmap -sn -T4 ${cidr} 2>/dev/null`;
    const out = run(cmd, 60000);
    if (!out) {
      lines.push(`⚠️ Brak wyników dla ${cidr} (sprawdź hasło sudo / uprawnienia).`);
      continue;
    }

    const blocks = out.split(/\n\n+/);
    const hits = blocks
      .filter((b) => /Raspberry\s+Pi/i.test(b))
      .map((b) => {
        const ip = b.match(/Nmap scan report for\s+(?:\S+\s+\()?(\d[\d.]+)/)?.[1] || null;
        const mac = b.match(/MAC Address:\s+([0-9A-F:]+)/i)?.[1] || null;
        const vendor = b.match(/MAC Address:.*?\(([^)]+)\)/i)?.[1] || null;
        return ip ? { ip, mac, vendor } : null;
      })
      .filter(Boolean);

    if (!hits.length) {
      lines.push(`ℹ️  Nie znaleziono RPi w ${cidr}.`);
      continue;
    }

    lines.push(`✅ Raspberry Pi w ${cidr}: ${hits.length}`);
    for (const h of hits) {
      allHits.push(h);
      lines.push(`  🥧 ${h.ip}${h.mac ? `  MAC: ${h.mac}` : ''}${h.vendor ? ` (${h.vendor})` : ''}`);
    }
  }

  if (allHits.length) {
    lines.push('');
    lines.push('💡 Sugerowane akcje:');
    for (const h of allHits.slice(0, 5)) {
      lines.push(`- "ping ${h.ip}"`);
      lines.push(`- "skanuj porty ${h.ip}"`);
      lines.push(`- "ssh ${h.ip}"`);
    }
  }

  return lines.join('\n');
}

function handleScan(q) {
  const isCam = /kamer|camera/i.test(q);
  const localIp = getLocalIp();
  const sub = subnet(localIp);
  const lines = [
    isCam ? `📷 **Skanowanie kamer** *(tryb systemowy)*` : `🔍 **Skanowanie sieci** *(tryb systemowy)*`,
    `🌐 Podsieć: ${sub}.0/24 | Lokalny IP: ${localIp || 'nie wykryto'}\n`,
  ];

  const arp = parseArpEntries().filter(e => e.state !== 'failed' && e.ip !== localIp);
  const wifiArp = arp.filter(e => localIp && e.ip.startsWith(localIp.split('.').slice(0,3).join('.') + '.'));
  if (wifiArp.length) {
    lines.push(`**Sąsiedzi WiFi (${wifiArp.length}):**`);
    for (const { ip, mac, state } of wifiArp) {
      lines.push(`  📍 ${ip}${mac ? ` [${mac}]` : ''} (${state})`);
    }
    lines.push('');
  } else {
    lines.push('⚠️ Brak wpisów ARP (urządzenia mogą być w stanie uśpienia)\n');
  }

  if (tools.nmap) {
    const nmapCmd = isCam
      ? `nmap -p 80,8080,554,8554,8000 --open -T4 ${sub}.0/24 2>/dev/null`
      : `nmap -sn -T4 ${sub}.0/24 2>/dev/null`;
    lines.push(`⏳ nmap ${sub}.0/24 ...`);
    const nmapOut = run(nmapCmd, 30000);
    if (nmapOut) {
      const hosts = parseNmapHosts(nmapOut).filter(h => h.ip !== localIp);
      const cameras = isCam ? hosts.filter(h => h.hasCam) : [];
      const others  = isCam ? hosts.filter(h => !h.hasCam) : hosts;
      if (isCam) {
        lines.push(cameras.length
          ? `**📷 Kamery RTSP (${cameras.length}):**`
          : `⚠️ Nie wykryto kamer RTSP (port 554/8554 zamknięty)`);
        cameras.forEach(({ ip, ports }) => {
          lines.push(`  📷 **${ip}** ports: ${ports.join(',')}`);
          lines.push(`     🎥 RTSP: \`rtsp://${ip}:554/stream\``);
        });
        if (others.length) {
          lines.push(`\n🖥️  Inne urządzenia (${others.length}):`);
          others.forEach(({ ip, ports }) => lines.push(`  🖥️  ${ip}${ports.length ? ` [${ports.join(',')}]` : ''}`));
        }
      } else {
        lines.push(`**Hosty (${hosts.length}):**`);
        hosts.forEach(({ ip, ports }) => lines.push(`  🖥️  ${ip}${ports.length ? ` [${ports.join(',')}]` : ''}`));
      }
    } else {
      lines.push('⚠️ nmap nie zwrócił wyników (sprawdź uprawnienia sudo)');
    }
  } else {
    lines.push(`💡 Zainstaluj nmap: sudo apt install nmap`);
  }
  return lines.join('\n');
}

function handlePortScan(q) {
  const m = q.match(/(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i);
  if (!m) return '❌ Podaj IP: "skanuj porty 192.168.1.100"';
  const host = m[1];
  if (tools.nmap) {
    const out = run(`nmap -p 80,443,554,8000,8080,8554,22,23,21 -T4 ${host} 2>/dev/null`, 20000);
    return out ? `🔍 **nmap ${host}**\n\n${out}` : `❌ nmap nie odpowiedział`;
  }
  if (tools.nc) {
    const open = [80, 443, 554, 8000, 8080, 8554, 22].filter(p => {
      const r = run(`nc -zv -w1 ${host} ${p} 2>&1`);
      return r && /succeeded|Connected|open/i.test(r);
    });
    return `🔍 **${host}** — otwarte: ${open.length ? open.join(', ') : 'brak'}`;
  }
  return '❌ Brak nmap/nc';
}

function handleArp() {
  const entries = parseArpEntries();
  if (!entries.length) return '❌ Brak danych ARP';
  const lines = ['📋 **Tabela ARP/Sąsiadów**\n'];
  entries.forEach(({ ip, mac, state }) => lines.push(`  📍 ${ip}${mac ? ` [${mac}]` : ''} (${state})`));
  return lines.join('\n');
}

async function handleBrowse(q) {
  const url = q.match(/https?:\/\/\S+/i)?.[0];
  if (!url) return '❌ Nieprawidłowy URL';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'BroxeenCLI/1.0' } });
    const text = await res.text();
    const title = text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || url;
    const plain = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
    return `🌐 **${title}**\n${url}\n\n${plain}`;
  } catch (e) {
    return `❌ Błąd: ${e.message}`;
  }
}

function showHelp() {
  return [
    col('Broxeen Chat CLI', 'bold', 'cyan'),
    '',
    col('Komendy sieciowe:', 'bold'),
    '  ping <IP>               — ping hosta',
    '  skanuj sieć             — ARP + nmap sweep',
    '  pokaż kamery            — skan kamer (ARP + nmap -p 554)',
    '  skanuj porty <IP>       — skan portów nmap/nc',
    '  arp                     — tabela ARP',
    '  <URL>                   — pobierz i wyświetl stronę',
    '',
    col('Urządzenia i pluginy:', 'bold'),
    '  .devices                — lista wykrytych urządzeń (SQLite)',
    '  .devices <IP>           — szczegóły urządzenia',
    '  .plugins                — lista zarejestrowanych pluginów',
    '  .db stats               — statystyki baz danych',
    '  .db query <SQL>         — zapytanie SQL (devices.db)',
    '  .config                 — pokaż bieżącą konfigurację',
    '  .config set <k> <v>     — ustaw wartość konfiguracji',
    '',
    col('Monitoring:', 'bold'),
    '  .monitor list           — aktywne monitoringi (przez app API)',
    '  .monitor logs           — ostatnie logi monitoringu',
    '  .monitor config         — konfiguracja (interwał/próg)',
    '  aktywne monitoringi     — przez chat (wymaga app)',
    '  zmien interwał co 10s   — zmień interwał (przez chat)',
    '',
    col('Frigate NVR:', 'bold'),
    '  .frigate status         — status połączenia MQTT',
    '  .frigate config         — konfiguracja Frigate',
    '  frigate status          — przez chat (wymaga app)',
    '  frigate start/stop      — uruchom/zatrzymaj nasłuch',
    '',
    col('Email:', 'bold'),
    '  .email test              — test SMTP+IMAP',
    '  .email send <to> [...]   — wyślij email',
    '  .email inbox [max]       — skrzynka odbiorcza',
    '  .email config            — konfiguracja',
    '  .email help              — szczegółowa pomoc',
    '',
    col('Specjalne:', 'bold'),
    '  .scope <id>             — zmień scope (local|network|internet)',
    '  .compare                — CLI vs App side-by-side',
    '  .status                 — narzędzia + lokalny IP',
    '  .help                   — ta pomoc',
    '  .exit                   — wyjście',
    '',
    col('Narzędzia:', 'bold'),
    ...Object.entries(tools).map(([k, v]) => `  ${v ? '✅' : '❌'} ${k}`),
  ].join('\n');
}

// ── Device/Plugin/DB handlers ───────────────────────────────────────────────

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function findDbPath(name) {
  // Tauri stores DBs next to the binary or in cwd
  const candidates = [
    join(process.cwd(), name),
    join(process.cwd(), 'src-tauri', name),
    join(homedir(), '.local', 'share', 'com.broxeen.app', name),
  ];
  return candidates.find(p => existsSync(p)) || null;
}

function hasSqlite3Cli() {
  return !!run('which sqlite3');
}

function sqliteQuery(dbPath, sql) {
  if (!dbPath || !hasSqlite3Cli()) return null;
  return run(`sqlite3 -header -column "${dbPath}" "${sql.replace(/"/g, '\\"')}"`, 10000);
}

function handleDevices(arg) {
  const dbPath = findDbPath('broxeen_devices.db');
  if (!dbPath) {
    return col('⚠️  Baza devices.db nie znaleziona.', 'yellow') +
      '\n   Uruchom aplikację Tauri, aby utworzyć bazę danych.' +
      '\n   Ścieżki przeszukane: cwd, src-tauri/, ~/.local/share/com.broxeen.app/';
  }
  if (!hasSqlite3Cli()) {
    return col('⚠️  sqlite3 CLI nie znalezione.', 'yellow') +
      '\n   Zainstaluj: sudo apt install sqlite3';
  }

  if (arg) {
    // Device details by IP
    const device = sqliteQuery(dbPath, `SELECT * FROM devices WHERE ip='${arg.replace(/'/g, '')}' LIMIT 1`);
    const services = sqliteQuery(dbPath, `SELECT type, port, path, status, last_checked FROM device_services WHERE device_id='${arg.replace(/'/g, '')}'`);
    if (!device) return col(`❌ Urządzenie ${arg} nie znalezione w bazie`, 'red');
    return `${col('📱 Urządzenie:', 'bold', 'cyan')}\n${device}\n\n${col('Usługi:', 'bold')}\n${services || '  (brak)'}`;
  }

  const out = sqliteQuery(dbPath, 'SELECT ip, hostname, mac, vendor, datetime(last_seen/1000, "unixepoch", "localtime") as last_seen FROM devices ORDER BY last_seen DESC LIMIT 50');
  if (!out) return col('📭 Brak urządzeń w bazie. Wykonaj skan sieci.', 'dim');
  const count = sqliteQuery(dbPath, 'SELECT count(*) as total FROM devices');
  return `${col('📱 Wykryte urządzenia:', 'bold', 'cyan')}\n${out}\n\n${count}`;
}

async function handlePlugins() {
  // Try to get plugin list from the running app
  try {
    const res = await fetch(`${APP_URL}/api/plugins`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const plugins = data.plugins || data;
      if (Array.isArray(plugins)) {
        const lines = [col('🔌 Zarejestrowane pluginy:', 'bold', 'cyan')];
        plugins.forEach((p, i) => {
          lines.push(`  ${i + 1}. ${col(p.name || p.id, 'green')} v${p.version || '?'} — ${(p.supportedIntents || []).join(', ')}`);
        });
        return lines.join('\n');
      }
    }
  } catch { /* app not running */ }

  // Fallback: list known plugin files
  const pluginDirs = ['plugins/discovery', 'plugins/network', 'plugins/camera', 'plugins/cameras',
    'plugins/monitor', 'plugins/system', 'plugins/chat', 'plugins/http',
    'plugins/rtsp-camera', 'plugins/protocol-bridge', 'plugins/marketplace',
    'plugins/local-network', 'plugins/scope'];
  const lines = [col('🔌 Pluginy (z plików src/):', 'bold', 'cyan')];
  for (const dir of pluginDirs) {
    const out = run(`ls src/${dir}/*Plugin.ts 2>/dev/null`);
    if (out) {
      out.split('\n').forEach(f => {
        const name = f.replace(/^.*\//, '').replace('.ts', '');
        lines.push(`  📦 ${col(name, 'green')} — ${dir}`);
      });
    }
  }
  if (lines.length === 1) lines.push(col('  (brak plików pluginów)', 'dim'));
  lines.push('\n' + col('💡 Uruchom aplikację, aby zobaczyć aktywne pluginy i intenty.', 'dim'));
  return lines.join('\n');
}

function handleDbCommand(args) {
  const sub = args[0];
  if (sub === 'stats') {
    const devicesDb = findDbPath('broxeen_devices.db');
    const chatDb = findDbPath('broxeen_chat.db');
    const lines = [col('🗄️  Statystyki baz danych:', 'bold', 'cyan')];

    for (const [label, path] of [['devices.db', devicesDb], ['chat.db', chatDb]]) {
      if (!path) {
        lines.push(`  ${col(label, 'yellow')}: nie znaleziona`);
        continue;
      }
      if (!hasSqlite3Cli()) {
        lines.push(`  ${col(label, 'yellow')}: ${path} (sqlite3 CLI niedostępne)`);
        continue;
      }
      const tables = sqliteQuery(path, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      const size = run(`du -h "${path}" | cut -f1`);
      lines.push(`  ${col(label, 'green')}: ${path} (${size || '?'})`);
      if (tables) {
        tables.split('\n').filter(Boolean).forEach(t => {
          const count = sqliteQuery(path, `SELECT count(*) FROM ${t.trim()}`);
          lines.push(`    📋 ${t.trim()}: ${count ? count.trim() : '?'} rows`);
        });
      }
    }
    return lines.join('\n');
  }

  if (sub === 'query') {
    const sql = args.slice(1).join(' ');
    if (!sql) return col('❌ Podaj zapytanie SQL: .db query SELECT * FROM devices', 'red');
    const dbPath = findDbPath('broxeen_devices.db');
    if (!dbPath) return col('⚠️  devices.db nie znaleziona', 'yellow');
    if (!hasSqlite3Cli()) return col('⚠️  sqlite3 CLI niedostępne', 'yellow');
    const out = sqliteQuery(dbPath, sql);
    return out || col('(brak wyników)', 'dim');
  }

  return col('Użycie: .db stats | .db query <SQL>', 'yellow');
}

function handleConfig(args) {
  const sub = args[0];
  if (sub === 'set' && args.length >= 3) {
    // Would need app API to set config remotely
    return col(`⚠️  Ustawienie konfiguracji z CLI wymaga uruchomionej aplikacji.`, 'yellow') +
      `\n   Użyj w czacie: "konfiguruj ${args[1]} ${args.slice(2).join(' ')}"` +
      `\n   Lub ustaw zmienną env: export VITE_${args[1].toUpperCase().replace(/\./g, '_')}=${args.slice(2).join(' ')}`;
  }

  // Show current config from env / .env file
  const envFile = run('cat .env 2>/dev/null || cat .env.example 2>/dev/null');
  const lines = [col('⚙️  Konfiguracja (zmienne środowiskowe):', 'bold', 'cyan')];

  const keys = [
    'VITE_OPENROUTER_API_KEY', 'VITE_LLM_MODEL', 'VITE_LLM_API_URL',
    'VITE_STT_MODEL', 'VITE_STT_LANG', 'VITE_DEFAULT_SUBNET',
    'VITE_LOCALE', 'VITE_LANGUAGE',
  ];
  for (const k of keys) {
    const val = process.env[k];
    const fromFile = envFile?.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
    const display = val || fromFile || col('(nie ustawione)', 'dim');
    const masked = k.includes('KEY') && val ? val.slice(0, 8) + '...' : display;
    lines.push(`  ${col(k, 'cyan')}: ${masked}`);
  }
  lines.push('\n' + col('💡 Ustaw: export VITE_xxx=value lub edytuj .env', 'dim'));
  return lines.join('\n');
}

// ── Email helpers (direct Python, no Tauri needed) ────────────────────────────

import { writeFileSync, unlinkSync } from 'fs';

function getEmailConfig() {
  return {
    smtp_host: process.env.BROXEEN_SMTP_HOST     || 'localhost',
    smtp_port: process.env.BROXEEN_SMTP_PORT     || '1025',
    smtp_user: process.env.BROXEEN_SMTP_USER     || 'test@broxeen.local',
    smtp_pass: process.env.BROXEEN_SMTP_PASSWORD || 'test',
    imap_host: process.env.BROXEEN_IMAP_HOST     || 'localhost',
    imap_port: process.env.BROXEEN_IMAP_PORT     || '1143',
    from_addr: process.env.BROXEEN_EMAIL_FROM    || 'broxeen@broxeen.local',
    use_tls:   (process.env.BROXEEN_EMAIL_TLS || 'false') !== 'false'
               && (process.env.BROXEEN_EMAIL_TLS || 'false') !== '0',
  };
}

function runPythonScript(script, stdinFile) {
  const tmpScript = `/tmp/broxeen_py_${Date.now()}.py`;
  try {
    writeFileSync(tmpScript, script);
    const cmd = stdinFile
      ? `python3 ${tmpScript} < ${stdinFile}`
      : `python3 ${tmpScript}`;
    const out = run(cmd, 15000);
    try { unlinkSync(tmpScript); } catch {}
    return out;
  } catch (e) {
    try { unlinkSync(tmpScript); } catch {}
    return null;
  }
}

function handleEmailTest() {
  const c = getEmailConfig();
  const lines = [col('📧 Test konfiguracji email:', 'bold', 'cyan')];
  lines.push(`  SMTP: ${c.smtp_host}:${c.smtp_port}  user=${c.smtp_user}  tls=${c.use_tls}`);
  lines.push(`  IMAP: ${c.imap_host}:${c.imap_port}`);
  lines.push('');

  const noauth = !c.smtp_user || c.smtp_user === 'test@broxeen.local';
  const script = `
import smtplib, imaplib, json, sys
results = {'smtp': False, 'imap': False, 'smtp_error': '', 'imap_error': ''}
try:
    s = smtplib.SMTP('${c.smtp_host}', ${c.smtp_port}, timeout=8)
    s.ehlo()
    ${c.use_tls ? 's.starttls(); s.ehlo()' : '# no TLS'}
    ${noauth ? '# no auth' : `s.login('${c.smtp_user}', '${c.smtp_pass}')`}
    s.quit()
    results['smtp'] = True
except Exception as e:
    results['smtp_error'] = str(e)
try:
    ${c.use_tls
      ? `m = imaplib.IMAP4_SSL('${c.imap_host}', ${c.imap_port})`
      : `m = imaplib.IMAP4('${c.imap_host}', ${c.imap_port})`}
    ${noauth ? '# no auth' : `m.login('${c.smtp_user}', '${c.smtp_pass}')`}
    m.logout()
    results['imap'] = True
except Exception as e:
    results['imap_error'] = str(e)
print(json.dumps(results))
`;

  const out = runPythonScript(script);
  if (!out) { lines.push(col('❌ python3 niedostępny lub timeout', 'red')); return lines.join('\n'); }
  try {
    const r = JSON.parse(out);
    lines.push(r.smtp ? col('✅ SMTP: OK', 'green') : col(`❌ SMTP: ${r.smtp_error}`, 'red'));
    lines.push(r.imap ? col('✅ IMAP: OK', 'green') : col(`❌ IMAP: ${r.imap_error}`, 'red'));
    if (r.smtp && r.imap) {
      lines.push(''); lines.push(col('✅ Konfiguracja poprawna — możesz wysyłać i odbierać email.', 'green'));
    } else if (r.smtp_error && r.smtp_error.includes('Connection refused')) {
      lines.push(''); lines.push(col('💡 Uruchom Mailpit: ', 'yellow') + col('docker compose --profile mail up -d', 'bold'));
    }
  } catch { lines.push(col(`❌ Błąd parsowania: ${out}`, 'red')); }
  return lines.join('\n');
}

function handleEmailSend(args) {
  const to = args[0];
  const subject = args[1] || 'Test z Broxeen CLI';
  const body = args.slice(2).join(' ') || `Wiadomość testowa z Broxeen CLI.\nCzas: ${new Date().toISOString()}`;

  if (!to || !to.includes('@')) return col('Użycie: .email send <adres@email> [temat] [treść]', 'yellow');

  const c = getEmailConfig();
  const noauth = !c.smtp_user || c.smtp_user === 'test@broxeen.local';
  const emlFile = `/tmp/broxeen_msg_${Date.now()}.eml`;
  const emailContent = [
    `From: ${c.from_addr}`, `To: ${to}`, `Subject: ${subject}`,
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`, ``, body,
  ].join('\r\n');

  const script = `
import smtplib, sys
msg = open('${emlFile}', 'rb').read()
try:
    s = smtplib.SMTP('${c.smtp_host}', ${c.smtp_port}, timeout=10)
    s.ehlo()
    ${c.use_tls ? 's.starttls(); s.ehlo()' : '# no TLS'}
    ${noauth ? '# no auth' : `s.login('${c.smtp_user}', '${c.smtp_pass}')`}
    s.sendmail('${c.from_addr}', ['${to}'], msg)
    s.quit()
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
`;

  try {
    writeFileSync(emlFile, emailContent);
    const out = runPythonScript(script);
    try { unlinkSync(emlFile); } catch {}
    if (out !== null && out.trim() === 'OK') {
      return [
        col('✅ Email wysłany!', 'green'),
        `  Do: ${to}`, `  Temat: ${subject}`,
        `  SMTP: ${c.smtp_host}:${c.smtp_port}`, '',
        col(`  🌐 Podgląd: http://localhost:8025`, 'cyan'),
      ].join('\n');
    }
    return col(`❌ Błąd wysyłki: ${out || 'timeout/brak odpowiedzi'}`, 'red');
  } catch (e) {
    try { unlinkSync(emlFile); } catch {}
    return col(`❌ Błąd: ${e.message}`, 'red');
  }
}

function handleEmailInbox(args) {
  const max = parseInt(args[0]) || 10;
  const c = getEmailConfig();

  // For local Mailpit: use REST API (no IMAP needed)
  if (c.smtp_host === 'localhost' || c.smtp_host === '127.0.0.1') {
    const apiUrl = `http://localhost:8025/api/v1/messages?limit=${max}`;
    const out = run(`curl -sf "${apiUrl}"`, 8000);
    if (!out) {
      return [
        col('❌ Mailpit REST API niedostępna', 'red'),
        `  Sprawdź czy Mailpit działa: ${col('docker compose --profile mail up -d mailpit', 'bold')}`,
        `  Oczekiwany URL: http://localhost:8025`,
      ].join('\n');
    }
    try {
      const r = JSON.parse(out);
      const msgs = r.messages || [];
      const total = r.total ?? msgs.length;
      const lines = [
        col(`📪 Skrzynka Mailpit (http://localhost:8025)`, 'bold', 'cyan'),
        `  Łącznie: ${total} wiadomości`, '',
      ];
      if (msgs.length === 0) {
        lines.push(col('  📭 Skrzynka pusta', 'dim'));
      } else {
        msgs.forEach((msg, i) => {
          lines.push(`  ${i + 1}. 📩 ${col(msg.Subject || '(brak tematu)', 'bold')}`);
          lines.push(`     Do: ${msg.To?.map(t => t.Address).join(', ') || '?'}`);
          lines.push(`     Od: ${msg.From?.Address || '?'}`);
          lines.push(`     ${col(msg.Created || '', 'dim')}`);
          lines.push('');
        });
      }
      lines.push(col('  🌐 Web UI: http://localhost:8025', 'cyan'));
      return lines.join('\n');
    } catch { return col(`❌ Błąd parsowania odpowiedzi API: ${out.slice(0, 100)}`, 'red'); }
  }

  // For remote IMAP servers: use Python imaplib
  const noauth = !c.smtp_user;
  const script = `
import imaplib, email, json, sys
from email.header import decode_header

def dec(s):
    if not s: return ''
    parts = []
    for part, cs in decode_header(s):
        if isinstance(part, bytes):
            parts.append(part.decode(cs or 'utf-8', errors='replace'))
        else:
            parts.append(str(part))
    return ' '.join(parts)

try:
    ${c.use_tls
      ? `m = imaplib.IMAP4_SSL('${c.imap_host}', ${c.imap_port})`
      : `m = imaplib.IMAP4('${c.imap_host}', ${c.imap_port})`}
    ${noauth ? '# no auth' : `m.login('${c.smtp_user}', '${c.smtp_pass}')`}
    m.select('INBOX')
    _, all_data = m.search(None, 'ALL')
    all_ids = all_data[0].split() if all_data[0] else []
    _, unseen_data = m.search(None, 'UNSEEN')
    unseen_ids = unseen_data[0].split() if unseen_data[0] else []
    fetch_ids = list(reversed(all_ids[-${max}:] if len(all_ids) > ${max} else all_ids))
    msgs = []
    for mid in fetch_ids:
        _, data = m.fetch(mid, '(FLAGS BODY.PEEK[HEADER])')
        if not data or not data[0]: continue
        raw = data[0][1]
        msg = email.message_from_bytes(raw)
        flags = str(data[0][0])
        msgs.append({
            'id': mid.decode(),
            'from': dec(msg.get('From', '')),
            'subject': dec(msg.get('Subject', '(brak tematu)')),
            'date': msg.get('Date', ''),
            'is_read': '\\\\Seen' in flags,
        })
    m.close(); m.logout()
    print(json.dumps({'total': len(all_ids), 'unread': len(unseen_ids), 'messages': msgs}))
except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)
`;

  const out = runPythonScript(script);
  if (!out) return col('❌ python3 niedostępny lub timeout', 'red');
  try {
    const r = JSON.parse(out);
    if (r.error) return col(`❌ IMAP błąd: ${r.error}`, 'red');
    const lines = [
      col(`📪 Skrzynka IMAP (${c.imap_host}:${c.imap_port})`, 'bold', 'cyan'),
      `  Łącznie: ${r.total} | Nieprzeczytane: ${r.unread}`, '',
    ];
    if (!r.messages || r.messages.length === 0) {
      lines.push(col('  📭 Skrzynka pusta', 'dim'));
    } else {
      r.messages.forEach((msg, i) => {
        const icon = msg.is_read ? '📭' : col('📩', 'yellow');
        lines.push(`  ${i + 1}. ${icon} ${col(msg.subject, 'bold')}`);
        lines.push(`     Od: ${msg.from}`);
        lines.push(`     ${col(msg.date, 'dim')}`);
        lines.push('');
      });
    }
    return lines.join('\n');
  } catch { return col(`❌ Błąd parsowania: ${out}`, 'red'); }
}

function showEmailHelp() {
  return [
    col('Komendy email:', 'bold'),
    '  .email test                       — test połączenia SMTP+IMAP',
    '  .email send <to> [temat] [treść]  — wyślij email',
    '  .email inbox [max=10]             — pokaż skrzynkę odbiorczą',
    '  .email config                     — pokaż konfigurację',
    '',
    col('Zmienne środowiskowe:', 'bold'),
    '  BROXEEN_SMTP_HOST     (domyślnie: localhost)',
    '  BROXEEN_SMTP_PORT     (domyślnie: 1025)',
    '  BROXEEN_SMTP_USER     (domyślnie: test@broxeen.local)',
    '  BROXEEN_SMTP_PASSWORD',
    '  BROXEEN_IMAP_HOST     (domyślnie: localhost)',
    '  BROXEEN_IMAP_PORT     (domyślnie: 1143)',
    '  BROXEEN_EMAIL_FROM',
    '  BROXEEN_EMAIL_TLS     (domyślnie: false)',
    '',
    col('Lokalny serwer testowy (Mailpit):', 'bold'),
    '  docker compose --profile mail up -d',
    '  Web UI: http://localhost:8025',
  ].join('\n');
}

// ── App API integration ───────────────────────────────────────────────────────
const APP_URL = process.env.BROXEEN_URL || 'http://localhost:5173';

async function askApp(query, scope) {
  try {
    const res = await fetch(`${APP_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, scope }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.data || data.result || JSON.stringify(data);
  } catch { return null; }
}

// ── Monitor CLI handler ──────────────────────────────────────────────────────

async function handleMonitorCommand(sub, args) {
  const queries = {
    list:   'aktywne monitoringi',
    logs:   'pokaż logi monitoringu',
    config: 'zmien interwał co ' + (args[0] || '30s'),
  };

  const query = queries[sub];
  if (!query) {
    return [
      col('Użycie: .monitor <sub>', 'yellow'),
      '  .monitor list           — aktywne monitoringi',
      '  .monitor logs           — ostatnie logi',
      '  .monitor config [10s]   — zmień interwał',
    ].join('\n');
  }

  const result = await askApp(query, currentScope);
  const isRealResult = result && !/LLM niedost|chat:fallback|Intent:/i.test(result);
  if (isRealResult) return col('[app:monitor] ', 'blue') + result;

  // Fallback: show config from env
  if (sub === 'config') {
    return [
      col('⚙️  Monitor config (domyślna):', 'bold', 'cyan'),
      `  Interwał:  30000 ms (30s)`,
      `  Próg zmian: 15%`,
      `  LLM próg:  25%`,
      `  Miniaturka: 500px`,
      '',
      col('💡 Uruchom aplikację i wpisz "aktywne monitoringi" aby zarządzać.', 'dim'),
    ].join('\n');
  }

  return [
    col('⚠️  App niedostępna na ' + APP_URL, 'yellow'),
    `   Uruchom: ${col('make dev', 'bold')} i spróbuj ponownie.`,
    '',
    col('Komendy czatu (po uruchomieniu app):', 'dim'),
    '  aktywne monitoringi',
    '  pokaż logi monitoringu',
    '  zmien interwał co 10s',
    '  ustaw próg zmian 20%',
    '  stop wszystkie monitoringi',
  ].join('\n');
}

// ── Frigate CLI handler ───────────────────────────────────────────────────────

function getFrigateConfig() {
  return {
    baseUrl:    process.env.BROXEEN_FRIGATE_URL      || 'http://localhost:5000',
    mqttHost:   process.env.BROXEEN_MQTT_HOST        || 'localhost',
    mqttPort:   process.env.BROXEEN_MQTT_PORT        || '1883',
    mqttTopic:  process.env.BROXEEN_MQTT_TOPIC       || 'frigate/events',
    labels:     process.env.BROXEEN_FRIGATE_LABELS   || 'person,car',
    cooldownMs: process.env.BROXEEN_FRIGATE_COOLDOWN || '60000',
  };
}

async function handleFrigateCommand(sub) {
  if (sub === 'config') {
    const c = getFrigateConfig();
    return [
      col('🦅 Frigate config:', 'bold', 'cyan'),
      `  Base URL:  ${c.baseUrl}`,
      `  MQTT:      ${c.mqttHost}:${c.mqttPort}`,
      `  Topic:     ${c.mqttTopic}`,
      `  Labels:    ${c.labels}`,
      `  Cooldown:  ${Math.round(+c.cooldownMs / 1000)}s`,
      '',
      col('Zmienne środowiskowe:', 'dim'),
      '  BROXEEN_FRIGATE_URL, BROXEEN_MQTT_HOST, BROXEEN_MQTT_PORT',
      '  BROXEEN_MQTT_TOPIC, BROXEEN_FRIGATE_LABELS, BROXEEN_FRIGATE_COOLDOWN',
    ].join('\n');
  }

  if (sub === 'status') {
    const c = getFrigateConfig();
    const lines = [col('🦅 Frigate NVR status:', 'bold', 'cyan')];

    // Check MQTT broker reachability via nc
    if (tools.nc) {
      const mqttReach = run(`nc -zv -w2 ${c.mqttHost} ${c.mqttPort} 2>&1`);
      const mqttOk = mqttReach && /succeeded|Connected|open/i.test(mqttReach);
      lines.push(`  MQTT ${c.mqttHost}:${c.mqttPort}: ${mqttOk ? col('✅ osiągalny', 'green') : col('❌ niedostępny', 'red')}`);
    } else {
      lines.push(`  MQTT ${c.mqttHost}:${c.mqttPort}: ${col('(nc niedostępny — nie można sprawdzić)', 'dim')}`);
    }

    // Check Frigate HTTP API
    const frigateApi = run(`curl -sf --max-time 3 "${c.baseUrl}/api/version" 2>/dev/null`, 5000);
    if (frigateApi) {
      lines.push(`  Frigate API ${c.baseUrl}: ${col('✅ dostępny', 'green')} — ${frigateApi.slice(0, 80)}`);
    } else {
      lines.push(`  Frigate API ${c.baseUrl}: ${col('❌ niedostępny', 'red')}`);
    }

    // Check via app API
    const appResult = await askApp('frigate status', currentScope);
    if (appResult) {
      lines.push('', col('[app:frigate] ', 'blue') + appResult);
    } else {
      lines.push('', col('💡 Uruchom aplikację aby zobaczyć pełny status MQTT.', 'dim'));
    }

    return lines.join('\n');
  }

  if (sub === 'start' || sub === 'stop') {
    const result = await askApp(`frigate ${sub}`, currentScope);
    const isReal = result && !/LLM niedost|chat:fallback|Intent:/i.test(result);
    if (isReal) return col(`[app:frigate] `, 'blue') + result;
    return [
      col(`⚠️  App niedostępna lub brak obsługi Frigate.`, 'yellow'),
      `   Uruchom: ${col('make dev', 'bold')} (Tauri: ${col('make tauri-dev', 'bold')})`,
      '',
      col('Frigate start/stop wymaga Tauri runtime (MQTT).', 'dim'),
    ].join('\n');
  }

  return [
    col('Użycie: .frigate <sub>', 'yellow'),
    '  .frigate status   — sprawdź MQTT + Frigate API',
    '  .frigate config   — pokaż konfigurację',
    '  .frigate start    — uruchom nasłuch (przez app)',
    '  .frigate stop     — zatrzymaj nasłuch (przez app)',
  ].join('\n');
}

// ── Comparison mode ───────────────────────────────────────────────────────────
async function runComparison() {
  console.log('\n' + col('🔬 Porównanie: CLI (system) vs App (plugin)', 'bold', 'cyan'));
  console.log(col('─'.repeat(55), 'dim'));

  console.log('\n' + col('【CLI — ip/nmap】', 'bold', 'green'));
  console.log(handleScan('skanuj sieć'));

  console.log('\n' + col('【App — NetworkScanPlugin】', 'bold', 'blue'));
  const appResult = await askApp('skanuj sieć', currentScope);
  if (appResult) {
    console.log(appResult);
  } else {
    console.log(col('⚠️  App niedostępna na ' + APP_URL, 'yellow'));
    console.log('   Uruchom: ' + col('pnpm dev', 'bold'));
  }
}

// ── REPL ──────────────────────────────────────────────────────────────────────
let currentScope = 'network';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
let _pendingAsync = 0;

function showPrompt() {
  process.stdout.write(`\n${col('broxeen', 'cyan', 'bold')}${col(`[${currentScope}]`, 'gray')} ${col('❯', 'dim')} `);
}

console.log(col('\n🦊 Broxeen Chat CLI', 'bold', 'cyan'));
console.log(col('   .help — komendy  |  Ctrl+C — wyjście', 'dim'));
console.log(col(`   App: ${APP_URL}`, 'dim'));
showPrompt();

rl.on('line', async line => {
  const input = line.trim();
  if (!input) { showPrompt(); return; }

  if (input === '.exit' || input === 'exit') { rl.close(); process.exit(0); }

  _pendingAsync++;
  try {

    if (input === '.status') {
      const lip = getLocalIp();
      console.log(`\n📍 Lokalny IP: ${lip || 'nie wykryto'}`);
      console.log(`🔭 Podsieć: ${subnet(lip)}.0/24`);
      console.log(Object.entries(tools).map(([k,v]) => `  ${v ? '✅' : '❌'} ${k}`).join('\n'));
    } else if (input === '.compare') {
      await runComparison();
    } else if (input === '.help') {
      console.log('\n' + showHelp());
    } else if (input.startsWith('.devices')) {
      const arg = input.split(/\s+/)[1] || '';
      console.log('\n' + handleDevices(arg || undefined));
    } else if (input === '.plugins') {
      console.log('\n' + await handlePlugins());
    } else if (input.startsWith('.db')) {
      const args = input.split(/\s+/).slice(1);
      console.log('\n' + handleDbCommand(args));
    } else if (input.startsWith('.config')) {
      const args = input.split(/\s+/).slice(1);
      console.log('\n' + handleConfig(args));
    } else if (input.startsWith('.scope')) {
      const s = input.split(/\s+/)[1];
      if (s) { currentScope = s; console.log(`\n✅ Scope → ${s}`); }
      else console.log(`\nScope: ${currentScope}`);
    } else if (input.startsWith('.monitor')) {
      const parts = input.split(/\s+/);
      const sub = parts[1] || 'list';
      const rest = parts.slice(2);
      console.log('\n' + await handleMonitorCommand(sub, rest));
    } else if (input.startsWith('.frigate')) {
      const parts = input.split(/\s+/);
      const sub = parts[1] || 'status';
      console.log('\n' + await handleFrigateCommand(sub));
    } else if (input.startsWith('.email')) {
      const parts = input.split(/\s+/);
      const sub = parts[1];
      const rest = parts.slice(2);
      if (!sub || sub === 'help') {
        console.log('\n' + showEmailHelp());
      } else if (sub === 'test') {
        console.log('\n' + handleEmailTest());
      } else if (sub === 'send') {
        console.log('\n' + handleEmailSend(rest));
      } else if (sub === 'inbox') {
        console.log('\n' + handleEmailInbox(rest));
      } else if (sub === 'config') {
        const c = getEmailConfig();
        console.log('\n' + col('⚙️  Email config:', 'bold', 'cyan'));
        console.log(`  SMTP: ${c.smtp_host}:${c.smtp_port}  (tls=${c.use_tls})`);
        console.log(`  IMAP: ${c.imap_host}:${c.imap_port}`);
        console.log(`  User: ${c.smtp_user}`);
        console.log(`  From: ${c.from_addr}`);
        console.log(`  Pass: ${c.smtp_pass ? '***' : col('(nie ustawione)', 'dim')}`);
      } else {
        console.log('\n' + col(`Nieznana komenda: .email ${sub}. Użyj .email help`, 'yellow'));
      }
    } else {
      const intent = detectIntent(input);
      let result;
      switch (intent) {
        case 'network:ping':      result = handlePing(input); break;
        case 'network:arp':       result = handleArp(); break;
        case 'network:port-scan': result = handlePortScan(input); break;
        case 'network:find-rpi':  result = handleFindRpi(input); break;
        case 'network:scan':
        case 'camera:onvif':      result = handleScan(input); break;
        case 'browse:url':        result = await handleBrowse(input); break;
        case 'monitor:list':
        case 'monitor:logs':
        case 'monitor:config': {
          const appResult = await askApp(input, currentScope);
          result = appResult
            ? col('[app:monitor] ', 'blue') + appResult
            : [
                `👁️  **Monitoring** *(tryb CLI)*`,
                ``,
                `ℹ️  Zarządzanie monitoringiem działa w kontekście aplikacji.`,
                `   Uruchom aplikację i wpisz komendę w czacie.`,
                ``,
                col('Komendy czatu:', 'dim'),
                '  aktywne monitoringi',
                '  zmien interwał co 10s',
                '  ustaw próg zmian 20%',
                '  stop wszystkie monitoringi',
                ``,
                `💡 Uruchom: ${col('make dev', 'bold')} i spróbuj ponownie.`,
              ].join('\n');
          break;
        }
        case 'frigate:status':
        case 'frigate:start':
        case 'frigate:stop': {
          const appResult = await askApp(input, currentScope);
          result = appResult
            ? col('[app:frigate] ', 'blue') + appResult
            : await handleFrigateCommand(intent.split(':')[1]);
          break;
        }
        case 'system:processes': {
          const appResult = await askApp(input, currentScope);
          result = appResult
            ? col('[app:processes] ', 'blue') + appResult
            : [
                `📋 **Procesy** *(tryb CLI)*`,
                ``,
                `ℹ️  Rejestr procesów działa w kontekście przeglądarki/Tauri.`,
                `   Uruchom aplikację i wpisz "procesy" w czacie, aby zobaczyć`,
                `   aktywne monitoringi i zadania.`,
                ``,
                `💡 Uruchom: ${col('pnpm dev', 'bold')} i spróbuj ponownie.`,
              ].join('\n');
          break;
        }
        default: {
          const appResult = await askApp(input, currentScope);
          result = appResult
            ? col('[app] ', 'blue') + appResult
            : `ℹ️  Intent: ${col(intent, 'yellow')}\n💬 LLM niedostępny w CLI. Uruchom aplikację: ${APP_URL}`;
        }
      }
      console.log('\n' + result);
    }
  } catch (e) {
    console.log(`\n${col('❌ Błąd:', 'red')} ${e.message}`);
  } finally {
    _pendingAsync--;
    showPrompt();
  }
});

rl.on('close', () => {
  const waitAndExit = () => {
    if (_pendingAsync > 0) { setTimeout(waitAndExit, 50); return; }
    console.log('\n👋 Do widzenia!');
    process.exit(0);
  };
  waitAndExit();
});

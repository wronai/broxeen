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
  { name: 'network:scan',      re: /skanuj\s+sieć|scan\s+net|pokaż\s+kamery|kamery\s+w\s+sieci|urządzenia\s+w\s+sieci|znajdź\s+urządzenia/i },
  { name: 'browse:url',        re: /https?:\/\/\S+/i },
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
    const hasCam = ports.some(p => [554, 8554, 8000, 8080].includes(p));
    return { ip, ports, hasCam };
  });
}

function handleScan(q) {
  const isCam = /kamer|camera/i.test(q);
  const localIp = getLocalIp();
  const sub = subnet(localIp);
  const lines = [
    isCam ? `📷 **Skanowanie kamer** *(tryb systemowy)*` : `🔍 **Skanowanie sieci** *(tryb systemowy)*`,
    `🌐 Podsieć: ${sub}.0/24 | Lokalny IP: ${localIp || 'nie wykryto'}\n`,
  ];

  const arp = parseArpEntries();
  if (arp.length) {
    lines.push(`**ARP cache (${arp.length} hostów):**`);
    for (const { ip, mac, state } of arp) {
      lines.push(`  📍 ${ip}${mac ? ` [${mac}]` : ''} (${state})`);
      if (isCam) lines.push(`     🎥 RTSP: \`rtsp://${ip}:554/stream\``);
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
      const hosts = parseNmapHosts(nmapOut);
      lines.push(`**nmap — ${hosts.length} hostów:**`);
      for (const { ip, ports, hasCam: hc } of hosts) {
        lines.push(`  ${hc ? '📷' : '🖥️'} **${ip}**${ports.length ? ` ports: ${ports.join(',')}` : ''}`);
        if (hc) lines.push(`     🎥 RTSP: \`rtsp://${ip}:554/stream\``);
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

// ── App API integration ───────────────────────────────────────────────────────
const APP_URL = process.env.BROXEEN_URL || 'http://localhost:5173';

async function askApp(query, scope) {
  try {
    const res = await fetch(`${APP_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, scope }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.data || data.result || JSON.stringify(data);
  } catch { return null; }
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

const rl = createInterface({ input: process.stdin, output: process.stdout });

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

  if (input === '.status') {
    const lip = getLocalIp();
    console.log(`\n📍 Lokalny IP: ${lip || 'nie wykryto'}`);
    console.log(`🔭 Podsieć: ${subnet(lip)}.0/24`);
    console.log(Object.entries(tools).map(([k,v]) => `  ${v ? '✅' : '❌'} ${k}`).join('\n'));
    showPrompt(); return;
  }

  if (input === '.compare') { await runComparison(); showPrompt(); return; }

  if (input === '.help') { console.log('\n' + showHelp()); showPrompt(); return; }

  if (input.startsWith('.scope')) {
    const s = input.split(/\s+/)[1];
    if (s) { currentScope = s; console.log(`\n✅ Scope → ${s}`); }
    else console.log(`\nScope: ${currentScope}`);
    showPrompt(); return;
  }

  const intent = detectIntent(input);
  let result;
  try {
    switch (intent) {
      case 'network:ping':      result = handlePing(input); break;
      case 'network:arp':       result = handleArp(); break;
      case 'network:port-scan': result = handlePortScan(input); break;
      case 'network:scan':
      case 'camera:onvif':      result = handleScan(input); break;
      case 'browse:url':        result = await handleBrowse(input); break;
      default: {
        const appResult = await askApp(input, currentScope);
        result = appResult
          ? col('[app] ', 'blue') + appResult
          : `ℹ️  Intent: ${col(intent, 'yellow')}\n💬 LLM niedostępny w CLI. Uruchom aplikację: ${APP_URL}`;
      }
    }
    console.log('\n' + result);
  } catch (e) {
    console.log(`\n${col('❌ Błąd:', 'red')} ${e.message}`);
  }
  showPrompt();
});

rl.on('close', () => { console.log('\n👋 Do widzenia!'); process.exit(0); });

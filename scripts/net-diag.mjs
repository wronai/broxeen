#!/usr/bin/env node
/**
 * Broxeen Network Diagnostics
 * Compares: system tools (ip/arp/nmap) vs what the chat plugin shows
 *
 * Usage:
 *   node scripts/net-diag.mjs            — full report
 *   node scripts/net-diag.mjs --cameras  — camera-focused scan
 *   node scripts/net-diag.mjs --compare  — side-by-side with app plugin
 */

import { execSync } from 'child_process';
import { networkInterfaces } from 'os';

const ARGS = process.argv.slice(2);
const MODE_CAM = ARGS.includes('--cameras');
const MODE_CMP = ARGS.includes('--compare');
const APP_URL  = process.env.BROXEEN_URL || 'http://localhost:5173';

// ── ANSI ─────────────────────────────────────────────────────────────────────
const C = { reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m', cyan:'\x1b[36m',
            green:'\x1b[32m', yellow:'\x1b[33m', red:'\x1b[31m', blue:'\x1b[34m', gray:'\x1b[90m' };
const col = (t, ...k) => k.map(x => C[x]).join('') + t + C.reset;
const sep = (c = '─', n = 60) => col(c.repeat(n), 'dim');

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, timeoutMs = 15000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe','pipe','pipe'] }).trim();
  } catch { return null; }
}
const has = n => !!run(`which ${n}`);

function getLocalIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const a of ifaces) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

// ── Tool check ────────────────────────────────────────────────────────────────
const tools = {
  ip:     has('ip'),
  arp:    has('arp'),
  nmap:   has('nmap'),
  nc:     has('nc'),
  avahi:  has('avahi-browse'),
  ping:   has('ping'),
};

function printTools() {
  console.log(col('\n🔧 Dostępne narzędzia systemowe:', 'bold'));
  for (const [k, v] of Object.entries(tools)) {
    console.log(`   ${v ? col('✅', 'green') : col('❌', 'red')} ${k}`);
  }
}

// ── Local network info ────────────────────────────────────────────────────────
function printLocalInfo(localIp, sub) {
  console.log(col('\n📍 Interfejsy sieciowe:', 'bold'));
  const ifaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (!a.internal) {
        console.log(`   ${col(name, 'cyan')}: ${a.address} (${a.family}) mac=${a.mac}`);
      }
    }
  }
  console.log(`\n   Wybrany IP: ${col(localIp || '?', 'yellow')}  Podsieć: ${col(sub + '.0/24', 'yellow')}`);
}

// ── ARP / Neighbours ──────────────────────────────────────────────────────────
function getArpEntries() {
  const raw = tools.ip ? run('ip neigh show') : (tools.arp ? run('arp -a') : null);
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const ip  = line.match(/^(\d[\d.]+)/)?.[1];
    const mac = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i)?.[1];
    const state = /REACH/.test(line) ? 'reachable' : /STALE/.test(line) ? 'stale' : /FAILED/.test(line) ? 'failed' : 'known';
    return ip ? { ip, mac: mac || null, state } : null;
  }).filter(Boolean);
}

function printArp(entries) {
  console.log(col('\n📋 ARP cache / sąsiedzi:', 'bold'));
  if (!entries.length) {
    console.log(col('   (brak wpisów)', 'dim'));
    return;
  }
  for (const { ip, mac, state } of entries) {
    const stateColor = state === 'reachable' ? 'green' : state === 'failed' ? 'red' : 'yellow';
    console.log(`   📍 ${col(ip.padEnd(16), 'cyan')} mac=${mac || '??:??:??:??:??:??'}  ${col(state, stateColor)}`);
  }
  console.log(`   Łącznie: ${entries.length} wpisów`);
}

// ── Routing table ─────────────────────────────────────────────────────────────
function printRoutes() {
  console.log(col('\n🗺️  Trasy IP:', 'bold'));
  const out = tools.ip ? run('ip route show') : null;
  if (!out) { console.log(col('   (ip route niedostępny)', 'dim')); return; }
  out.split('\n').slice(0, 10).forEach(l => console.log('   ' + l));
}

// ── Ping sweep (ICMP) ─────────────────────────────────────────────────────────
async function pingBroadcast(sub) {
  if (!tools.ping) return [];
  console.log(col(`\n🏓 Ping sweep ${sub}.0/24 (1-20) ...`, 'bold'));

  // Rapid parallel ping for first 20 IPs
  const targets = Array.from({ length: 20 }, (_, i) => `${sub}.${i + 1}`);
  const results = await Promise.allSettled(
    targets.map(ip => new Promise(resolve => {
      const out = run(`ping -c1 -W1 ${ip} 2>/dev/null`);
      resolve({ ip, alive: !!out && out.includes('1 received') });
    }))
  );
  return results.map(r => r.value).filter(r => r.alive);
}

// ── nmap scan ─────────────────────────────────────────────────────────────────
function nmapScan(sub, cameraMode) {
  if (!tools.nmap) return null;
  const cmd = cameraMode
    ? `nmap -p 80,8080,554,8554,8000 --open -T4 ${sub}.0/24 2>/dev/null`
    : `nmap -sn -T4 ${sub}.0/24 2>/dev/null`;
  console.log(col(`\n🔍 nmap${cameraMode ? ' (porty kamer)' : ' ping sweep'} ${sub}.0/24 ...`, 'bold'));
  return run(cmd, 30000);
}

function parseNmapResult(out) {
  if (!out) return [];
  const hosts = [];
  for (const m of out.matchAll(/Nmap scan report for\s+(?:(\S+)\s+\()?(\d[\d.]+)/g)) {
    const hostname = m[1] || null;
    const ip = m[2];
    const block = out.slice(m.index, out.indexOf('\n\n', m.index) + 1);
    const ports = [...block.matchAll(/(\d+)\/tcp\s+open/g)].map(p => +p[1]);
    const mac = block.match(/MAC Address: ([0-9A-F:]+)/i)?.[1] || null;
    const vendor = block.match(/MAC Address:.*?\(([^)]+)\)/i)?.[1] || null;
    const hasCam = ports.some(p => [554, 8554, 8000, 8080].includes(p));
    hosts.push({ ip, hostname, ports, mac, vendor, hasCam });
  }
  return hosts;
}

function printNmapHosts(hosts, cameraMode) {
  if (!hosts.length) { console.log(col('   Nie znaleziono hostów', 'dim')); return; }
  for (const { ip, hostname, ports, mac, vendor, hasCam } of hosts) {
    const icon = hasCam ? '📷' : '🖥️ ';
    const label = hostname ? `${ip} (${hostname})` : ip;
    console.log(`   ${icon} ${col(label, 'cyan')}`);
    if (mac) console.log(`      MAC: ${mac}${vendor ? ` [${vendor}]` : ''}`);
    if (ports.length) {
      console.log(`      Porty: ${ports.join(', ')}`);
      if (cameraMode && (ports.includes(554) || ports.includes(8554))) {
        console.log(`      ${col('🎥 RTSP:', 'green')} \`rtsp://${ip}:554/stream\``);
      }
    }
  }
  console.log(`   Łącznie: ${hosts.length} hostów`);
}

// ── mDNS (avahi) ──────────────────────────────────────────────────────────────
function printMdns() {
  console.log(col('\n📡 mDNS / Bonjour (avahi):', 'bold'));
  if (!tools.avahi) {
    console.log(col('   avahi-browse niedostępny', 'dim'));
    console.log('   Zainstaluj: sudo apt install avahi-utils');
    return;
  }
  const out = run('avahi-browse -a -t -r 2>/dev/null', 10000);
  if (!out) { console.log(col('   Brak usług mDNS lub timeout', 'dim')); return; }
  out.split('\n').slice(0, 30).forEach(l => console.log('   ' + l));
}

// ── App plugin comparison ─────────────────────────────────────────────────────
async function compareWithApp(query) {
  console.log(col(`\n🔗 Porównanie z aplikacją (${APP_URL}/api/chat):`, 'bold', 'blue'));
  try {
    const res = await fetch(`${APP_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, scope: 'network' }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const content = data.content?.[0]?.data || data.result || JSON.stringify(data, null, 2);
    console.log(col('   [Plugin output]', 'green'));
    content.split('\n').forEach(l => console.log('   ' + l));
  } catch (e) {
    console.log(col(`   ⚠️  App niedostępna: ${e.message}`, 'yellow'));
    console.log('   Uruchom: ' + col('pnpm dev', 'bold') + '  i spróbuj ponownie');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const localIp = getLocalIp();
  const sub = localIp ? localIp.split('.').slice(0, 3).join('.') : '192.168.1';

  console.log(col('═'.repeat(60), 'cyan'));
  console.log(col('  🦊 Broxeen Network Diagnostics', 'bold', 'cyan'));
  console.log(col(`  Tryb: ${MODE_CAM ? 'KAMERY' : 'SIEĆ'}  |  Porównanie: ${MODE_CMP ? 'TAK' : 'NIE'}`, 'dim'));
  console.log(col('═'.repeat(60), 'cyan'));

  printTools();
  printLocalInfo(localIp, sub);
  printRoutes();

  // ARP
  const arpEntries = getArpEntries();
  printArp(arpEntries);

  // Ping sweep (quick)
  const pingAlive = await pingBroadcast(sub);
  if (pingAlive.length) {
    console.log(col(`\n🏓 Hosty odpowiadające na ping (${pingAlive.length}):`, 'bold'));
    pingAlive.forEach(({ ip }) => console.log(`   ✅ ${ip}`));
  }

  // nmap
  const nmapOut = nmapScan(sub, MODE_CAM);
  const nmapHosts = parseNmapResult(nmapOut);
  if (nmapOut !== null) {
    printNmapHosts(nmapHosts, MODE_CAM);
  }

  // mDNS
  printMdns();

  // Summary
  const allIps = new Set([
    ...arpEntries.filter(e => e.state !== 'failed').map(e => e.ip),
    ...pingAlive.map(h => h.ip),
    ...nmapHosts.map(h => h.ip),
  ]);
  const cameras = nmapHosts.filter(h => h.hasCam);

  console.log(sep());
  console.log(col('\n📊 Podsumowanie:', 'bold'));
  console.log(`   Wykryte hosty: ${col(String(allIps.size), 'green', 'bold')}`);
  console.log(`   Potencjalne kamery: ${col(String(cameras.length), cameras.length ? 'green' : 'dim', 'bold')}`);
  if (cameras.length) {
    cameras.forEach(({ ip }) => {
      console.log(`   📷 ${col(ip, 'cyan')}  →  rtsp://${ip}:554/stream`);
    });
  }

  // Compare with app
  if (MODE_CMP) {
    console.log(sep());
    await compareWithApp(MODE_CAM ? 'pokaż kamery w sieci' : 'skanuj sieć');
  } else {
    console.log(col(`\n💡 Dodaj --compare aby zobaczyć wynik pluginu aplikacji`, 'dim'));
    console.log(col(`   node scripts/net-diag.mjs --compare`, 'dim'));
  }

  console.log('');
}

main().catch(e => { console.error(col('❌ Błąd:', 'red'), e.message); process.exit(1); });

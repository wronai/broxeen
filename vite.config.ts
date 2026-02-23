import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { UserConfig as VitestUserConfig } from "vitest/config";
import type { Plugin } from "vite";
import { execSync } from "child_process";
import { networkInterfaces } from "os";

const host = process.env.TAURI_DEV_HOST || 'localhost';

// ── CLI Chat API plugin ───────────────────────────────────────────────────────
function chatApiPlugin(): Plugin {
  function run(cmd: string, timeout = 10000): string | null {
    try {
      return (execSync as any)(cmd, { encoding: 'utf8', timeout, stdio: ['pipe','pipe','pipe'] }).trim();
    } catch { return null; }
  }

  function getLocalIp(): string | null {
    for (const ifaces of Object.values(networkInterfaces() as any)) {
      for (const a of (ifaces as any[])) {
        if (a.family === 'IPv4' && !a.internal) return a.address;
      }
    }
    return null;
  }

  const INTENTS: [string, RegExp][] = [
    ['network:ping',      /ping\s+(\d[\d.]+)/i],
    ['network:port-scan', /(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i],
    ['network:arp',       /\barp\b|mac\s+address/i],
    ['camera:onvif',      /\bonvif\b|kamery\s+ip/i],
    ['network:scan',      /skanuj\s+sieć|scan\s+net|pokaż\s+kamery|kamery\s+w\s+sieci|urządzenia\s+w\s+sieci|discover/i],
    ['browse:url',        /https?:\/\/\S+/i],
  ];

  function detectIntent(q: string): string {
    for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
    return 'chat:fallback';
  }

  function parseArpEntries() {
    const raw = run('ip neigh show') ?? run('arp -a');
    if (!raw) return [];
    return raw.split('\n').map(line => {
      const ip  = line.match(/^(\d[\d.]+)/)?.[1];
      const mac = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i)?.[1];
      const state = /REACH/.test(line) ? 'reachable' : /STALE/.test(line) ? 'stale' : 'known';
      return ip ? { ip, mac: mac ?? null, state } : null;
    }).filter(Boolean) as Array<{ip:string;mac:string|null;state:string}>;
  }

  function parseNmapHosts(out: string) {
    const hosts: Array<{ip:string;ports:number[];hasCam:boolean}> = [];
    for (const m of out.matchAll(/Nmap scan report for\s+(?:\S+\s+\()?([\d.]+)/g)) {
      const ip = m[1];
      const block = out.slice(m.index!, out.indexOf('\n\n', m.index!) + 1);
      const ports = [...block.matchAll(/(\d+)\/tcp\s+open/g)].map(p => +p[1]);
      hosts.push({ ip, ports, hasCam: ports.some(p => [554, 8554].includes(p)) });
    }
    return hosts;
  }

  function handleQuery(query: string, scope: string): { intent: string; content: Array<{type:string;data:string}> } {
    const intent = detectIntent(query);
    const isCam = /kamer|camera/i.test(query);
    const localIp = getLocalIp();
    const sub = localIp ? localIp.split('.').slice(0,3).join('.') : '192.168.1';
    const lines: string[] = [];

    switch (intent) {
      case 'network:ping': {
        const m = query.match(/ping\s+([\d.]+)/i);
        const ip = m?.[1] ?? '8.8.8.8';
        const out = run(`ping -c 3 -W 2 ${ip}`);
        lines.push(out ? `🔧 ping ${ip}\n\n${out}` : `❌ Nie można ping ${ip}`);
        break;
      }
      case 'network:arp': {
        const entries = parseArpEntries();
        lines.push('📋 **Tabela ARP**\n');
        if (entries.length) entries.forEach(e => lines.push(`  📍 ${e.ip} [${e.mac ?? '??'}] (${e.state})`));
        else lines.push('Brak wpisów ARP');
        break;
      }
      case 'network:port-scan': {
        const m = query.match(/(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i);
        const ip = m?.[1];
        if (!ip) { lines.push('❌ Podaj IP: "skanuj porty 192.168.1.100"'); break; }
        const out = run(`nmap -p 80,443,554,8000,8080,8554,22,23 -T4 ${ip} 2>/dev/null`, 20000);
        lines.push(out ? `🔍 **nmap ${ip}**\n\n${out}` : `❌ nmap niedostępny lub timeout`);
        break;
      }
      case 'network:scan':
      case 'camera:onvif': {
        lines.push(isCam ? `📷 **Skanowanie kamer** *(tryb systemowy)*\n` : `🔍 **Skanowanie sieci** *(tryb systemowy)*\n`);
        lines.push(`🌐 Podsieć: ${sub}.0/24 | IP: ${localIp ?? '?'}\n`);
        // ARP: show neighbours without RTSP speculation
        const arp = parseArpEntries().filter(e => e.state !== 'failed' && e.ip !== localIp);
        const wifiArp = arp.filter(e => e.ip.startsWith(sub + '.'));
        if (wifiArp.length) {
          lines.push(`**Sąsiedzi w sieci WiFi (${wifiArp.length}):**`);
          wifiArp.forEach(e => lines.push(`  📍 ${e.ip} [${e.mac ?? '??'}] (${e.state})`));
        }
        // nmap: camera ports only
        const nmapCmd = isCam
          ? `nmap -p 554,8554,80,8080,8000 --open -T4 ${sub}.0/24 2>/dev/null`
          : `nmap -sn -T4 ${sub}.0/24 2>/dev/null`;
        const nmapOut = run(nmapCmd, 30000);
        if (nmapOut) {
          const hosts = parseNmapHosts(nmapOut).filter(h => h.ip !== localIp);
          const cameras = hosts.filter(h => h.hasCam);
          const others  = hosts.filter(h => !h.hasCam);
          if (isCam) {
            lines.push(cameras.length
              ? `\n**📷 Kamery RTSP (${cameras.length}):**`
              : `\n⚠️ Nie wykryto kamer RTSP (port 554/8554 zamknięty na wszystkich hostach)`);
            cameras.forEach(h => {
              lines.push(`  📷 **${h.ip}** ports: ${h.ports.join(',')}`);
              lines.push(`     🎥 RTSP: \`rtsp://${h.ip}:554/stream\``);
            });
            if (others.length) {
              lines.push(`\n🖥️  Inne urządzenia (${others.length}):`);
              others.forEach(h => lines.push(`  🖥️  ${h.ip} ports: ${h.ports.join(',')}`))
            }
          } else {
            lines.push(`\n**Hosty w sieci (${hosts.length}):**`);
            hosts.forEach(h => lines.push(`  ${h.hasCam ? '📷' : '🖥️ '} ${h.ip}${h.ports.length ? ` [${h.ports.join(',')}]` : ''}`));
          }
        } else {
          lines.push('\n💡 Zainstaluj nmap: sudo apt install nmap');
        }
        break;
      }
      default:
        lines.push(`ℹ️  Intent: ${intent}\n💬 LLM niedostępny w trybie API CLI`);
    }

    return { intent, content: [{ type: 'text', data: lines.join('\n') }] };
  }

  return {
    name: 'broxeen-chat-api',
    configureServer(server) {
      server.middlewares.use('/api/chat', (req, res, next) => {
        if (req.method !== 'POST') { next(); return; }
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const result = handleQuery(body.query ?? '', body.scope ?? 'network');
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(result));
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      // Camera proxy — bypass CORS for HTTP snapshot fetch in browser mode
      server.middlewares.use('/api/camera-proxy', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
        if (!url) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
          return;
        }
        try {
          const parsedUrl = new URL(url);
          const basicUser = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : '';
          const basicPass = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : '';
          if (basicUser) {
            parsedUrl.username = '';
            parsedUrl.password = '';
          }

          const method = req.method === 'POST' ? 'POST' : 'GET';
          let body: string | undefined;
          if (method === 'POST') {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            body = Buffer.concat(chunks).toString();
          }

          const headers: Record<string, string> = {};
          if (body) headers['Content-Type'] = 'application/json';
          if (basicUser) {
            headers['Authorization'] = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;
          }

          const upstream = await fetch(parsedUrl.toString(), {
            method,
            body,
            headers: Object.keys(headers).length ? headers : undefined,
            signal: AbortSignal.timeout(10000),
          });
          const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'X-Proxy-Url': parsedUrl.toString(),
          });
          res.end(buffer);
        } catch (e: any) {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });

      server.middlewares.use('/api/net-diag', (_req, res) => {
        const localIp = getLocalIp();
        const arp = parseArpEntries();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ localIp, arp, ts: Date.now() }));
      });
    },
  };
}

export default defineConfig(async () => ({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    typecheck: { tsconfig: "./tsconfig.test.json" },
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/hooks/**"],
    },
  } as VitestUserConfig["test"],
  plugins: [react(), chatApiPlugin()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/@tauri-apps')) {
            return 'vendor-tauri';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-lucide';
          }
          if (id.includes('node_modules/')) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5173,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/venv/**",
        "**/.venv/**",
        "**/__pycache__/**",
        "**/dist/**",
        "**/target/**",
      ],
      usePolling: true,
      interval: 250,
    },
  },
}));

// vite.config.ts
import { defineConfig } from "file:///home/tom/github/wronai/broxeen/node_modules/.pnpm/vite@6.4.1_@types+node@25.3.0_jiti@1.21.7/node_modules/vite/dist/node/index.js";
import react from "file:///home/tom/github/wronai/broxeen/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@6.4.1_@types+node@25.3.0_jiti@1.21.7_/node_modules/@vitejs/plugin-react/dist/index.js";
import { execSync } from "child_process";
import { networkInterfaces } from "os";
var host = process.env.TAURI_DEV_HOST || "localhost";
function chatApiPlugin() {
  function run(cmd, timeout = 1e4) {
    try {
      return execSync(cmd, { encoding: "utf8", timeout, stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch {
      return null;
    }
  }
  function getLocalIp() {
    for (const ifaces of Object.values(networkInterfaces())) {
      for (const a of ifaces) {
        if (a.family === "IPv4" && !a.internal) return a.address;
      }
    }
    return null;
  }
  const INTENTS = [
    ["network:ping", /ping\s+(\d[\d.]+)/i],
    ["network:port-scan", /(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i],
    ["network:arp", /\barp\b|mac\s+address/i],
    ["camera:onvif", /\bonvif\b|kamery\s+ip/i],
    ["network:scan", /skanuj\s+sieć|scan\s+net|pokaż\s+kamery|kamery\s+w\s+sieci|urządzenia\s+w\s+sieci|discover/i],
    ["browse:url", /https?:\/\/\S+/i]
  ];
  function detectIntent(q) {
    for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
    return "chat:fallback";
  }
  function parseArpEntries() {
    const raw = run("ip neigh show") ?? run("arp -a");
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      const ip = line.match(/^(\d[\d.]+)/)?.[1];
      const mac = line.match(/([0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2})/i)?.[1];
      const state = /REACH/.test(line) ? "reachable" : /STALE/.test(line) ? "stale" : "known";
      return ip ? { ip, mac: mac ?? null, state } : null;
    }).filter(Boolean);
  }
  function parseNmapHosts(out) {
    const hosts = [];
    for (const m of out.matchAll(/Nmap scan report for\s+(?:\S+\s+\()?([\d.]+)/g)) {
      const ip = m[1];
      const block = out.slice(m.index, out.indexOf("\n\n", m.index) + 1);
      const ports = [...block.matchAll(/(\d+)\/tcp\s+open/g)].map((p) => +p[1]);
      hosts.push({ ip, ports, hasCam: ports.some((p) => [554, 8554].includes(p)) });
    }
    return hosts;
  }
  function handleQuery(query, scope) {
    const intent = detectIntent(query);
    const isCam = /kamer|camera/i.test(query);
    const localIp = getLocalIp();
    const sub = localIp ? localIp.split(".").slice(0, 3).join(".") : "192.168.1";
    const lines = [];
    switch (intent) {
      case "network:ping": {
        const m = query.match(/ping\s+([\d.]+)/i);
        const ip = m?.[1] ?? "8.8.8.8";
        const out = run(`ping -c 3 -W 2 ${ip}`);
        lines.push(out ? `\u{1F527} ping ${ip}

${out}` : `\u274C Nie mo\u017Cna ping ${ip}`);
        break;
      }
      case "network:arp": {
        const entries = parseArpEntries();
        lines.push("\u{1F4CB} **Tabela ARP**\n");
        if (entries.length) entries.forEach((e) => lines.push(`  \u{1F4CD} ${e.ip} [${e.mac ?? "??"}] (${e.state})`));
        else lines.push("Brak wpis\xF3w ARP");
        break;
      }
      case "network:port-scan": {
        const m = query.match(/(?:skanuj\s+porty|scan\s+ports?|nmap)\s+(\S+)/i);
        const ip = m?.[1];
        if (!ip) {
          lines.push('\u274C Podaj IP: "skanuj porty 192.168.1.100"');
          break;
        }
        const out = run(`nmap -p 80,443,554,8000,8080,8554,22,23 -T4 ${ip} 2>/dev/null`, 2e4);
        lines.push(out ? `\u{1F50D} **nmap ${ip}**

${out}` : `\u274C nmap niedost\u0119pny lub timeout`);
        break;
      }
      case "network:scan":
      case "camera:onvif": {
        lines.push(isCam ? `\u{1F4F7} **Skanowanie kamer** *(tryb systemowy)*
` : `\u{1F50D} **Skanowanie sieci** *(tryb systemowy)*
`);
        lines.push(`\u{1F310} Podsie\u0107: ${sub}.0/24 | IP: ${localIp ?? "?"}
`);
        const arp = parseArpEntries().filter((e) => e.state !== "failed" && e.ip !== localIp);
        const wifiArp = arp.filter((e) => e.ip.startsWith(sub + "."));
        if (wifiArp.length) {
          lines.push(`**S\u0105siedzi w sieci WiFi (${wifiArp.length}):**`);
          wifiArp.forEach((e) => lines.push(`  \u{1F4CD} ${e.ip} [${e.mac ?? "??"}] (${e.state})`));
        }
        const nmapCmd = isCam ? `nmap -p 554,8554,80,8080,8000 --open -T4 ${sub}.0/24 2>/dev/null` : `nmap -sn -T4 ${sub}.0/24 2>/dev/null`;
        const nmapOut = run(nmapCmd, 3e4);
        if (nmapOut) {
          const hosts = parseNmapHosts(nmapOut).filter((h) => h.ip !== localIp);
          const cameras = hosts.filter((h) => h.hasCam);
          const others = hosts.filter((h) => !h.hasCam);
          if (isCam) {
            lines.push(cameras.length ? `
**\u{1F4F7} Kamery RTSP (${cameras.length}):**` : `
\u26A0\uFE0F Nie wykryto kamer RTSP (port 554/8554 zamkni\u0119ty na wszystkich hostach)`);
            cameras.forEach((h) => {
              lines.push(`  \u{1F4F7} **${h.ip}** ports: ${h.ports.join(",")}`);
              lines.push(`     \u{1F3A5} RTSP: \`rtsp://${h.ip}:554/stream\``);
            });
            if (others.length) {
              lines.push(`
\u{1F5A5}\uFE0F  Inne urz\u0105dzenia (${others.length}):`);
              others.forEach((h) => lines.push(`  \u{1F5A5}\uFE0F  ${h.ip} ports: ${h.ports.join(",")}`));
            }
          } else {
            lines.push(`
**Hosty w sieci (${hosts.length}):**`);
            hosts.forEach((h) => lines.push(`  ${h.hasCam ? "\u{1F4F7}" : "\u{1F5A5}\uFE0F "} ${h.ip}${h.ports.length ? ` [${h.ports.join(",")}]` : ""}`));
          }
        } else {
          lines.push("\n\u{1F4A1} Zainstaluj nmap: sudo apt install nmap");
        }
        break;
      }
      default:
        lines.push(`\u2139\uFE0F  Intent: ${intent}
\u{1F4AC} LLM niedost\u0119pny w trybie API CLI`);
    }
    return { intent, content: [{ type: "text", data: lines.join("\n") }] };
  }
  return {
    name: "broxeen-chat-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const result = handleQuery(body.query ?? "", body.scope ?? "network");
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify(result));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
      server.middlewares.use("/api/camera-proxy", async (req, res) => {
        const url = new URL(req.url ?? "", "http://localhost").searchParams.get("url");
        if (!url) {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ error: "Missing ?url= parameter" }));
          return;
        }
        try {
          const parsedUrl = new URL(url);
          const basicUser = parsedUrl.username ? decodeURIComponent(parsedUrl.username) : "";
          const basicPass = parsedUrl.password ? decodeURIComponent(parsedUrl.password) : "";
          if (basicUser) {
            parsedUrl.username = "";
            parsedUrl.password = "";
          }
          const method = req.method === "POST" ? "POST" : "GET";
          let body;
          if (method === "POST") {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            body = Buffer.concat(chunks).toString();
          }
          const headers = {};
          if (body) headers["Content-Type"] = "application/json";
          if (basicUser) {
            headers["Authorization"] = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString("base64")}`;
          }
          const upstream = await fetch(parsedUrl.toString(), {
            method,
            body,
            headers: Object.keys(headers).length ? headers : void 0,
            signal: AbortSignal.timeout(1e4)
          });
          const contentType = upstream.headers.get("content-type") || "application/octet-stream";
          const buffer = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "X-Proxy-Url": parsedUrl.toString()
          });
          res.end(buffer);
        } catch (e) {
          res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      server.middlewares.use("/api/net-diag", (_req, res) => {
        const localIp = getLocalIp();
        const arp = parseArpEntries();
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ localIp, arp, ts: Date.now() }));
      });
    }
  };
}
var vite_config_default = defineConfig(async () => ({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    typecheck: { tsconfig: "./tsconfig.test.json" },
    testTimeout: 1e4,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/hooks/**"]
    }
  },
  plugins: [react(), chatApiPlugin()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@tauri-apps")) {
            return "vendor-tauri";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-lucide";
          }
          if (id.includes("node_modules/")) {
            return "vendor";
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? {
      protocol: "ws",
      host,
      port: 5173
    } : void 0,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/venv/**",
        "**/.venv/**",
        "**/__pycache__/**",
        "**/dist/**",
        "**/target/**"
      ],
      usePolling: true,
      interval: 250
    }
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS90b20vZ2l0aHViL3dyb25haS9icm94ZWVuXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS90b20vZ2l0aHViL3dyb25haS9icm94ZWVuL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3RvbS9naXRodWIvd3JvbmFpL2Jyb3hlZW4vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHR5cGUgeyBVc2VyQ29uZmlnIGFzIFZpdGVzdFVzZXJDb25maWcgfSBmcm9tIFwidml0ZXN0L2NvbmZpZ1wiO1xuaW1wb3J0IHR5cGUgeyBQbHVnaW4gfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHsgbmV0d29ya0ludGVyZmFjZXMgfSBmcm9tIFwib3NcIjtcblxuY29uc3QgaG9zdCA9IHByb2Nlc3MuZW52LlRBVVJJX0RFVl9IT1NUIHx8ICdsb2NhbGhvc3QnO1xuXG4vLyBcdTI1MDBcdTI1MDAgQ0xJIENoYXQgQVBJIHBsdWdpbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbmZ1bmN0aW9uIGNoYXRBcGlQbHVnaW4oKTogUGx1Z2luIHtcbiAgZnVuY3Rpb24gcnVuKGNtZDogc3RyaW5nLCB0aW1lb3V0ID0gMTAwMDApOiBzdHJpbmcgfCBudWxsIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIChleGVjU3luYyBhcyBhbnkpKGNtZCwgeyBlbmNvZGluZzogJ3V0ZjgnLCB0aW1lb3V0LCBzdGRpbzogWydwaXBlJywncGlwZScsJ3BpcGUnXSB9KS50cmltKCk7XG4gICAgfSBjYXRjaCB7IHJldHVybiBudWxsOyB9XG4gIH1cblxuICBmdW5jdGlvbiBnZXRMb2NhbElwKCk6IHN0cmluZyB8IG51bGwge1xuICAgIGZvciAoY29uc3QgaWZhY2VzIG9mIE9iamVjdC52YWx1ZXMobmV0d29ya0ludGVyZmFjZXMoKSBhcyBhbnkpKSB7XG4gICAgICBmb3IgKGNvbnN0IGEgb2YgKGlmYWNlcyBhcyBhbnlbXSkpIHtcbiAgICAgICAgaWYgKGEuZmFtaWx5ID09PSAnSVB2NCcgJiYgIWEuaW50ZXJuYWwpIHJldHVybiBhLmFkZHJlc3M7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgSU5URU5UUzogW3N0cmluZywgUmVnRXhwXVtdID0gW1xuICAgIFsnbmV0d29yazpwaW5nJywgICAgICAvcGluZ1xccysoXFxkW1xcZC5dKykvaV0sXG4gICAgWyduZXR3b3JrOnBvcnQtc2NhbicsIC8oPzpza2FudWpcXHMrcG9ydHl8c2Nhblxccytwb3J0cz98bm1hcClcXHMrKFxcUyspL2ldLFxuICAgIFsnbmV0d29yazphcnAnLCAgICAgICAvXFxiYXJwXFxifG1hY1xccythZGRyZXNzL2ldLFxuICAgIFsnY2FtZXJhOm9udmlmJywgICAgICAvXFxib252aWZcXGJ8a2FtZXJ5XFxzK2lwL2ldLFxuICAgIFsnbmV0d29yazpzY2FuJywgICAgICAvc2thbnVqXFxzK3NpZVx1MDEwN3xzY2FuXFxzK25ldHxwb2thXHUwMTdDXFxzK2thbWVyeXxrYW1lcnlcXHMrd1xccytzaWVjaXx1cnpcdTAxMDVkemVuaWFcXHMrd1xccytzaWVjaXxkaXNjb3Zlci9pXSxcbiAgICBbJ2Jyb3dzZTp1cmwnLCAgICAgICAgL2h0dHBzPzpcXC9cXC9cXFMrL2ldLFxuICBdO1xuXG4gIGZ1bmN0aW9uIGRldGVjdEludGVudChxOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGZvciAoY29uc3QgW2ludGVudCwgcmVdIG9mIElOVEVOVFMpIGlmIChyZS50ZXN0KHEpKSByZXR1cm4gaW50ZW50O1xuICAgIHJldHVybiAnY2hhdDpmYWxsYmFjayc7XG4gIH1cblxuICBmdW5jdGlvbiBwYXJzZUFycEVudHJpZXMoKSB7XG4gICAgY29uc3QgcmF3ID0gcnVuKCdpcCBuZWlnaCBzaG93JykgPz8gcnVuKCdhcnAgLWEnKTtcbiAgICBpZiAoIXJhdykgcmV0dXJuIFtdO1xuICAgIHJldHVybiByYXcuc3BsaXQoJ1xcbicpLm1hcChsaW5lID0+IHtcbiAgICAgIGNvbnN0IGlwICA9IGxpbmUubWF0Y2goL14oXFxkW1xcZC5dKykvKT8uWzFdO1xuICAgICAgY29uc3QgbWFjID0gbGluZS5tYXRjaCgvKFswLTlhLWZdezJ9OlswLTlhLWZdezJ9OlswLTlhLWZdezJ9OlswLTlhLWZdezJ9OlswLTlhLWZdezJ9OlswLTlhLWZdezJ9KS9pKT8uWzFdO1xuICAgICAgY29uc3Qgc3RhdGUgPSAvUkVBQ0gvLnRlc3QobGluZSkgPyAncmVhY2hhYmxlJyA6IC9TVEFMRS8udGVzdChsaW5lKSA/ICdzdGFsZScgOiAna25vd24nO1xuICAgICAgcmV0dXJuIGlwID8geyBpcCwgbWFjOiBtYWMgPz8gbnVsbCwgc3RhdGUgfSA6IG51bGw7XG4gICAgfSkuZmlsdGVyKEJvb2xlYW4pIGFzIEFycmF5PHtpcDpzdHJpbmc7bWFjOnN0cmluZ3xudWxsO3N0YXRlOnN0cmluZ30+O1xuICB9XG5cbiAgZnVuY3Rpb24gcGFyc2VObWFwSG9zdHMob3V0OiBzdHJpbmcpIHtcbiAgICBjb25zdCBob3N0czogQXJyYXk8e2lwOnN0cmluZztwb3J0czpudW1iZXJbXTtoYXNDYW06Ym9vbGVhbn0+ID0gW107XG4gICAgZm9yIChjb25zdCBtIG9mIG91dC5tYXRjaEFsbCgvTm1hcCBzY2FuIHJlcG9ydCBmb3JcXHMrKD86XFxTK1xccytcXCgpPyhbXFxkLl0rKS9nKSkge1xuICAgICAgY29uc3QgaXAgPSBtWzFdO1xuICAgICAgY29uc3QgYmxvY2sgPSBvdXQuc2xpY2UobS5pbmRleCEsIG91dC5pbmRleE9mKCdcXG5cXG4nLCBtLmluZGV4ISkgKyAxKTtcbiAgICAgIGNvbnN0IHBvcnRzID0gWy4uLmJsb2NrLm1hdGNoQWxsKC8oXFxkKylcXC90Y3BcXHMrb3Blbi9nKV0ubWFwKHAgPT4gK3BbMV0pO1xuICAgICAgaG9zdHMucHVzaCh7IGlwLCBwb3J0cywgaGFzQ2FtOiBwb3J0cy5zb21lKHAgPT4gWzU1NCwgODU1NF0uaW5jbHVkZXMocCkpIH0pO1xuICAgIH1cbiAgICByZXR1cm4gaG9zdHM7XG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVRdWVyeShxdWVyeTogc3RyaW5nLCBzY29wZTogc3RyaW5nKTogeyBpbnRlbnQ6IHN0cmluZzsgY29udGVudDogQXJyYXk8e3R5cGU6c3RyaW5nO2RhdGE6c3RyaW5nfT4gfSB7XG4gICAgY29uc3QgaW50ZW50ID0gZGV0ZWN0SW50ZW50KHF1ZXJ5KTtcbiAgICBjb25zdCBpc0NhbSA9IC9rYW1lcnxjYW1lcmEvaS50ZXN0KHF1ZXJ5KTtcbiAgICBjb25zdCBsb2NhbElwID0gZ2V0TG9jYWxJcCgpO1xuICAgIGNvbnN0IHN1YiA9IGxvY2FsSXAgPyBsb2NhbElwLnNwbGl0KCcuJykuc2xpY2UoMCwzKS5qb2luKCcuJykgOiAnMTkyLjE2OC4xJztcbiAgICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXTtcblxuICAgIHN3aXRjaCAoaW50ZW50KSB7XG4gICAgICBjYXNlICduZXR3b3JrOnBpbmcnOiB7XG4gICAgICAgIGNvbnN0IG0gPSBxdWVyeS5tYXRjaCgvcGluZ1xccysoW1xcZC5dKykvaSk7XG4gICAgICAgIGNvbnN0IGlwID0gbT8uWzFdID8/ICc4LjguOC44JztcbiAgICAgICAgY29uc3Qgb3V0ID0gcnVuKGBwaW5nIC1jIDMgLVcgMiAke2lwfWApO1xuICAgICAgICBsaW5lcy5wdXNoKG91dCA/IGBcdUQ4M0RcdUREMjcgcGluZyAke2lwfVxcblxcbiR7b3V0fWAgOiBgXHUyNzRDIE5pZSBtb1x1MDE3Q25hIHBpbmcgJHtpcH1gKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICduZXR3b3JrOmFycCc6IHtcbiAgICAgICAgY29uc3QgZW50cmllcyA9IHBhcnNlQXJwRW50cmllcygpO1xuICAgICAgICBsaW5lcy5wdXNoKCdcdUQ4M0RcdURDQ0IgKipUYWJlbGEgQVJQKipcXG4nKTtcbiAgICAgICAgaWYgKGVudHJpZXMubGVuZ3RoKSBlbnRyaWVzLmZvckVhY2goZSA9PiBsaW5lcy5wdXNoKGAgIFx1RDgzRFx1RENDRCAke2UuaXB9IFske2UubWFjID8/ICc/Pyd9XSAoJHtlLnN0YXRlfSlgKSk7XG4gICAgICAgIGVsc2UgbGluZXMucHVzaCgnQnJhayB3cGlzXHUwMEYzdyBBUlAnKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlICduZXR3b3JrOnBvcnQtc2Nhbic6IHtcbiAgICAgICAgY29uc3QgbSA9IHF1ZXJ5Lm1hdGNoKC8oPzpza2FudWpcXHMrcG9ydHl8c2Nhblxccytwb3J0cz98bm1hcClcXHMrKFxcUyspL2kpO1xuICAgICAgICBjb25zdCBpcCA9IG0/LlsxXTtcbiAgICAgICAgaWYgKCFpcCkgeyBsaW5lcy5wdXNoKCdcdTI3NEMgUG9kYWogSVA6IFwic2thbnVqIHBvcnR5IDE5Mi4xNjguMS4xMDBcIicpOyBicmVhazsgfVxuICAgICAgICBjb25zdCBvdXQgPSBydW4oYG5tYXAgLXAgODAsNDQzLDU1NCw4MDAwLDgwODAsODU1NCwyMiwyMyAtVDQgJHtpcH0gMj4vZGV2L251bGxgLCAyMDAwMCk7XG4gICAgICAgIGxpbmVzLnB1c2gob3V0ID8gYFx1RDgzRFx1REQwRCAqKm5tYXAgJHtpcH0qKlxcblxcbiR7b3V0fWAgOiBgXHUyNzRDIG5tYXAgbmllZG9zdFx1MDExOXBueSBsdWIgdGltZW91dGApO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ25ldHdvcms6c2Nhbic6XG4gICAgICBjYXNlICdjYW1lcmE6b252aWYnOiB7XG4gICAgICAgIGxpbmVzLnB1c2goaXNDYW0gPyBgXHVEODNEXHVEQ0Y3ICoqU2thbm93YW5pZSBrYW1lcioqICoodHJ5YiBzeXN0ZW1vd3kpKlxcbmAgOiBgXHVEODNEXHVERDBEICoqU2thbm93YW5pZSBzaWVjaSoqICoodHJ5YiBzeXN0ZW1vd3kpKlxcbmApO1xuICAgICAgICBsaW5lcy5wdXNoKGBcdUQ4M0NcdURGMTAgUG9kc2llXHUwMTA3OiAke3N1Yn0uMC8yNCB8IElQOiAke2xvY2FsSXAgPz8gJz8nfVxcbmApO1xuICAgICAgICAvLyBBUlA6IHNob3cgbmVpZ2hib3VycyB3aXRob3V0IFJUU1Agc3BlY3VsYXRpb25cbiAgICAgICAgY29uc3QgYXJwID0gcGFyc2VBcnBFbnRyaWVzKCkuZmlsdGVyKGUgPT4gZS5zdGF0ZSAhPT0gJ2ZhaWxlZCcgJiYgZS5pcCAhPT0gbG9jYWxJcCk7XG4gICAgICAgIGNvbnN0IHdpZmlBcnAgPSBhcnAuZmlsdGVyKGUgPT4gZS5pcC5zdGFydHNXaXRoKHN1YiArICcuJykpO1xuICAgICAgICBpZiAod2lmaUFycC5sZW5ndGgpIHtcbiAgICAgICAgICBsaW5lcy5wdXNoKGAqKlNcdTAxMDVzaWVkemkgdyBzaWVjaSBXaUZpICgke3dpZmlBcnAubGVuZ3RofSk6KipgKTtcbiAgICAgICAgICB3aWZpQXJwLmZvckVhY2goZSA9PiBsaW5lcy5wdXNoKGAgIFx1RDgzRFx1RENDRCAke2UuaXB9IFske2UubWFjID8/ICc/Pyd9XSAoJHtlLnN0YXRlfSlgKSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gbm1hcDogY2FtZXJhIHBvcnRzIG9ubHlcbiAgICAgICAgY29uc3Qgbm1hcENtZCA9IGlzQ2FtXG4gICAgICAgICAgPyBgbm1hcCAtcCA1NTQsODU1NCw4MCw4MDgwLDgwMDAgLS1vcGVuIC1UNCAke3N1Yn0uMC8yNCAyPi9kZXYvbnVsbGBcbiAgICAgICAgICA6IGBubWFwIC1zbiAtVDQgJHtzdWJ9LjAvMjQgMj4vZGV2L251bGxgO1xuICAgICAgICBjb25zdCBubWFwT3V0ID0gcnVuKG5tYXBDbWQsIDMwMDAwKTtcbiAgICAgICAgaWYgKG5tYXBPdXQpIHtcbiAgICAgICAgICBjb25zdCBob3N0cyA9IHBhcnNlTm1hcEhvc3RzKG5tYXBPdXQpLmZpbHRlcihoID0+IGguaXAgIT09IGxvY2FsSXApO1xuICAgICAgICAgIGNvbnN0IGNhbWVyYXMgPSBob3N0cy5maWx0ZXIoaCA9PiBoLmhhc0NhbSk7XG4gICAgICAgICAgY29uc3Qgb3RoZXJzICA9IGhvc3RzLmZpbHRlcihoID0+ICFoLmhhc0NhbSk7XG4gICAgICAgICAgaWYgKGlzQ2FtKSB7XG4gICAgICAgICAgICBsaW5lcy5wdXNoKGNhbWVyYXMubGVuZ3RoXG4gICAgICAgICAgICAgID8gYFxcbioqXHVEODNEXHVEQ0Y3IEthbWVyeSBSVFNQICgke2NhbWVyYXMubGVuZ3RofSk6KipgXG4gICAgICAgICAgICAgIDogYFxcblx1MjZBMFx1RkUwRiBOaWUgd3lrcnl0byBrYW1lciBSVFNQIChwb3J0IDU1NC84NTU0IHphbWtuaVx1MDExOXR5IG5hIHdzenlzdGtpY2ggaG9zdGFjaClgKTtcbiAgICAgICAgICAgIGNhbWVyYXMuZm9yRWFjaChoID0+IHtcbiAgICAgICAgICAgICAgbGluZXMucHVzaChgICBcdUQ4M0RcdURDRjcgKioke2guaXB9KiogcG9ydHM6ICR7aC5wb3J0cy5qb2luKCcsJyl9YCk7XG4gICAgICAgICAgICAgIGxpbmVzLnB1c2goYCAgICAgXHVEODNDXHVERkE1IFJUU1A6IFxcYHJ0c3A6Ly8ke2guaXB9OjU1NC9zdHJlYW1cXGBgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKG90aGVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgbGluZXMucHVzaChgXFxuXHVEODNEXHVEREE1XHVGRTBGICBJbm5lIHVyelx1MDEwNWR6ZW5pYSAoJHtvdGhlcnMubGVuZ3RofSk6YCk7XG4gICAgICAgICAgICAgIG90aGVycy5mb3JFYWNoKGggPT4gbGluZXMucHVzaChgICBcdUQ4M0RcdUREQTVcdUZFMEYgICR7aC5pcH0gcG9ydHM6ICR7aC5wb3J0cy5qb2luKCcsJyl9YCkpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxpbmVzLnB1c2goYFxcbioqSG9zdHkgdyBzaWVjaSAoJHtob3N0cy5sZW5ndGh9KToqKmApO1xuICAgICAgICAgICAgaG9zdHMuZm9yRWFjaChoID0+IGxpbmVzLnB1c2goYCAgJHtoLmhhc0NhbSA/ICdcdUQ4M0RcdURDRjcnIDogJ1x1RDgzRFx1RERBNVx1RkUwRiAnfSAke2guaXB9JHtoLnBvcnRzLmxlbmd0aCA/IGAgWyR7aC5wb3J0cy5qb2luKCcsJyl9XWAgOiAnJ31gKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxpbmVzLnB1c2goJ1xcblx1RDgzRFx1RENBMSBaYWluc3RhbHVqIG5tYXA6IHN1ZG8gYXB0IGluc3RhbGwgbm1hcCcpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGluZXMucHVzaChgXHUyMTM5XHVGRTBGICBJbnRlbnQ6ICR7aW50ZW50fVxcblx1RDgzRFx1RENBQyBMTE0gbmllZG9zdFx1MDExOXBueSB3IHRyeWJpZSBBUEkgQ0xJYCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgaW50ZW50LCBjb250ZW50OiBbeyB0eXBlOiAndGV4dCcsIGRhdGE6IGxpbmVzLmpvaW4oJ1xcbicpIH1dIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIG5hbWU6ICdicm94ZWVuLWNoYXQtYXBpJyxcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XG4gICAgICBzZXJ2ZXIubWlkZGxld2FyZXMudXNlKCcvYXBpL2NoYXQnLCAocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICAgICAgaWYgKHJlcS5tZXRob2QgIT09ICdQT1NUJykgeyBuZXh0KCk7IHJldHVybjsgfVxuICAgICAgICBjb25zdCBjaHVua3M6IEJ1ZmZlcltdID0gW107XG4gICAgICAgIHJlcS5vbignZGF0YScsIGMgPT4gY2h1bmtzLnB1c2goYykpO1xuICAgICAgICByZXEub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgYm9keSA9IEpTT04ucGFyc2UoQnVmZmVyLmNvbmNhdChjaHVua3MpLnRvU3RyaW5nKCkpO1xuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gaGFuZGxlUXVlcnkoYm9keS5xdWVyeSA/PyAnJywgYm9keS5zY29wZSA/PyAnbmV0d29yaycpO1xuICAgICAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyB9KTtcbiAgICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gICAgICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xuICAgICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBlLm1lc3NhZ2UgfSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gQ2FtZXJhIHByb3h5IFx1MjAxNCBieXBhc3MgQ09SUyBmb3IgSFRUUCBzbmFwc2hvdCBmZXRjaCBpbiBicm93c2VyIG1vZGVcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoJy9hcGkvY2FtZXJhLXByb3h5JywgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCA/PyAnJywgJ2h0dHA6Ly9sb2NhbGhvc3QnKS5zZWFyY2hQYXJhbXMuZ2V0KCd1cmwnKTtcbiAgICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgICByZXMud3JpdGVIZWFkKDQwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonIH0pO1xuICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ01pc3NpbmcgP3VybD0gcGFyYW1ldGVyJyB9KSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xuICAgICAgICAgIGNvbnN0IGJhc2ljVXNlciA9IHBhcnNlZFVybC51c2VybmFtZSA/IGRlY29kZVVSSUNvbXBvbmVudChwYXJzZWRVcmwudXNlcm5hbWUpIDogJyc7XG4gICAgICAgICAgY29uc3QgYmFzaWNQYXNzID0gcGFyc2VkVXJsLnBhc3N3b3JkID8gZGVjb2RlVVJJQ29tcG9uZW50KHBhcnNlZFVybC5wYXNzd29yZCkgOiAnJztcbiAgICAgICAgICBpZiAoYmFzaWNVc2VyKSB7XG4gICAgICAgICAgICBwYXJzZWRVcmwudXNlcm5hbWUgPSAnJztcbiAgICAgICAgICAgIHBhcnNlZFVybC5wYXNzd29yZCA9ICcnO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IG1ldGhvZCA9IHJlcS5tZXRob2QgPT09ICdQT1NUJyA/ICdQT1NUJyA6ICdHRVQnO1xuICAgICAgICAgIGxldCBib2R5OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ1BPU1QnKSB7XG4gICAgICAgICAgICBjb25zdCBjaHVua3M6IEJ1ZmZlcltdID0gW107XG4gICAgICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IGNodW5rIG9mIHJlcSkgY2h1bmtzLnB1c2goY2h1bmsgYXMgQnVmZmVyKTtcbiAgICAgICAgICAgIGJvZHkgPSBCdWZmZXIuY29uY2F0KGNodW5rcykudG9TdHJpbmcoKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgICAgICAgaWYgKGJvZHkpIGhlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gJ2FwcGxpY2F0aW9uL2pzb24nO1xuICAgICAgICAgIGlmIChiYXNpY1VzZXIpIHtcbiAgICAgICAgICAgIGhlYWRlcnNbJ0F1dGhvcml6YXRpb24nXSA9IGBCYXNpYyAke0J1ZmZlci5mcm9tKGAke2Jhc2ljVXNlcn06JHtiYXNpY1Bhc3N9YCkudG9TdHJpbmcoJ2Jhc2U2NCcpfWA7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgdXBzdHJlYW0gPSBhd2FpdCBmZXRjaChwYXJzZWRVcmwudG9TdHJpbmcoKSwge1xuICAgICAgICAgICAgbWV0aG9kLFxuICAgICAgICAgICAgYm9keSxcbiAgICAgICAgICAgIGhlYWRlcnM6IE9iamVjdC5rZXlzKGhlYWRlcnMpLmxlbmd0aCA/IGhlYWRlcnMgOiB1bmRlZmluZWQsXG4gICAgICAgICAgICBzaWduYWw6IEFib3J0U2lnbmFsLnRpbWVvdXQoMTAwMDApLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gdXBzdHJlYW0uaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpIHx8ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nO1xuICAgICAgICAgIGNvbnN0IGJ1ZmZlciA9IEJ1ZmZlci5mcm9tKGF3YWl0IHVwc3RyZWFtLmFycmF5QnVmZmVyKCkpO1xuICAgICAgICAgIHJlcy53cml0ZUhlYWQodXBzdHJlYW0uc3RhdHVzLCB7XG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJzogY29udGVudFR5cGUsXG4gICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgICAgJ1gtUHJveHktVXJsJzogcGFyc2VkVXJsLnRvU3RyaW5nKCksXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmVzLmVuZChidWZmZXIpO1xuICAgICAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgICAgICByZXMud3JpdGVIZWFkKDUwMiwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonIH0pO1xuICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogZS5tZXNzYWdlIH0pKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoJy9hcGkvbmV0LWRpYWcnLCAoX3JlcSwgcmVzKSA9PiB7XG4gICAgICAgIGNvbnN0IGxvY2FsSXAgPSBnZXRMb2NhbElwKCk7XG4gICAgICAgIGNvbnN0IGFycCA9IHBhcnNlQXJwRW50cmllcygpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonIH0pO1xuICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgbG9jYWxJcCwgYXJwLCB0czogRGF0ZS5ub3coKSB9KSk7XG4gICAgICB9KTtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoYXN5bmMgKCkgPT4gKHtcbiAgdGVzdDoge1xuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgZW52aXJvbm1lbnQ6IFwianNkb21cIixcbiAgICBzZXR1cEZpbGVzOiBbXCIuL3NyYy90ZXN0L3NldHVwLnRzXCJdLFxuICAgIGluY2x1ZGU6IFtcInNyYy8qKi8qLnRlc3QudHNcIiwgXCJzcmMvKiovKi50ZXN0LnRzeFwiXSxcbiAgICB0eXBlY2hlY2s6IHsgdHNjb25maWc6IFwiLi90c2NvbmZpZy50ZXN0Lmpzb25cIiB9LFxuICAgIHRlc3RUaW1lb3V0OiAxMDAwMCxcbiAgICBjb3ZlcmFnZToge1xuICAgICAgcHJvdmlkZXI6IFwidjhcIixcbiAgICAgIHJlcG9ydGVyOiBbXCJ0ZXh0XCIsIFwibGNvdlwiXSxcbiAgICAgIGluY2x1ZGU6IFtcInNyYy9saWIvKipcIiwgXCJzcmMvaG9va3MvKipcIl0sXG4gICAgfSxcbiAgfSBhcyBWaXRlc3RVc2VyQ29uZmlnW1widGVzdFwiXSxcbiAgcGx1Z2luczogW3JlYWN0KCksIGNoYXRBcGlQbHVnaW4oKV0sXG4gIGNsZWFyU2NyZWVuOiBmYWxzZSxcbiAgYnVpbGQ6IHtcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDYwMCxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzKGlkOiBzdHJpbmcpIHtcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9AdGF1cmktYXBwcycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci10YXVyaSc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL2x1Y2lkZS1yZWFjdCcpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1sdWNpZGUnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy8nKSkge1xuICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3InO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiB0cnVlLFxuICAgIGhvc3Q6IGhvc3QgfHwgZmFsc2UsXG4gICAgaG1yOiBob3N0XG4gICAgICA/IHtcbiAgICAgICAgICBwcm90b2NvbDogXCJ3c1wiLFxuICAgICAgICAgIGhvc3QsXG4gICAgICAgICAgcG9ydDogNTE3MyxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQsXG4gICAgd2F0Y2g6IHtcbiAgICAgIGlnbm9yZWQ6IFtcbiAgICAgICAgXCIqKi9zcmMtdGF1cmkvKipcIixcbiAgICAgICAgXCIqKi92ZW52LyoqXCIsXG4gICAgICAgIFwiKiovLnZlbnYvKipcIixcbiAgICAgICAgXCIqKi9fX3B5Y2FjaGVfXy8qKlwiLFxuICAgICAgICBcIioqL2Rpc3QvKipcIixcbiAgICAgICAgXCIqKi90YXJnZXQvKipcIixcbiAgICAgIF0sXG4gICAgICB1c2VQb2xsaW5nOiB0cnVlLFxuICAgICAgaW50ZXJ2YWw6IDI1MCxcbiAgICB9LFxuICB9LFxufSkpO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUErUSxTQUFTLG9CQUFvQjtBQUM1UyxPQUFPLFdBQVc7QUFHbEIsU0FBUyxnQkFBZ0I7QUFDekIsU0FBUyx5QkFBeUI7QUFFbEMsSUFBTSxPQUFPLFFBQVEsSUFBSSxrQkFBa0I7QUFHM0MsU0FBUyxnQkFBd0I7QUFDL0IsV0FBUyxJQUFJLEtBQWEsVUFBVSxLQUFzQjtBQUN4RCxRQUFJO0FBQ0YsYUFBUSxTQUFpQixLQUFLLEVBQUUsVUFBVSxRQUFRLFNBQVMsT0FBTyxDQUFDLFFBQU8sUUFBTyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEtBQUs7QUFBQSxJQUNuRyxRQUFRO0FBQUUsYUFBTztBQUFBLElBQU07QUFB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

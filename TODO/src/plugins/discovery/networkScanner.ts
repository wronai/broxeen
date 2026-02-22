/**
 * @module plugins/discovery/networkScanner
 * @description Network device scanner and service prober.
 *
 * Discovery flow:
 * 1. Scan subnet for live hosts (ping sweep via Tauri/Rust)
 * 2. For each host, probe known ports for services
 * 3. Classify device type based on discovered services
 * 4. Persist to devices.db
 * 5. Auto-register plugins for discovered services
 *
 * Intents:
 * - "network:scan"       — full network scan
 * - "network:list"       — list known devices
 * - "network:probe"      — probe specific IP
 *
 * Browser mode: limited to HTTP-only probing (no raw TCP)
 * Tauri mode: full port scanning via Rust backend
 */

import type {
  ContentBlock,
  DataSourcePlugin,
  PluginCapabilities,
  PluginId,
  PluginQuery,
  PluginResult,
} from "../../core/plugin.types";
import type { PluginRegistry } from "../../core/pluginRegistry";
import type {
  Device,
  DeviceRepository,
  DeviceService,
  DeviceType,
  ServiceProtocol,
} from "../../persistence/deviceRepository";

// ─── Scanner Backend Interface ──────────────────────────────

export interface ScannerBackend {
  /** Discover live hosts on the subnet */
  scanSubnet(subnet: string): Promise<DiscoveredHost[]>;
  /** Probe a specific port on a host */
  probePort(ip: string, port: number, timeoutMs?: number): Promise<ProbeResult>;
}

export interface DiscoveredHost {
  ip: string;
  mac?: string;
  hostname?: string;
  responseMs: number;
}

export interface ProbeResult {
  open: boolean;
  responseMs?: number;
  banner?: string;  // HTTP Server header, RTSP response, etc.
}

// ─── Service Probe Definitions ──────────────────────────────

export interface ServiceProbe {
  protocol: ServiceProtocol;
  port: number;
  path: string;
  /** How to detect this service */
  detect: (result: ProbeResult) => boolean;
  /** Classify device type if this service is found */
  impliesDeviceType?: DeviceType;
  label?: string;
}

const DEFAULT_PROBES: ServiceProbe[] = [
  // Web servers
  { protocol: "http", port: 80, path: "/", detect: (r) => r.open, label: "HTTP" },
  { protocol: "https", port: 443, path: "/", detect: (r) => r.open, label: "HTTPS" },
  { protocol: "http", port: 8080, path: "/", detect: (r) => r.open, label: "HTTP Alt" },
  { protocol: "http", port: 8443, path: "/", detect: (r) => r.open, label: "HTTPS Alt" },

  // Cameras
  {
    protocol: "rtsp",
    port: 554,
    path: "/stream",
    detect: (r) => r.open,
    impliesDeviceType: "camera",
    label: "RTSP Stream",
  },
  {
    protocol: "http",
    port: 80,
    path: "/snapshot.jpg",
    detect: (r) => r.open && (r.banner?.includes("image") ?? false),
    impliesDeviceType: "camera",
    label: "HTTP Snapshot",
  },
  {
    protocol: "onvif",
    port: 80,
    path: "/onvif/device_service",
    detect: (r) => r.open,
    impliesDeviceType: "camera",
    label: "ONVIF",
  },

  // MQTT brokers
  {
    protocol: "mqtt",
    port: 1883,
    path: "/",
    detect: (r) => r.open,
    impliesDeviceType: "smart-home",
    label: "MQTT",
  },
  {
    protocol: "mqtt-ws",
    port: 9001,
    path: "/",
    detect: (r) => r.open,
    impliesDeviceType: "smart-home",
    label: "MQTT WebSocket",
  },

  // SSH
  {
    protocol: "ssh",
    port: 22,
    path: "/",
    detect: (r) => r.open && (r.banner?.includes("SSH") ?? r.open),
    impliesDeviceType: "server",
    label: "SSH",
  },

  // REST APIs
  {
    protocol: "api",
    port: 3000,
    path: "/api",
    detect: (r) => r.open,
    impliesDeviceType: "server",
    label: "REST API",
  },
  {
    protocol: "api",
    port: 5000,
    path: "/api",
    detect: (r) => r.open,
    impliesDeviceType: "server",
    label: "REST API",
  },
];

// ─── Tauri Scanner Backend ──────────────────────────────────

export class TauriScannerBackend implements ScannerBackend {
  constructor(
    private readonly invoke: (
      cmd: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>,
  ) {}

  async scanSubnet(subnet: string): Promise<DiscoveredHost[]> {
    return (await this.invoke("network_scan_subnet", { subnet })) as DiscoveredHost[];
  }

  async probePort(ip: string, port: number, timeoutMs = 2000): Promise<ProbeResult> {
    return (await this.invoke("network_probe_port", {
      ip,
      port,
      timeoutMs,
    })) as ProbeResult;
  }
}

/**
 * Browser-only backend: can only probe HTTP(S) via fetch.
 * RTSP/MQTT/SSH detection requires Tauri.
 */
export class BrowserScannerBackend implements ScannerBackend {
  async scanSubnet(_subnet: string): Promise<DiscoveredHost[]> {
    // Cannot do subnet scanning from browser
    // Return empty — user must manually add devices
    return [];
  }

  async probePort(ip: string, port: number, timeoutMs = 3000): Promise<ProbeResult> {
    // Only HTTP/HTTPS probing possible in browser
    if (![80, 443, 8080, 8443, 3000, 5000].includes(port)) {
      return { open: false };
    }

    const scheme = [443, 8443].includes(port) ? "https" : "http";
    const url = `${scheme}://${ip}:${port}/`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const start = performance.now();

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        mode: "no-cors",
      });

      clearTimeout(timer);

      return {
        open: true,
        responseMs: performance.now() - start,
        banner: response.headers.get("server") ?? undefined,
      };
    } catch {
      return { open: false };
    }
  }
}

// ─── Network Scanner Plugin ─────────────────────────────────

export interface NetworkScannerOptions {
  backend: ScannerBackend;
  deviceRepo: DeviceRepository;
  pluginRegistry?: PluginRegistry;
  probes?: ServiceProbe[];
  defaultSubnet?: string;
}

export class NetworkScannerPlugin implements DataSourcePlugin {
  readonly id: PluginId = "network-scanner";
  readonly name = "Network Scanner";
  readonly capabilities: PluginCapabilities = {
    intents: ["network:scan", "network:list", "network:probe"],
    streaming: false,
    requiresNetwork: true,
    browserCompatible: true, // limited mode
    priority: 40,
  };

  private readonly backend: ScannerBackend;
  private readonly deviceRepo: DeviceRepository;
  private readonly pluginRegistry?: PluginRegistry;
  private readonly probes: ServiceProbe[];
  private readonly defaultSubnet: string;
  private scanning = false;

  constructor(options: NetworkScannerOptions) {
    this.backend = options.backend;
    this.deviceRepo = options.deviceRepo;
    this.pluginRegistry = options.pluginRegistry;
    this.probes = options.probes ?? DEFAULT_PROBES;
    this.defaultSubnet = options.defaultSubnet ?? "192.168.1.0/24";
  }

  async initialize(): Promise<void> {
    // Nothing to initialize
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(query: PluginQuery): Promise<PluginResult> {
    const start = performance.now();

    switch (query.intent) {
      case "network:scan":
        return this.handleScan(query, start);
      case "network:list":
        return this.handleList(start);
      case "network:probe":
        return this.handleProbe(query, start);
      default:
        return this.errorResult(`Nieznana intencja: ${query.intent}`, start);
    }
  }

  async dispose(): Promise<void> {}

  // ── Scan Handler ────────────────────────────────────────

  private async handleScan(query: PluginQuery, start: number): Promise<PluginResult> {
    if (this.scanning) {
      return this.errorResult("Skanowanie już trwa...", start);
    }

    this.scanning = true;
    try {
      const subnet =
        (query.params.subnet as string) ?? this.defaultSubnet;

      // Phase 1: Discover hosts
      const hosts = await this.backend.scanSubnet(subnet);

      if (hosts.length === 0) {
        return {
          pluginId: this.id,
          status: "success",
          content: [
            {
              type: "text",
              data: `Skanowanie ${subnet}: nie znaleziono nowych urządzeń.`,
              summary: "Brak nowych urządzeń",
            },
          ],
          metadata: this.meta(start),
        };
      }

      // Phase 2: Probe services on each host
      const results: Array<{ host: DiscoveredHost; services: DeviceService[] }> = [];

      for (const host of hosts) {
        const services = await this.probeHost(host);
        const deviceType = this.classifyDevice(services);

        // Persist device
        const device: Device = {
          id: host.ip,
          ip: host.ip,
          mac: host.mac,
          hostname: host.hostname,
          deviceType,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
          isOnline: true,
          metadata: { scanResponseMs: host.responseMs },
        };
        this.deviceRepo.upsertDevice(device);

        // Persist services
        for (const svc of services) {
          this.deviceRepo.upsertService(svc);
        }

        results.push({ host, services });
      }

      // Build report
      const lines = results.map(({ host, services }) => {
        const svcList = services.map((s) => `${s.label ?? s.protocol}:${s.port}`).join(", ");
        const name = host.hostname ?? host.ip;
        return `• ${name} — ${svcList || "brak usług"}`;
      });

      const cameras = results.filter(
        (r) => r.services.some((s) => s.protocol === "rtsp" || s.label?.includes("Snapshot")),
      );

      const summary =
        `Znaleziono ${hosts.length} urządzeń, ` +
        `${cameras.length} kamer, ` +
        `${results.reduce((sum, r) => sum + r.services.length, 0)} usług.`;

      return {
        pluginId: this.id,
        status: "success",
        content: [
          {
            type: "text",
            data: `Skanowanie sieci ${subnet}:\n\n${lines.join("\n")}`,
            summary,
          },
        ],
        metadata: this.meta(start),
      };
    } finally {
      this.scanning = false;
    }
  }

  // ── List Handler ────────────────────────────────────────

  private handleList(start: number): PluginResult {
    const devices = this.deviceRepo.getAllDevices();

    if (devices.length === 0) {
      return {
        pluginId: this.id,
        status: "success",
        content: [
          {
            type: "text",
            data: 'Brak znanych urządzeń. Powiedz "skanuj sieć" aby wykryć urządzenia.',
            summary: "Brak urządzeń",
          },
        ],
        metadata: this.meta(start),
      };
    }

    const lines = devices.map((d) => {
      const status = d.isOnline ? "🟢" : "🔴";
      const name = d.name ?? d.hostname ?? d.ip;
      const services = this.deviceRepo.getServicesForDevice(d.id);
      const svcList = services.map((s) => s.label ?? s.protocol).join(", ");
      return `${status} ${name} (${d.ip}) — ${d.deviceType} — ${svcList || "brak usług"}`;
    });

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: `Znane urządzenia (${devices.length}):\n\n${lines.join("\n")}`,
          summary: `${devices.length} urządzeń, ${devices.filter((d) => d.isOnline).length} online`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  // ── Probe Handler ───────────────────────────────────────

  private async handleProbe(query: PluginQuery, start: number): Promise<PluginResult> {
    const ip = query.resolvedTarget ?? this.extractIp(query.rawInput);
    if (!ip) {
      return this.errorResult("Podaj adres IP do sprawdzenia", start);
    }

    const host: DiscoveredHost = { ip, responseMs: 0 };
    const services = await this.probeHost(host);
    const deviceType = this.classifyDevice(services);

    this.deviceRepo.upsertDevice({
      id: ip,
      ip,
      deviceType,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      isOnline: true,
      metadata: {},
    });

    for (const svc of services) {
      this.deviceRepo.upsertService(svc);
    }

    const svcLines = services.length > 0
      ? services.map((s) => `  • ${s.label ?? s.protocol}:${s.port} (${s.responseMs}ms)`).join("\n")
      : "  Brak wykrytych usług";

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: `Urządzenie ${ip} (${deviceType}):\n${svcLines}`,
          summary: `${ip}: ${services.length} usług`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private async probeHost(host: DiscoveredHost): Promise<DeviceService[]> {
    const services: DeviceService[] = [];

    const tasks = this.probes.map(async (probe) => {
      try {
        const result = await this.backend.probePort(host.ip, probe.port, 2000);
        if (probe.detect(result)) {
          services.push({
            deviceId: host.ip,
            protocol: probe.protocol,
            port: probe.port,
            path: probe.path,
            label: probe.label,
            isActive: true,
            probedAt: Date.now(),
            responseMs: result.responseMs,
            metadata: result.banner ? { banner: result.banner } : {},
          });
        }
      } catch {
        // Probe failed — skip
      }
    });

    await Promise.allSettled(tasks);
    return services;
  }

  private classifyDevice(services: DeviceService[]): DeviceType {
    // Priority: camera > smart-home > server > unknown
    const probe = this.probes.find((p) =>
      services.some(
        (s) =>
          s.protocol === p.protocol &&
          s.port === p.port &&
          p.impliesDeviceType,
      ),
    );
    return probe?.impliesDeviceType ?? "unknown";
  }

  private extractIp(input: string): string | null {
    const match = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    return match?.[1] ?? null;
  }

  private meta(start: number): PluginResult["metadata"] {
    return {
      duration_ms: performance.now() - start,
      cached: false,
      truncated: false,
    };
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: "error",
      content: [{ type: "text", data: message }],
      metadata: this.meta(start),
    };
  }
}

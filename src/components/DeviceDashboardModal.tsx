import { useState, useEffect, useCallback } from "react";
import { X, Wifi, WifiOff, RefreshCw, Monitor, Camera, Server, Smartphone } from "lucide-react";

interface DeviceEntry {
  id: string;
  ip: string;
  hostname: string | null;
  mac: string | null;
  vendor: string | null;
  last_seen: number;
  status: "online" | "offline" | "unknown";
  services_count: number;
}

interface DeviceDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  databaseManager: any | null;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "przed chwilą";
  if (mins < 60) return `${mins} min temu`;
  if (hours < 24) return `${hours}h temu`;
  return `${days}d temu`;
}

function statusColor(device: DeviceEntry): string {
  const mins = (Date.now() - device.last_seen) / 60000;
  if (mins < 5) return "bg-green-400";
  if (mins < 60) return "bg-yellow-400";
  if (mins < 360) return "bg-orange-400";
  return "bg-gray-500";
}

function inferDeviceType(device: DeviceEntry): "camera" | "server" | "device" {
  const v = (device.vendor || "").toLowerCase();
  const h = (device.hostname || "").toLowerCase();
  if (
    v.includes("hikvision") || v.includes("dahua") || v.includes("reolink") ||
    v.includes("axis") || v.includes("hanwha") || v.includes("bosch") ||
    h.includes("cam") || h.includes("ipc") || h.includes("nvr") || h.includes("dvr")
  ) return "camera";
  if (device.services_count > 3) return "server";
  return "device";
}

function deviceIcon(device: DeviceEntry) {
  const type = inferDeviceType(device);
  if (type === "camera") return <Camera size={14} className="text-blue-400" />;
  if (type === "server") return <Server size={14} className="text-purple-400" />;
  return <Monitor size={14} className="text-gray-400" />;
}

export default function DeviceDashboardModal({
  isOpen,
  onClose,
  databaseManager,
}: DeviceDashboardModalProps) {
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "online" | "offline" | "cameras">("all");
  const [search, setSearch] = useState("");

  const loadDevices = useCallback(async () => {
    if (!databaseManager) return;
    setLoading(true);
    try {
      const db = databaseManager.getDevicesDb();
      const rows: DeviceEntry[] = await db.query(
        `SELECT d.id, d.ip, d.hostname, d.mac, d.vendor, d.last_seen,
                COALESCE(ds.status, 'unknown') as status,
                COUNT(ds.id) as services_count
         FROM devices d
         LEFT JOIN device_services ds ON d.id = ds.device_id
         GROUP BY d.id
         ORDER BY d.last_seen DESC
         LIMIT 200`,
      );
      setDevices(rows || []);
    } catch {
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [databaseManager]);

  useEffect(() => {
    if (isOpen) {
      void loadDevices();
      setSearch("");
      setFilter("all");
    }
  }, [isOpen, loadDevices]);

  const filtered = devices.filter((d) => {
    const mins = (Date.now() - d.last_seen) / 60000;
    if (filter === "online" && mins > 60) return false;
    if (filter === "offline" && mins <= 60) return false;
    if (filter === "cameras" && inferDeviceType(d) !== "camera") return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        d.ip.includes(q) ||
        (d.hostname || "").toLowerCase().includes(q) ||
        (d.vendor || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const onlineCount = devices.filter((d) => (Date.now() - d.last_seen) / 60000 < 60).length;
  const offlineCount = devices.length - onlineCount;
  const cameraCount = devices.filter((d) => inferDeviceType(d) === "camera").length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl bg-gray-900 shadow-2xl" style={{ maxHeight: "85vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">Urządzenia w sieci</h2>
            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
              {devices.length} znanych
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadDevices()}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-2.5 py-1.5 text-xs text-gray-300 transition hover:bg-gray-700 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Odśwież
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 border-b border-gray-800 px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-2 w-2 rounded-full bg-green-400" />
            <span className="text-gray-300">{onlineCount} online</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-2 w-2 rounded-full bg-gray-500" />
            <span className="text-gray-300">{offlineCount} offline</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {([
              ["all", "Wszystkie"],
              ["cameras", `📷${cameraCount > 0 ? ` (${cameraCount})` : ""}`],
              ["online", "Online"],
              ["offline", "Offline"],
            ] as ["all" | "online" | "offline" | "cameras", string][]).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filter === f
                    ? "bg-broxeen-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-gray-800 px-5 py-2.5">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Szukaj po IP, nazwie, producencie..."
            className="w-full rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-broxeen-500"
          />
        </div>

        {/* Device list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={20} className="animate-spin text-gray-500" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wifi size={32} className="mb-3 text-gray-700" />
              <p className="text-sm text-gray-500">
                {devices.length === 0
                  ? "Brak znanych urządzeń. Wpisz \"skanuj sieć\" w chacie."
                  : "Brak wyników dla podanego filtra."}
              </p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="divide-y divide-gray-800/60">
              {filtered.map((device) => {
                const mins = (Date.now() - device.last_seen) / 60000;
                const isOnline = mins < 60;
                return (
                  <div
                    key={device.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-800/40 transition"
                  >
                    {/* Status dot */}
                    <div className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${statusColor(device)}`} />

                    {/* Icon */}
                    <div className="flex-shrink-0">{deviceIcon(device)}</div>

                    {/* IP + hostname */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-white">{device.ip}</span>
                        {device.hostname && (
                          <span className="text-xs text-gray-400 truncate">({device.hostname})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {device.vendor && (
                          <span className="text-xs text-gray-500 truncate">{device.vendor}</span>
                        )}
                        {device.mac && (
                          <span className="font-mono text-xs text-gray-600">{device.mac}</span>
                        )}
                      </div>
                    </div>

                    {/* Services count */}
                    {device.services_count > 0 && (
                      <div className="flex-shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                        {device.services_count} usług
                      </div>
                    )}

                    {/* Last seen */}
                    <div className="flex-shrink-0 text-right">
                      <div className={`text-xs ${isOnline ? "text-green-400" : "text-gray-500"}`}>
                        {isOnline ? "online" : "offline"}
                      </div>
                      <div className="text-xs text-gray-600">{timeAgo(device.last_seen)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-800 px-5 py-3">
          <p className="text-xs text-gray-500">
            Dane z lokalnej bazy SQLite. Aktualizowane przy każdym skanowaniu.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

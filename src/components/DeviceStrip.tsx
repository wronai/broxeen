import { useState, useEffect, useCallback } from "react";
import { Camera, Server, Monitor, Wifi, ChevronDown, Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { ConfiguredDeviceRepository, type ConfiguredDevice } from "../persistence/configuredDeviceRepository";
import type { DbAdapter } from "../persistence/databaseManager";

interface DeviceStripProps {
  devicesDb: DbAdapter | null;
  onDeviceClick?: (device: ConfiguredDevice) => void;
  onAddDevice?: () => void;
}

function deviceTypeIcon(type: string, size = 14) {
  switch (type) {
    case "camera":
      return <Camera size={size} className="text-blue-400" />;
    case "server":
      return <Server size={size} className="text-purple-400" />;
    default:
      return <Monitor size={size} className="text-gray-400" />;
  }
}

function statusDot(device: ConfiguredDevice) {
  if (!device.monitor_enabled) return "bg-gray-600";
  if (!device.last_snapshot_at) return "bg-yellow-400/60";
  const age = Date.now() - device.last_snapshot_at;
  if (age < 60_000) return "bg-green-400";
  if (age < 300_000) return "bg-yellow-400";
  return "bg-red-400";
}

export default function DeviceStrip({ devicesDb, onDeviceClick, onAddDevice }: DeviceStripProps) {
  const [devices, setDevices] = useState<ConfiguredDevice[]>([]);
  const [expanded, setExpanded] = useState(false);

  const loadDevices = useCallback(async () => {
    if (!devicesDb) return;
    try {
      const repo = new ConfiguredDeviceRepository(devicesDb);
      const all = await repo.listAll();
      setDevices(all);
    } catch {
      setDevices([]);
    }
  }, [devicesDb]);

  useEffect(() => {
    void loadDevices();
    const interval = setInterval(() => void loadDevices(), 10_000);
    return () => clearInterval(interval);
  }, [loadDevices]);

  // Listen for device config changes
  useEffect(() => {
    const handler = () => void loadDevices();
    window.addEventListener("broxeen:devices_changed", handler);
    return () => window.removeEventListener("broxeen:devices_changed", handler);
  }, [loadDevices]);

  if (devices.length === 0) {
    return (
      <button
        onClick={onAddDevice}
        className="flex items-center gap-1.5 rounded-lg bg-gray-800/60 px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-gray-700 hover:text-gray-300"
        title="Dodaj urządzenie"
      >
        <Plus size={13} />
        <span className="hidden sm:inline">Urządzenia</span>
      </button>
    );
  }

  const dispatchChatAction = (mode: "prefill" | "execute", text: string) => {
    window.dispatchEvent(
      new CustomEvent("broxeen:chat_action", {
        detail: { mode, text },
      }),
    );
  };

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-2 py-1.5 text-xs text-gray-300 transition hover:bg-gray-700 hover:text-white"
        title={`${devices.length} skonfigurowanych urządzeń`}
      >
        <Wifi size={13} className="text-broxeen-400" />
        <div className="flex items-center gap-1">
          {devices.slice(0, 4).map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-1 rounded bg-gray-700/60 px-1.5 py-0.5"
              title={`${d.label} (${d.ip})`}
            >
              <div className={`h-1.5 w-1.5 rounded-full ${statusDot(d)}`} />
              {deviceTypeIcon(d.device_type, 11)}
              <span className="max-w-[60px] truncate font-mono text-[10px]">{d.label}</span>
            </div>
          ))}
          {devices.length > 4 && (
            <span className="text-[10px] text-gray-500">+{devices.length - 4}</span>
          )}
        </div>
        <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2">
            <span className="text-xs font-semibold text-gray-300">Skonfigurowane urządzenia</span>
            <button
              onClick={() => {
                setExpanded(false);
                onAddDevice?.();
              }}
              className="rounded p-1 text-gray-500 transition hover:bg-gray-800 hover:text-white"
              title="Dodaj urządzenie"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 border-b border-gray-800/50 px-3 py-2 transition hover:bg-gray-800/40"
              >
                <div className={`h-2 w-2 flex-shrink-0 rounded-full ${statusDot(d)}`} />
                {deviceTypeIcon(d.device_type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-white truncate">{d.label}</span>
                    <span className="font-mono text-[10px] text-gray-500">{d.ip}</span>
                  </div>
                  {d.rtsp_url && (
                    <span className="text-[10px] text-gray-600 truncate block">{d.rtsp_url}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {d.device_type === "camera" && d.rtsp_url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatchChatAction("execute", `pokaż live ${d.ip}`);
                        setExpanded(false);
                      }}
                      className="rounded p-1 text-gray-500 transition hover:bg-gray-700 hover:text-blue-400"
                      title="Podgląd live"
                    >
                      <Eye size={12} />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatchChatAction("execute", `monitoruj ${d.ip}`);
                      setExpanded(false);
                    }}
                    className="rounded p-1 text-gray-500 transition hover:bg-gray-700 hover:text-green-400"
                    title="Monitoruj"
                  >
                    {d.monitor_enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-800 px-3 py-2">
            <button
              onClick={() => {
                dispatchChatAction("prefill", "dodaj kamerę ");
                setExpanded(false);
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-800 py-1.5 text-xs text-gray-400 transition hover:bg-gray-700 hover:text-white"
            >
              <Plus size={12} />
              Dodaj urządzenie przez chat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

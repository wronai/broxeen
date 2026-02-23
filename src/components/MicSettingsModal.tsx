import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic, X } from "lucide-react";
import {
  withAudioSettingsDefaults,
  type AudioSettings,
} from "../domain/audioSettings";
import { logger } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";
import { useSpeech } from "../hooks/useSpeech";
import { useStt } from "../hooks/useStt";
import { CONFIG_FIELD_META } from "../config/appConfig";

interface MicSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AudioSettings;
  onSettingsChange: (settings: AudioSettings) => void;
  micLevel: number;
  micLevelActive: boolean;
}

export default function MicSettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  micLevel,
  micLevelActive,
}: MicSettingsModalProps) {
  const [local, setLocal] = useState<AudioSettings>(settings);
  
  const STT_MODELS = CONFIG_FIELD_META.find((field: any) => field.key === 'stt.model')?.options || [];
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [micPermissionState, setMicPermissionState] = useState<
    "granted" | "denied" | "prompt" | "unsupported" | "unknown"
  >("unknown");

  const runtimeIsTauri = isTauriRuntime();
  const speech = useSpeech(local.tts_lang);
  const stt = useStt({ lang: local.tts_lang });

  useEffect(() => {
    if (!isOpen) return;
    setLocal(settings);

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setAudioDevices(devices))
      .catch((e) => logger.warn("Failed to enumerate devices:", e));

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => setAudioDevices(devices));
      })
      .catch((e) => logger.warn("Mic permission denied:", e));

    const nav: any = navigator as any;
    const permissionsApi = nav?.permissions;
    if (!permissionsApi?.query) {
      setMicPermissionState("unsupported");
      return;
    }
    let active = true;
    permissionsApi
      .query({ name: "microphone" })
      .then((status: any) => {
        if (!active) return;
        const state = String(status?.state || "unknown");
        if (state === "granted" || state === "denied" || state === "prompt") {
          setMicPermissionState(state as any);
        } else {
          setMicPermissionState("unknown");
        }
        if (status && "onchange" in status) {
          status.onchange = () => {
            const next = String(status?.state || "unknown");
            if (next === "granted" || next === "denied" || next === "prompt") {
              setMicPermissionState(next as any);
            } else {
              setMicPermissionState("unknown");
            }
          };
        }
      })
      .catch(() => {
        if (!active) return;
        setMicPermissionState("unknown");
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const micDevices = audioDevices.filter((d) => d.kind === "audioinput");

  const update = (partial: Partial<AudioSettings>) => {
    setLocal((prev) => ({ ...prev, ...partial }));
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      if (runtimeIsTauri) {
        await invoke("save_settings", { settings: local });
      }
      onSettingsChange(local);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      logger.error("Failed to save mic settings:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Mic size={20} /> Mikrofon & STT
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Live mic level */}
          <div className="rounded-xl bg-gray-800/50 p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
              <span>Poziom mikrofonu (live)</span>
              <span className="font-mono">{Math.round(micLevel * 100)}%</span>
            </div>
            <div className="flex items-center gap-3">
              <div
                className={
                  "h-3 w-3 rounded-full flex-shrink-0 " +
                  (settings.mic_enabled
                    ? micLevelActive
                      ? "bg-green-400 animate-pulse"
                      : "bg-yellow-300"
                    : "bg-gray-500")
                }
              />
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-700">
                <div
                  className={
                    "h-3 transition-all duration-75 " +
                    (micLevelActive ? "bg-green-500" : "bg-gray-600")
                  }
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
            </div>
            {micPermissionState === "denied" && (
              <div className="mt-2 rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-2 text-xs text-yellow-200">
                Mikrofon jest zablokowany (denied).
              </div>
            )}
          </div>

          {/* Mic on/off */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-sm">Mikrofon włączony</span>
              <input
                type="checkbox"
                checked={local.mic_enabled}
                onChange={(e) => update({ mic_enabled: e.target.checked })}
                className="h-4 w-4 rounded accent-broxeen-500"
              />
            </label>

            <label className="flex items-center justify-between">
              <span className="text-sm">STT włączony</span>
              <input
                type="checkbox"
                checked={local.stt_enabled}
                onChange={(e) => update({ stt_enabled: e.target.checked })}
                className="h-4 w-4 rounded accent-broxeen-500"
              />
            </label>

            <label className="flex items-center justify-between">
              <span className="text-sm">Auto-nasłuchiwanie</span>
              <input
                type="checkbox"
                checked={local.auto_listen}
                onChange={(e) => update({ auto_listen: e.target.checked })}
                className="h-4 w-4 rounded accent-broxeen-500"
              />
            </label>

            {local.auto_listen && (
              <label className="block">
                <span className="text-sm text-gray-300">
                  Pauza ciszy (ms): {local.auto_listen_silence_ms}
                </span>
                <input
                  type="range"
                  min="300"
                  max="3000"
                  step="100"
                  value={local.auto_listen_silence_ms}
                  onChange={(e) =>
                    update({ auto_listen_silence_ms: parseInt(e.target.value, 10) })
                  }
                  className="mt-1 w-full accent-broxeen-500"
                />
              </label>
            )}
          </div>

          {/* STT engine */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
            <label className="block">
              <span className="text-sm text-gray-300">Silnik STT</span>
              <select
                value={local.stt_engine}
                onChange={(e) => update({ stt_engine: e.target.value })}
                className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
              >
                <option value="openrouter">OpenRouter Whisper (chmura)</option>
                <option value="webspeech">Web Speech API (przeglądarka)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">Model STT</span>
              <select
                value={local.stt_model}
                onChange={(e) => update({ stt_model: e.target.value })}
                className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
              >
                {STT_MODELS.map((model: any) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>

            {micDevices.length > 0 && (
              <label className="block">
                <span className="text-sm text-gray-300">Urządzenie wejściowe</span>
                <select
                  value={local.mic_device_id}
                  onChange={(e) => update({ mic_device_id: e.target.value })}
                  className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
                >
                  <option value="default">Domyślny mikrofon</option>
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mikrofon ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* STT availability */}
          <div className="rounded-xl bg-gray-800/50 p-3 text-xs space-y-1">
            <div className="flex items-center justify-between text-gray-400">
              <span>Web Speech API</span>
              <span className={speech.isSupported ? "text-green-400" : "text-yellow-300"}>
                {speech.isSupported ? "dostępne" : "niedostępne"}
              </span>
            </div>
            <div className="flex items-center justify-between text-gray-400">
              <span>STT (nagranie)</span>
              <span className={stt.isSupported ? "text-green-400" : "text-yellow-300"}>
                {stt.isSupported ? `dostępne (${stt.mode})` : "niedostępne"}
              </span>
            </div>
            {stt.unsupportedReason && (
              <div className="rounded border border-gray-700 bg-gray-900/40 p-2 text-gray-300">
                {stt.unsupportedReason}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-green-400">✓ Zapisano</span>}
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 transition hover:text-white"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            className="rounded-lg bg-broxeen-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-broxeen-500"
          >
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}

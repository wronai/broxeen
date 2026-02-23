import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Volume2, X, Download } from "lucide-react";
import {
  withAudioSettingsDefaults,
  type AudioSettings,
} from "../domain/audioSettings";
import { logger } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";
import { useTts } from "../hooks/useTts";

interface TtsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AudioSettings;
  onSettingsChange: (settings: AudioSettings) => void;
  voices: SpeechSynthesisVoice[];
}

export default function TtsSettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  voices,
}: TtsSettingsModalProps) {
  const [local, setLocal] = useState<AudioSettings>(settings);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [piperInstalled, setPiperInstalled] = useState<boolean | null>(null);
  const [piperInstalling, setPiperInstalling] = useState(false);
  const [piperStatus, setPiperStatus] = useState<string | null>(null);
  const [testTtsText, setTestTtsText] = useState(
    "Test dźwięku. Jeśli to słyszysz, TTS działa.",
  );

  const runtimeIsTauri = isTauriRuntime();
  const tts = useTts({
    rate: local.tts_rate,
    pitch: local.tts_pitch,
    volume: local.tts_volume,
    voice: local.tts_voice,
    lang: local.tts_lang,
  });

  useEffect(() => {
    if (!isOpen) return;
    setLocal(settings);

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setAudioDevices(devices))
      .catch((e) => logger.warn("Failed to enumerate devices:", e));

    if (runtimeIsTauri) {
      invoke<boolean>("piper_is_installed")
        .then((installed) => setPiperInstalled(installed))
        .catch(() => setPiperInstalled(false));
    } else {
      setPiperInstalled(false);
    }
  }, [isOpen, runtimeIsTauri]);

  const speakerDevices = audioDevices.filter((d) => d.kind === "audiooutput");

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
      logger.error("Failed to save TTS settings:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Volume2 size={20} /> Głośnik & TTS
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* TTS on/off + engine */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
            <label className="flex items-center justify-between">
              <span className="text-sm">TTS włączony</span>
              <input
                type="checkbox"
                checked={local.tts_enabled}
                onChange={(e) => update({ tts_enabled: e.target.checked })}
                className="h-4 w-4 rounded accent-broxeen-500"
              />
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">Silnik TTS</span>
              <select
                value={local.tts_engine}
                onChange={(e) => update({ tts_engine: e.target.value })}
                className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
              >
                <option value="auto">Auto (wykryj)</option>
                <option value="piper">Piper (wysoka jakość)</option>
                <option value="espeak">eSpeak-ng (fallback)</option>
                <option value="webspeech">Web Speech API (przeglądarka)</option>
              </select>
            </label>

            {piperInstalled === false && (
              <div className="rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-3">
                <p className="mb-2 text-xs text-yellow-300">
                  Piper TTS nie jest zainstalowany. Pobierz binarkę + model głosu (~60 MB).
                </p>
                <button
                  onClick={async () => {
                    setPiperInstalling(true);
                    setPiperStatus("Pobieranie Piper TTS…");
                    try {
                      const result = await invoke<string>("piper_install");
                      setPiperStatus(result);
                      setPiperInstalled(true);
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setPiperStatus(`Błąd: ${msg}`);
                    } finally {
                      setPiperInstalling(false);
                    }
                  }}
                  disabled={piperInstalling}
                  className="flex items-center gap-2 rounded-lg bg-broxeen-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-broxeen-500 disabled:opacity-50"
                >
                  <Download size={14} />
                  {piperInstalling ? "Instalowanie…" : "Zainstaluj Piper"}
                </button>
                {piperStatus && (
                  <p className="mt-2 text-xs text-gray-400">{piperStatus}</p>
                )}
              </div>
            )}
            {piperInstalled === true && (
              <p className="text-xs text-green-400">✓ Piper TTS zainstalowany</p>
            )}
          </div>

          {/* Voice + sliders */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
            <label className="block">
              <span className="text-sm text-gray-300">Głos</span>
              <select
                value={local.tts_voice}
                onChange={(e) => update({ tts_voice: e.target.value })}
                className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
              >
                <option value="">Domyślny (polski)</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">
                Głośność: {Math.round(local.tts_volume * 100)}%
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={local.tts_volume}
                onChange={(e) => update({ tts_volume: parseFloat(e.target.value) })}
                className="mt-1 w-full accent-broxeen-500"
              />
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">
                Szybkość: {local.tts_rate.toFixed(1)}x
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={local.tts_rate}
                onChange={(e) => update({ tts_rate: parseFloat(e.target.value) })}
                className="mt-1 w-full accent-broxeen-500"
              />
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">
                Ton: {local.tts_pitch.toFixed(1)}
              </span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={local.tts_pitch}
                onChange={(e) => update({ tts_pitch: parseFloat(e.target.value) })}
                className="mt-1 w-full accent-broxeen-500"
              />
            </label>

            {speakerDevices.length > 0 && (
              <label className="block">
                <span className="text-sm text-gray-300">Głośnik</span>
                <select
                  value={local.speaker_device_id}
                  onChange={(e) => update({ speaker_device_id: e.target.value })}
                  className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
                >
                  <option value="default">Domyślne urządzenie</option>
                  {speakerDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Głośnik ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* TTS test */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-2">
            <span className="text-xs text-gray-400">Test TTS</span>
            <input
              value={testTtsText}
              onChange={(e) => setTestTtsText(e.target.value)}
              className="block w-full rounded-lg bg-gray-700 px-3 py-2 text-xs text-white"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => tts.speak(testTtsText)}
                disabled={!tts.isSupported}
                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-white transition hover:bg-gray-600 disabled:opacity-50"
              >
                Odtwórz test
              </button>
              <button
                onClick={() => tts.stop()}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-gray-700"
              >
                Stop
              </button>
              <span
                className={
                  "text-xs " +
                  (tts.isSupported ? "text-green-400" : "text-yellow-300")
                }
              >
                {tts.isSupported ? "TTS dostępne" : "TTS niedostępne"}
              </span>
            </div>
            {!tts.isSupported && tts.unsupportedReason && (
              <div className="rounded border border-yellow-600/30 bg-yellow-900/20 p-2 text-xs text-yellow-200">
                {tts.unsupportedReason}
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

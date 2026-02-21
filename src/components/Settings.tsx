import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings as SettingsIcon, X, Mic, Volume2 } from "lucide-react";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
  type AudioSettings,
} from "../domain/audioSettings";
import { logger } from "../lib/logger";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: AudioSettings) => void;
  voices: SpeechSynthesisVoice[];
}

export default function Settings({
  isOpen,
  onClose,
  onSettingsChange,
  voices,
}: SettingsProps) {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    logger.debug("Settings modal opened, loading data...");
    invoke<Partial<AudioSettings>>("get_settings")
      .then((s) => {
        logger.debug("Settings fetched from backend:", s);
        setSettings(withAudioSettingsDefaults(s));
      })
      .catch((e) => {
        logger.error("Failed to fetch settings:", e);
        setSettings(DEFAULT_AUDIO_SETTINGS);
      });

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        logger.debug(`Found ${devices.length} audio devices`);
        setAudioDevices(devices);
      })
      .catch((e) => logger.error("Failed to enumerate devices:", e));

    // Request mic permission to get device labels
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        logger.debug("Microphone permission granted for labels");
        stream.getTracks().forEach((t) => t.stop());
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => setAudioDevices(devices));
      })
      .catch((e) => logger.warn("Microphone permission denied or failed:", e));
  }, [isOpen]);

  const micDevices = audioDevices.filter((d) => d.kind === "audioinput");
  const speakerDevices = audioDevices.filter((d) => d.kind === "audiooutput");

  const update = (partial: Partial<AudioSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      logger.debug("Saving settings to backend...", settings);
      await invoke("save_settings", { settings });
      onSettingsChange(settings);
      setSaved(true);
      logger.info("Settings saved successfully");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      logger.error("Failed to save settings:", e);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <SettingsIcon size={22} /> Ustawienia Audio
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5">
          {/* TTS Section */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-gray-400">
              <Volume2 size={16} /> Text-to-Speech
            </h3>
            <div className="space-y-3 rounded-xl bg-gray-800/50 p-4">
              <label className="flex items-center justify-between">
                <span className="text-sm">TTS włączony</span>
                <input
                  type="checkbox"
                  checked={settings.tts_enabled}
                  onChange={(e) => update({ tts_enabled: e.target.checked })}
                  className="h-4 w-4 rounded accent-broxeen-500"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">Silnik TTS</span>
                <select
                  value={settings.tts_engine}
                  onChange={(e) => update({ tts_engine: e.target.value })}
                  className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
                >
                  <option value="auto">Auto (wykryj)</option>
                  <option value="piper">Piper (wysoka jakość)</option>
                  <option value="espeak">eSpeak-ng (fallback)</option>
                  <option value="webspeech">Web Speech API (przeglądarka)</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">Głos</span>
                <select
                  value={settings.tts_voice}
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
                  Szybkość: {settings.tts_rate.toFixed(1)}x
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.tts_rate}
                  onChange={(e) => update({ tts_rate: parseFloat(e.target.value) })}
                  className="mt-1 w-full accent-broxeen-500"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">
                  Głośność: {Math.round(settings.tts_volume * 100)}%
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.tts_volume}
                  onChange={(e) =>
                    update({ tts_volume: parseFloat(e.target.value) })
                  }
                  className="mt-1 w-full accent-broxeen-500"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">
                  Ton: {settings.tts_pitch.toFixed(1)}
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.tts_pitch}
                  onChange={(e) =>
                    update({ tts_pitch: parseFloat(e.target.value) })
                  }
                  className="mt-1 w-full accent-broxeen-500"
                />
              </label>

              {speakerDevices.length > 0 && (
                <label className="block">
                  <span className="text-sm text-gray-300">Głośnik</span>
                  <select
                    value={settings.speaker_device_id}
                    onChange={(e) =>
                      update({ speaker_device_id: e.target.value })
                    }
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
          </section>

          {/* Microphone Section */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-gray-400">
              <Mic size={16} /> Mikrofon
            </h3>
            <div className="space-y-3 rounded-xl bg-gray-800/50 p-4">
              <label className="flex items-center justify-between">
                <span className="text-sm">STT włączony</span>
                <input
                  type="checkbox"
                  checked={settings.stt_enabled}
                  onChange={(e) => update({ stt_enabled: e.target.checked })}
                  className="h-4 w-4 rounded accent-broxeen-500"
                />
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">Silnik STT</span>
                <select
                  value={settings.stt_engine}
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
                  value={settings.stt_model}
                  onChange={(e) => update({ stt_model: e.target.value })}
                  className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white"
                >
                  <option value="whisper-1">Whisper-1 (OpenRouter)</option>
                  <option value="whisper-1-turbo">Whisper-1 Turbo (szybszy)</option>
                </select>
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm">Mikrofon włączony</span>
                <input
                  type="checkbox"
                  checked={settings.mic_enabled}
                  onChange={(e) => update({ mic_enabled: e.target.checked })}
                  className="h-4 w-4 rounded accent-broxeen-500"
                />
              </label>

              <label className="flex items-center justify-between">
                <span className="text-sm">Auto-nasłuchiwanie</span>
                <input
                  type="checkbox"
                  checked={settings.auto_listen}
                  onChange={(e) => update({ auto_listen: e.target.checked })}
                  className="h-4 w-4 rounded accent-broxeen-500"
                />
              </label>

              {micDevices.length > 0 && (
                <label className="block">
                  <span className="text-sm text-gray-300">Urządzenie wejściowe</span>
                  <select
                    value={settings.mic_device_id}
                    onChange={(e) =>
                      update({ mic_device_id: e.target.value })
                    }
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
          </section>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm text-green-400">✓ Zapisano</span>
          )}
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
            Zapisz ustawienia
          </button>
        </div>
      </div>
    </div>
  );
}

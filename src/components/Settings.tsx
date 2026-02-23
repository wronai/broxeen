import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings as SettingsIcon,
  X,
  Mic,
  Volume2,
  Download,
} from "lucide-react";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
  type AudioSettings,
} from "../domain/audioSettings";
import { logger } from "../lib/logger";
import { isTauriRuntime } from "../lib/runtime";
import { useSpeech } from "../hooks/useSpeech";
import { useStt } from "../hooks/useStt";
import { useTts } from "../hooks/useTts";
import { CONFIG_FIELD_META } from "../config/appConfig";

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
  const [settings, setSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  
  const STT_MODELS = CONFIG_FIELD_META.find((field: any) => field.key === 'stt.model')?.options || [];
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [piperInstalled, setPiperInstalled] = useState<boolean | null>(null);
  const [piperInstalling, setPiperInstalling] = useState(false);
  const [piperStatus, setPiperStatus] = useState<string | null>(null);
  const [micPermissionState, setMicPermissionState] = useState<
    "granted" | "denied" | "prompt" | "unsupported" | "unknown"
  >("unknown");

  const runtimeIsTauri = isTauriRuntime();

  const speech = useSpeech(settings.tts_lang);
  const stt = useStt({ lang: settings.tts_lang, audioSettings: settings });
  const tts = useTts({
    rate: settings.tts_rate,
    pitch: settings.tts_pitch,
    volume: settings.tts_volume,
    voice: settings.tts_voice,
    lang: settings.tts_lang,
  });

  const shouldUseWebSpeech =
    settings.stt_engine === "webspeech" && speech.isSupported;

  const [testTtsText, setTestTtsText] = useState(
    "Test dźwięku. Jeśli to słyszysz, TTS działa.",
  );

  useEffect(() => {
    if (!isOpen) return;

    logger.debug("Settings modal opened, loading data...");
    if (runtimeIsTauri) {
      invoke<Partial<AudioSettings>>("get_settings")
        .then((s) => {
          logger.debug("Settings fetched from backend:", s);
          setSettings(withAudioSettingsDefaults(s));
        })
        .catch((e) => {
          logger.error("Failed to fetch settings:", e);
          setSettings(DEFAULT_AUDIO_SETTINGS);
        });

      invoke<boolean>("piper_is_installed")
        .then((installed) => {
          logger.debug("Piper installed:", installed);
          setPiperInstalled(installed);
        })
        .catch((e) => {
          logger.warn("Failed to check piper status:", e);
          setPiperInstalled(false);
        });
    } else {
      setSettings(DEFAULT_AUDIO_SETTINGS);
      setPiperInstalled(false);
    }

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
  }, [isOpen, runtimeIsTauri]);

  useEffect(() => {
    if (!isOpen) return;
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
          setMicPermissionState(state);
        } else {
          setMicPermissionState("unknown");
        }

        if (status && "onchange" in status) {
          status.onchange = () => {
            const next = String(status?.state || "unknown");
            if (next === "granted" || next === "denied" || next === "prompt") {
              setMicPermissionState(next);
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
  const speakerDevices = audioDevices.filter((d) => d.kind === "audiooutput");
  const hasDeviceLabels = audioDevices.some((d) => (d.label || "").trim());

  const update = (partial: Partial<AudioSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    setSaved(false);
  };

  const handleSave = async () => {
    try {
      logger.debug("Saving settings to backend...", settings);
      if (runtimeIsTauri) {
        await invoke("save_settings", { settings });
      } else {
        logger.debug("Skipped saving to Tauri backend (browser environment)");
      }
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
          {/* Diagnostics Section */}
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase text-gray-400">
              Diagnostyka
            </h3>
            <div className="space-y-3 rounded-xl bg-gray-800/50 p-4">
              <div className="text-xs text-gray-300">
                <div className="flex items-center justify-between">
                  <span>Runtime</span>
                  <span className="font-mono text-gray-200">
                    {runtimeIsTauri ? "tauri" : "browser"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Secure context</span>
                  <span className="font-mono text-gray-200">
                    {typeof window !== "undefined" && window.isSecureContext
                      ? "true"
                      : "false"}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <span>Uprawnienia mikrofonu</span>
                  <span className="font-mono text-gray-200">
                    {micPermissionState}
                  </span>
                </div>
                {micPermissionState === "unsupported" && (
                  <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-300">
                    Permissions API niedostępne w tym runtime. Diagnostyka opiera
                    się na próbie getUserMedia.
                  </div>
                )}
                {micPermissionState === "denied" && (
                  <div className="mt-1 rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-2 text-xs text-yellow-200">
                    Mikrofon jest zablokowany (denied). To zwykle nie jest
                    problem modelu ani konfiguracji STT.
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <span>Urządzenia audio</span>
                  <span className="font-mono text-gray-200">
                    in:{micDevices.length} out:{speakerDevices.length}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Etykiety urządzeń</span>
                  <span className="font-mono text-gray-200">
                    {hasDeviceLabels ? "widoczne" : "ukryte"}
                  </span>
                </div>
                {!hasDeviceLabels && (
                  <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-300">
                    Jeśli etykiety są ukryte, to zwykle oznacza brak zgody na
                    mikrofon lub ograniczenia runtime.
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between">
                  <span>STT (Web Speech)</span>
                  <span
                    className={
                      speech.isSupported
                        ? "text-green-400"
                        : "text-yellow-300"
                    }
                  >
                    {speech.isSupported ? "dostępne" : "niedostępne"}
                  </span>
                </div>
                {!speech.isSupported && speech.unsupportedReason && (
                  <div className="mt-1 rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-2 text-xs text-yellow-200">
                    {speech.unsupportedReason}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <span>STT (nagranie + transkrypcja)</span>
                  <span
                    className={
                      stt.isSupported ? "text-green-400" : "text-yellow-300"
                    }
                  >
                    {stt.isSupported
                      ? `dostępne (${stt.mode})`
                      : "niedostępne"}
                  </span>
                </div>
                {stt.unsupportedReason && (
                  <div className="mt-1 rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-300">
                    {stt.unsupportedReason}
                  </div>
                )}
                {(stt.error || stt.lastErrorDetails) && (
                  <div className="mt-1 rounded-lg border border-red-600/30 bg-red-900/20 p-2 text-xs text-red-200">
                    <div className="font-semibold">Ostatni błąd STT</div>
                    <div className="mt-1">
                      {stt.error || stt.lastErrorDetails?.message}
                    </div>
                    {stt.lastErrorDetails?.name && (
                      <div className="mt-1 text-red-300">
                        {stt.lastErrorDetails.name}
                        {stt.lastErrorDetails.constraint
                          ? ` (constraint: ${stt.lastErrorDetails.constraint})`
                          : ""}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <span>TTS</span>
                  <span
                    className={
                      tts.isSupported ? "text-green-400" : "text-yellow-300"
                    }
                  >
                    {tts.isSupported ? "dostępne" : "niedostępne"}
                  </span>
                </div>
                {!tts.isSupported && tts.unsupportedReason && (
                  <div className="mt-1 rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-2 text-xs text-yellow-200">
                    {tts.unsupportedReason}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                <label className="block">
                  <span className="text-xs text-gray-400">Test TTS</span>
                  <input
                    value={testTtsText}
                    onChange={(e) => setTestTtsText(e.target.value)}
                    className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-xs text-white"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
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

                  <button
                    onClick={() => {
                      if (shouldUseWebSpeech) {
                        speech.isListening
                          ? speech.stopListening()
                          : speech.startListening();
                        return;
                      }
                      if (stt.isSupported) {
                        stt.isRecording
                          ? stt.stopRecording()
                          : stt.startRecording();
                      }
                    }}
                    disabled={
                      !settings.mic_enabled ||
                      (!shouldUseWebSpeech && !stt.isSupported)
                    }
                    className="rounded-lg bg-broxeen-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-broxeen-500 disabled:opacity-50"
                  >
                    {shouldUseWebSpeech
                      ? speech.isListening
                        ? "Zatrzymaj nasłuch"
                        : "Test STT (nasłuch)"
                      : stt.isRecording
                        ? "Zatrzymaj nagrywanie"
                        : "Test STT (nagranie)"}
                  </button>
                  {stt.isTranscribing && (
                    <span className="text-xs text-gray-400">Transkrypcja…</span>
                  )}
                </div>
                {(speech.interimTranscript ||
                  speech.transcript ||
                  stt.transcript) && (
                  <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-200">
                    {speech.isSupported ? (
                      <>
                        {speech.interimTranscript && (
                          <div className="text-gray-400">
                            {speech.interimTranscript}
                          </div>
                        )}
                        {speech.transcript && <div>{speech.transcript}</div>}
                        {speech.finalTranscript && (
                          <div className="mt-1">{speech.finalTranscript}</div>
                        )}
                      </>
                    ) : (
                      <div>{stt.transcript}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

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
                  <option value="webspeech">
                    Web Speech API (przeglądarka)
                  </option>
                </select>
              </label>

              {piperInstalled === false && (
                <div className="rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-3">
                  <p className="mb-2 text-xs text-yellow-300">
                    Piper TTS nie jest zainstalowany. Pobierz binarkę + model
                    głosu (~60 MB).
                  </p>
                  <button
                    onClick={async () => {
                      setPiperInstalling(true);
                      setPiperStatus("Pobieranie Piper TTS…");
                      try {
                        const result = await invoke<string>("piper_install");
                        setPiperStatus(result);
                        setPiperInstalled(true);
                        logger.info("Piper installed:", result);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        setPiperStatus(`Błąd: ${msg}`);
                        logger.error("Piper install failed:", e);
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
                <p className="text-xs text-green-400">
                  ✓ Piper TTS zainstalowany
                </p>
              )}

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
                  onChange={(e) =>
                    update({ tts_rate: parseFloat(e.target.value) })
                  }
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
                  <option value="openrouter">
                    OpenRouter Whisper (chmura)
                  </option>
                  <option value="webspeech">
                    Web Speech API (przeglądarka)
                  </option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-gray-300">Model STT</span>
                <select
                  value={settings.stt_model}
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

              {settings.auto_listen && (
                <label className="block">
                  <span className="text-sm text-gray-300">
                    Pauza ciszy (ms): {settings.auto_listen_silence_ms}
                  </span>
                  <input
                    type="range"
                    min="300"
                    max="3000"
                    step="100"
                    value={settings.auto_listen_silence_ms}
                    onChange={(e) =>
                      update({
                        auto_listen_silence_ms: parseInt(e.target.value, 10),
                      })
                    }
                    className="mt-1 w-full accent-broxeen-500"
                  />
                </label>
              )}

              {micDevices.length > 0 && (
                <label className="block">
                  <span className="text-sm text-gray-300">
                    Urządzenie wejściowe
                  </span>
                  <select
                    value={settings.mic_device_id}
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
          </section>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
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
            Zapisz ustawienia
          </button>
        </div>
      </div>
    </div>
  );
}

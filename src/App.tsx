import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Activity,
  Settings as SettingsIcon,
  Network,
} from "lucide-react";
import { CqrsProvider } from "./contexts/CqrsContext";
import Chat from "./components/Chat";
import MicSettingsModal from "./components/MicSettingsModal";
import TtsSettingsModal from "./components/TtsSettingsModal";
import DiagnosticsModal from "./components/DiagnosticsModal";
import SetupWizardModal from "./components/SetupWizardModal";
import DeviceDashboardModal from "./components/DeviceDashboardModal";
import { HealthDiagnostic } from "./components/HealthDiagnostic";
import { ErrorReportPanel } from "./components/ErrorReportPanel";
import { useTts } from "./hooks/useTts";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
  type AudioSettings,
} from "./domain/audioSettings";
import { logger, logAsyncDecorator, logSyncDecorator } from "./lib/logger";
import { isTauriRuntime } from "./lib/runtime";
import { bootstrapApp, type AppContext } from "./core/bootstrap";
import { PluginProvider } from "./contexts/pluginContext";
import { ChatPersistenceBridge } from "./components/ChatPersistenceBridge";
import { AlertBridgeComponent } from "./components/AlertBridgeComponent";
import { DatabaseManagerContext } from "./hooks/useDatabaseManager";
import { runQuickHealthCheck } from "./utils/healthCheck";
import { errorReporting } from "./utils/errorReporting";
import { configStore } from "./config/configStore";

export default function App() {
  const [micSettingsOpen, setMicSettingsOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const [deviceDashboardOpen, setDeviceDashboardOpen] = useState(false);
  const [errorReportOpen, setErrorReportOpen] = useState(false);
  const [settings, setSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [appCtx, setAppCtx] = useState<AppContext | null>(null);
  const startupLogger = useMemo(() => logger.scope("startup:app"), []);

  const tts = useTts({
    rate: settings.tts_rate,
    pitch: settings.tts_pitch,
    volume: settings.tts_volume,
    voice: settings.tts_voice,
    lang: settings.tts_lang,
  });

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [micLevelActive, setMicLevelActive] = useState(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    startupLogger.info("App mounted. Running startup initialization...");
    const runtimeIsTauri = isTauriRuntime();

    startupLogger.info("Runtime detected", {
      runtime: runtimeIsTauri ? "tauri" : "browser",
    });

    // Run health check first
    const runHealthCheck = logAsyncDecorator(
      "startup:app",
      "healthCheck",
      async () => {
        try {
          const healthStatus = await runQuickHealthCheck();
          startupLogger.info("Health check completed", { status: healthStatus });
          
          if (healthStatus === 'unhealthy') {
            startupLogger.warn("Application has critical health issues - some features may not work");
          } else if (healthStatus === 'degraded') {
            startupLogger.info("Application health check passed with warnings");
          } else {
            startupLogger.info("Application health check passed");
          }
        } catch (error) {
          startupLogger.error("Health check failed", error);
        }
      }
    );

    // Initialize plugin system
    const initializePlugins = logAsyncDecorator(
      "startup:app",
      "initializePlugins",
      async () => {
        const context = await bootstrapApp({
          isTauri: runtimeIsTauri,
          tauriInvoke: runtimeIsTauri ? invoke : undefined,
        });
        setAppCtx(context);
        startupLogger.info("Plugin system initialized successfully");
      },
    );

    // Run startup sequence
    Promise.all([
      runHealthCheck(),
      initializePlugins()
    ]).catch((error) => {
      startupLogger.error("Startup initialization failed", error);
    });

    const loadSettings = logAsyncDecorator(
      "startup:app",
      "loadSettings",
      async () => {
        if (runtimeIsTauri) {
          const backendSettings =
            await invoke<Partial<AudioSettings>>("get_settings");
          startupLogger.info("Settings loaded from backend", backendSettings);
          setSettings(withAudioSettingsDefaults(backendSettings));
          return;
        }

        startupLogger.info("Using default settings (browser mode)");
        setSettings(DEFAULT_AUDIO_SETTINGS);
      },
    );

    const loadVoices = logSyncDecorator("startup:app", "loadVoices", () => {
      if (!window.speechSynthesis) return;
      const availableVoices = window.speechSynthesis.getVoices();
      startupLogger.info("Speech synthesis voices snapshot captured", {
        count: availableVoices.length,
      });
      setVoices(availableVoices);
    });

    const warmupMicrophone = logAsyncDecorator(
      "startup:app",
      "warmupMicrophone",
      async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        startupLogger.info("Microphone permission granted during startup");
        stream.getTracks().forEach((track) => track.stop());
      },
    );

    void loadSettings().catch((error) => {
      startupLogger.error("Startup settings load failed", error);
    });

    loadVoices();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // First-run onboarding: open setup wizard if no API key configured
    if (!configStore.get<string>("llm.apiKey")) {
      startupLogger.info("No API key found — opening setup wizard for first-run onboarding");
      setSetupWizardOpen(true);
    }

    const hasSpeechRecognition =
      typeof window !== "undefined" &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    if (hasSpeechRecognition) {
      void warmupMicrophone().catch((error) => {
        startupLogger.warn("Microphone warmup failed", error);
      });
    } else {
      startupLogger.debug(
        "Skipping microphone warmup – SpeechRecognition not available",
      );
    }

    return () => {
      if (window.speechSynthesis) {
        startupLogger.debug(
          "App unmount cleanup - removing speech voice listener",
        );
        window.speechSynthesis.onvoiceschanged = null;
      }
      
      // Cleanup plugin system
      if (appCtx) {
        void appCtx.dispose().catch((error: unknown) => {
          startupLogger.warn("Plugin system cleanup failed", error);
        });
      }
    };
  }, []);

  useEffect(() => {
    if (!appCtx) {
      return;
    }

    return () => {
      void appCtx.dispose().catch((error: unknown) => {
        startupLogger.warn("Plugin system cleanup failed", error);
      });
    };
  }, [appCtx, startupLogger]);

  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!md?.enumerateDevices) {
      setAudioDevices([]);
      return;
    }

    let cancelled = false;
    md.enumerateDevices()
      .then((devices) => {
        if (cancelled) return;
        setAudioDevices(devices);
      })
      .catch(() => {
        if (cancelled) return;
        setAudioDevices([]);
      });

    return () => {
      cancelled = true;
    };
  }, [micSettingsOpen, ttsSettingsOpen]);  

  useEffect(() => {
    const cleanup = () => {
      if (micAnimationFrameRef.current !== null) {
        cancelAnimationFrame(micAnimationFrameRef.current);
        micAnimationFrameRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (micAudioCtxRef.current) {
        micAudioCtxRef.current.close().catch(() => undefined);
        micAudioCtxRef.current = null;
      }
      setMicLevel(0);
      setMicLevelActive(false);
    };

    if (!settings.mic_enabled) {
      cleanup();
      return;
    }

    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (!md?.getUserMedia || typeof AudioContext === "undefined") {
      cleanup();
      return;
    }

    let cancelled = false;
    const constraints: MediaStreamConstraints = {
      audio:
        settings.mic_device_id && settings.mic_device_id !== "default"
          ? { deviceId: { exact: settings.mic_device_id } }
          : true,
    };

    md.getUserMedia(constraints)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        micStreamRef.current = stream;
        const ctx = new AudioContext();
        micAudioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);

        const loop = () => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i] ?? 0;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / Math.max(1, buf.length));
          const level = Math.max(0, Math.min(1, rms * 4));
          setMicLevel(level);
          setMicLevelActive(level > 0.02);
          micAnimationFrameRef.current = requestAnimationFrame(loop);
        };

        loop();
      })
      .catch(() => {
        cleanup();
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [settings.mic_enabled, settings.mic_device_id]);

  const micDevices = useMemo(
    () => audioDevices.filter((d) => d.kind === "audioinput"),
    [audioDevices],
  );
  const speakerDevices = useMemo(
    () => audioDevices.filter((d) => d.kind === "audiooutput"),
    [audioDevices],
  );
  const activeMic = useMemo(() => {
    if (!settings.mic_device_id || settings.mic_device_id === "default") {
      return micDevices[0] || null;
    }
    return micDevices.find((d) => d.deviceId === settings.mic_device_id) || null;
  }, [micDevices, settings.mic_device_id]);
  const activeSpeaker = useMemo(() => {
    if (!settings.speaker_device_id || settings.speaker_device_id === "default") {
      return speakerDevices[0] || null;
    }
    return (
      speakerDevices.find((d) => d.deviceId === settings.speaker_device_id) ||
      null
    );
  }, [speakerDevices, settings.speaker_device_id]);

  const persistSettings = async (next: AudioSettings) => {
    if (!isTauriRuntime()) return;
    await invoke("save_settings", { settings: next });
  };

  const updateSettings = (partial: Partial<AudioSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      void persistSettings(next).catch((error) => {
        startupLogger.warn("Failed to persist topbar settings", error);
      });
      return next;
    });
  };

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-white">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-broxeen-600 text-sm font-bold">
            B
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Broxeen</h1>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
            v1.0.1
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mic button + live level bar */}
          <button
            onClick={() => setMicSettingsOpen(true)}
            className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 transition ${
              settings.mic_enabled
                ? "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                : "bg-gray-800/50 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
            }`}
            title="Ustawienia mikrofonu & STT"
          >
            {settings.mic_enabled ? <Mic size={16} /> : <MicOff size={16} />}
            <div className="flex items-center gap-1.5">
              <div
                className={
                  "h-2 w-2 rounded-full flex-shrink-0 transition-colors " +
                  (settings.mic_enabled
                    ? micLevelActive
                      ? "bg-green-400"
                      : "bg-yellow-400/60"
                    : "bg-gray-600")
                }
              />
              <div className="h-2 w-12 overflow-hidden rounded-full bg-gray-700">
                <div
                  className={
                    "h-2 transition-all duration-75 " +
                    (micLevelActive ? "bg-green-500" : "bg-gray-600")
                  }
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
            </div>
          </button>

          {/* Speaker / TTS button */}
          <button
            onClick={() => setTtsSettingsOpen(true)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 transition ${
              settings.tts_enabled
                ? "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                : "bg-gray-800/50 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
            }`}
            title="Ustawienia głośnika & TTS"
          >
            {settings.tts_enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span className="text-[11px] font-medium">
              {Math.round(settings.tts_volume * 100)}%
              {tts.isSpeaking ? " ▶" : ""}
            </span>
          </button>

          {/* Devices dashboard button */}
          <button
            onClick={() => setDeviceDashboardOpen(true)}
            className="flex items-center justify-center rounded-lg bg-gray-800 px-2.5 py-2 text-gray-400 transition hover:bg-gray-700 hover:text-white"
            title="Urządzenia w sieci"
          >
            <Network size={16} />
          </button>

          {/* Diagnostics button */}
          <button
            onClick={() => setDiagnosticsOpen(true)}
            className="flex items-center justify-center rounded-lg bg-gray-800 px-2.5 py-2 text-gray-400 transition hover:bg-gray-700 hover:text-white"
            title="Diagnostyka"
          >
            <Activity size={16} />
          </button>

          {/* Setup wizard / settings button */}
          <button
            onClick={() => setSetupWizardOpen(true)}
            className="flex items-center justify-center rounded-lg bg-gray-800 px-2.5 py-2 text-gray-400 transition hover:bg-gray-700 hover:text-white"
            title="Konfiguracja"
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {/* Chat area */}
      <CqrsProvider>
        {appCtx ? (
          <PluginProvider context={appCtx}>
            <DatabaseManagerContext.Provider value={appCtx.databaseManager}>
              <ChatPersistenceBridge databaseManager={appCtx.databaseManager} />
              <AlertBridgeComponent autoScanScheduler={appCtx.autoScanScheduler} />
              <main className="flex-1 overflow-hidden">
                <Chat settings={settings} />
              </main>
            </DatabaseManagerContext.Provider>
          </PluginProvider>
        ) : (
          <main className="flex-1 overflow-hidden flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-broxeen-600 mx-auto mb-4"></div>
              <p className="text-gray-400">Initializing plugin system...</p>
            </div>
          </main>
        )}
      </CqrsProvider>

      {/* Mic settings modal */}
      <MicSettingsModal
        isOpen={micSettingsOpen}
        onClose={() => setMicSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        micLevel={micLevel}
        micLevelActive={micLevelActive}
      />

      {/* TTS settings modal */}
      <TtsSettingsModal
        isOpen={ttsSettingsOpen}
        onClose={() => setTtsSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        voices={voices}
      />

      {/* Diagnostics modal */}
      <DiagnosticsModal
        isOpen={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        settings={settings}
      />

      {/* Setup wizard modal */}
      <SetupWizardModal
        isOpen={setupWizardOpen}
        onClose={() => setSetupWizardOpen(false)}
      />

      {/* Device dashboard modal */}
      <DeviceDashboardModal
        isOpen={deviceDashboardOpen}
        onClose={() => setDeviceDashboardOpen(false)}
        databaseManager={appCtx?.databaseManager ?? null}
      />

      {/* Health diagnostic */}
      <HealthDiagnostic
        showOnStartup={false}
        autoRefresh={false}
        onOpenErrorReport={() => setErrorReportOpen(true)}
      />

      {/* Error report panel */}
      <ErrorReportPanel 
        isVisible={errorReportOpen} 
        onClose={() => setErrorReportOpen(false)} 
      />
    </div>
  );
}

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings as SettingsIcon } from "lucide-react";
import { CqrsProvider } from "./contexts/CqrsContext";
import Chat from "./components/Chat";
import Settings from "./components/Settings";
import { HealthDiagnostic } from "./components/HealthDiagnostic";
import { ErrorReportPanel } from "./components/ErrorReportPanel";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
  type AudioSettings,
} from "./domain/audioSettings";
import { logger, logAsyncDecorator, logSyncDecorator } from "./lib/logger";
import { isTauriRuntime } from "./lib/runtime";
import { bootstrapApp, type AppContext } from "./core/bootstrap";
import { PluginProvider } from "./contexts/pluginContext";
import { runQuickHealthCheck } from "./utils/healthCheck";
import { errorReporting } from "./utils/errorReporting";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [errorReportOpen, setErrorReportOpen] = useState(false);
  const [settings, setSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [appCtx, setAppCtx] = useState<AppContext | null>(null);
  const startupLogger = logger.scope("startup:app");

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
          tauriInvoke: (window as any).__TAURI__?.core?.invoke,
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
  }, [appCtx]);

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
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
        >
          <SettingsIcon size={16} />
          Ustawienia
        </button>
      </header>

      {/* Chat area */}
      <CqrsProvider>
        {appCtx ? (
          <PluginProvider context={appCtx}>
            <main className="flex-1 overflow-hidden">
              <Chat settings={settings} />
            </main>
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

      {/* Settings modal */}
      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={setSettings}
        voices={voices}
      />

      {/* Health diagnostic */}
      <HealthDiagnostic showOnStartup={false} autoRefresh={false} />

      {/* Error report panel */}
      <ErrorReportPanel 
        isVisible={errorReportOpen} 
        onClose={() => setErrorReportOpen(false)} 
      />

      {/* Debug controls - only in development */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-4 left-4 flex gap-2 z-40">
          <button
            onClick={() => setErrorReportOpen(true)}
            className="bg-red-600 text-white px-3 py-2 rounded-lg shadow-lg hover:bg-red-700 transition-colors flex items-center gap-2"
            title="Pokaż raport błędów"
          >
            🚨 Błędy
          </button>
        </div>
      )}
    </div>
  );
}

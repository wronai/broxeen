import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings as SettingsIcon } from "lucide-react";
import Chat from "./components/Chat";
import Settings from "./components/Settings";
import { logger } from "./lib/logger";

// Check if running in Tauri environment
const isTauriApp = typeof window !== 'undefined' && '__TAURI__' in window;

interface AudioSettings {
  tts_enabled: boolean;
  tts_rate: number;
  tts_pitch: number;
  tts_volume: number;
  tts_voice: string;
  tts_lang: string;
  mic_enabled: boolean;
  mic_device_id: string;
  speaker_device_id: string;
  auto_listen: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = {
  tts_enabled: true,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  tts_voice: "",
  tts_lang: "pl-PL",
  mic_enabled: true,
  mic_device_id: "default",
  speaker_device_id: "default",
  auto_listen: false,
};

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    logger.debug("App component mounted, fetching settings...");
    
    if (isTauriApp) {
      invoke<AudioSettings>("get_settings")
        .then((s) => {
          logger.debug("Settings loaded:", s);
          setSettings(s);
        })
        .catch((e) => {
          logger.error("Failed to load settings:", e);
        });
    } else {
      // Browser fallback - use default settings
      logger.debug("Running in browser mode, using default settings");
      setSettings(DEFAULT_SETTINGS);
    }

    const loadVoices = () => {
      const availableVoices = window.speechSynthesis.getVoices();
      logger.debug(`Voices loaded: ${availableVoices.length}`);
      setVoices(availableVoices);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    // Request microphone permission on startup for default device
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {});

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

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
      <main className="flex-1 overflow-hidden">
        <Chat settings={settings} />
      </main>

      {/* Settings modal */}
      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={setSettings}
        voices={voices}
      />
    </div>
  );
}

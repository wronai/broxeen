import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Key,
  Brain,
  Network,
  Mic,
  Volume2,
  Activity,
  Eye,
  EyeOff,
} from "lucide-react";
import { configStore } from "../config/configStore";
import { isTauriRuntime } from "../lib/runtime";
import { chat } from "../lib/llmClient";
import { CONFIG_FIELD_META } from "../config/appConfig";

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMicSettings?: () => void;
  onOpenTtsSettings?: () => void;
  onOpenDiagnostics?: () => void;
  onOpenDeviceDashboard?: () => void;
}

const MODELS = CONFIG_FIELD_META.find((field: any) => field.key === 'llm.model')?.options || [];

const STEPS = [
  { id: "api", label: "Klucz API", icon: Key },
  { id: "model", label: "Model AI", icon: Brain },
  { id: "network", label: "Sieć", icon: Network },
  { id: "summary", label: "Gotowe", icon: Check },
];

export default function SetupWizardModal({
  isOpen,
  onClose,
  onOpenMicSettings,
  onOpenTtsSettings,
  onOpenDiagnostics,
  onOpenDeviceDashboard,
}: SetupWizardModalProps) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("google/gemini-2.0-flash");
  const [subnet, setSubnet] = useState("192.168.1");
  const [saved, setSaved] = useState(false);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);

  const [apiKeyTestLoading, setApiKeyTestLoading] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<
    { ok: boolean; message: string } | null
  >(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setSaved(false);
    setApiKey(configStore.get<string>("llm.apiKey") || "");
    setModel(configStore.get<string>("llm.model") || "google/gemini-2.0-flash");
    setSubnet(configStore.get<string>("network.defaultSubnet") || "192.168.1");
    setApiKeyTestResult(null);

    // Check autostart status
    if (isTauriRuntime()) {
      invoke<boolean>("autostart_status")
        .then(setAutostartEnabled)
        .catch(() => setAutostartEnabled(false));
    }
  }, [isOpen]);

  const toggleAutostart = async () => {
    if (!isTauriRuntime()) return;
    setAutostartLoading(true);
    try {
      if (autostartEnabled) {
        await invoke("autostart_disable");
        setAutostartEnabled(false);
      } else {
        await invoke("autostart_enable");
        setAutostartEnabled(true);
      }
    } catch (err) {
      console.warn("Autostart toggle failed:", err);
    } finally {
      setAutostartLoading(false);
    }
  };

  const handleSave = () => {
    configStore.setMany({
      "llm.apiKey": apiKey.trim(),
      "llm.model": model,
      "network.defaultSubnet": subnet.trim(),
    });
    setSaved(true);
    setStep(3);
  };

  const runtimeIsTauri = isTauriRuntime();
  const configStatus = useMemo(() => configStore.getConfigStatus(), [saved]);
  const hasSpeechRecognition =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);
  const hasSpeechSynthesis =
    typeof window !== "undefined" && !!(window as any).speechSynthesis;

  const apiKeyTrimmed = apiKey.trim();
  const apiKeyLooksValid =
    apiKeyTrimmed.length > 0 &&
    (apiKeyTrimmed.startsWith("sk-or-v1-") || apiKeyTrimmed.startsWith("sk-"));

  const testApiKey = async () => {
    const key = apiKey.trim();
    if (!key) return;

    setApiKeyTestLoading(true);
    setApiKeyTestResult(null);
    try {
      await chat(
        [
          {
            role: "system",
            content:
              "Odpowiedz jednym krótkim słowem: OK. Nie dodawaj nic więcej.",
          },
          { role: "user", content: "test" },
        ],
        { apiKey: key, model },
      );
      setApiKeyTestResult({ ok: true, message: "Połączenie OK" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setApiKeyTestResult({ ok: false, message: msg });
    } finally {
      setApiKeyTestLoading(false);
    }
  };

  const canProceed = () => {
    if (step === 0) return apiKey.trim().length > 0;
    return true;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="text-lg font-bold">Konfiguracja Broxeen</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 border-b border-gray-800 px-6 py-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step || (i === 3 && saved);
            const active = i === step;
            return (
              <div key={s.id} className="flex items-center">
                <button
                  onClick={() => i < step && setStep(i)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-broxeen-600 text-white"
                      : done
                        ? "text-green-400 hover:bg-gray-800 cursor-pointer"
                        : "text-gray-500 cursor-default"
                  }`}
                >
                  <Icon size={13} />
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight size={14} className="mx-0.5 text-gray-700" />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 min-h-[280px]">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold mb-1">Klucz API OpenRouter</h3>
                <p className="text-sm text-gray-400">
                  Broxeen używa{" "}
                  <a
                    href="https://openrouter.ai"
                    target="_blank"
                    rel="noreferrer"
                    className="text-broxeen-400 underline"
                  >
                    OpenRouter
                  </a>{" "}
                  do obsługi modeli AI. Klucz jest przechowywany lokalnie.
                </p>
              </div>
              <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
                <label className="block">
                  <span className="text-sm text-gray-300">Klucz API</span>
                  <div className="relative mt-1">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-or-v1-..."
                      className="block w-full rounded-lg bg-gray-700 px-3 py-2 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-broxeen-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
                {apiKeyTrimmed && !apiKeyLooksValid && (
                  <p className="text-xs text-yellow-300">
                    ⚠️ Klucz OpenRouter zazwyczaj zaczyna się od <code>sk-or-v1-</code>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void testApiKey()}
                    disabled={!apiKeyTrimmed || apiKeyTestLoading}
                    className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-white transition hover:bg-gray-600 disabled:opacity-50"
                  >
                    {apiKeyTestLoading ? "Testuję…" : "Testuj klucz"}
                  </button>
                  {apiKeyTestResult && (
                    <span
                      className={
                        "text-xs " +
                        (apiKeyTestResult.ok
                          ? "text-green-400"
                          : "text-yellow-300")
                      }
                    >
                      {apiKeyTestResult.ok
                        ? `✓ ${apiKeyTestResult.message}`
                        : `⚠ ${apiKeyTestResult.message}`}
                    </span>
                  )}
                </div>
                {!apiKey.trim() && (
                  <p className="text-xs text-gray-500">
                    Utwórz klucz na{" "}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-broxeen-400 underline"
                    >
                      openrouter.ai/keys
                    </a>
                  </p>
                )}
              </div>
              {configStore.get<string>("llm.apiKey") && (
                <p className="text-xs text-green-400">
                  ✓ Klucz API jest już zapisany — możesz go zaktualizować lub pominąć.
                </p>
              )}

              <div className="rounded-xl bg-gray-800/30 p-3 text-xs text-gray-400 space-y-1.5">
                <div className="font-medium text-gray-300">Status</div>
                <div className="flex items-center justify-between">
                  <span>Runtime</span>
                  <span className="font-mono text-gray-200">
                    {runtimeIsTauri ? "tauri" : "browser"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>SpeechRecognition</span>
                  <span className={hasSpeechRecognition ? "text-green-400" : "text-yellow-300"}>
                    {hasSpeechRecognition ? "dostępne" : "brak"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>SpeechSynthesis</span>
                  <span className={hasSpeechSynthesis ? "text-green-400" : "text-yellow-300"}>
                    {hasSpeechSynthesis ? "dostępne" : "brak"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Braki konfiguracji</span>
                  <span className={configStatus.missingFields.length === 0 ? "text-green-400" : "text-yellow-300"}>
                    {configStatus.missingFields.length === 0
                      ? "brak"
                      : configStatus.missingFields.join(", ")}
                  </span>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold mb-1">Wybierz model AI</h3>
                <p className="text-sm text-gray-400">
                  Model używany do rozmów, analizy i poleceń.
                </p>
              </div>
              <div className="space-y-2">
                {MODELS.map((m: any) => (
                  <button
                    key={m.value}
                    onClick={() => setModel(m.value)}
                    className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-left transition border ${
                      model === m.value
                        ? "border-broxeen-500 bg-broxeen-600/20 text-white"
                        : "border-gray-700 bg-gray-800/40 text-gray-300 hover:border-gray-600 hover:bg-gray-800"
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-gray-400">{m.description}</div>
                    </div>
                    {model === m.value && (
                      <Check size={16} className="text-broxeen-400 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold mb-1">Konfiguracja sieci</h3>
                <p className="text-sm text-gray-400">
                  Podsieć używana do skanowania urządzeń (np. kamer IP).
                </p>
              </div>
              <div className="rounded-xl bg-gray-800/50 p-4 space-y-3">
                <label className="block">
                  <span className="text-sm text-gray-300">Domyślna podsieć</span>
                  <input
                    type="text"
                    value={subnet}
                    onChange={(e) => setSubnet(e.target.value)}
                    placeholder="192.168.1"
                    className="mt-1 block w-full rounded-lg bg-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-broxeen-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Format: pierwsze 3 oktety, np. <code>192.168.1</code> lub <code>10.0.0</code>
                  </p>
                </label>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  {["192.168.0", "192.168.1", "192.168.188", "10.0.0", "10.0.1", "172.16.0"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSubnet(s)}
                      className={`rounded-lg px-2 py-1.5 text-xs font-mono transition border ${
                        subnet === s
                          ? "border-broxeen-500 bg-broxeen-600/20 text-white"
                          : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-white"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {/* Autostart toggle */}
              {isTauriRuntime() && (
                <div className="rounded-xl bg-gray-800/50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-gray-300">Autostart przy starcie systemu</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Broxeen uruchomi się automatycznie po zalogowaniu
                      </p>
                    </div>
                    <button
                      onClick={() => void toggleAutostart()}
                      disabled={autostartLoading}
                      className={`relative flex h-7 w-12 items-center rounded-full transition-colors ${
                        autostartEnabled ? "bg-broxeen-600" : "bg-gray-700"
                      } ${autostartLoading ? "opacity-50" : ""}`}
                    >
                      <div
                        className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          autostartEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-gray-800/30 p-3 text-xs text-gray-400 space-y-1">
                <div className="font-medium text-gray-300">💡 Wskazówka</div>
                <div>
                  Wpisz <code className="text-broxeen-300">skanuj sieć</code> w chacie aby automatycznie wykryć urządzenia.
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                  <Check size={24} />
                </div>
                <div>
                  <h3 className="text-base font-semibold">Konfiguracja zapisana!</h3>
                  <p className="text-sm text-gray-400">Broxeen jest gotowy do użycia.</p>
                </div>
              </div>

              <div className="rounded-xl bg-gray-800/50 p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Klucz API</span>
                  <span className={apiKey.trim() ? "text-green-400" : "text-yellow-300"}>
                    {apiKey.trim() ? "✓ Ustawiony" : "⚠ Brak"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Model AI</span>
                  <span className="text-gray-200 font-mono text-xs">{model.split("/")[1]}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Podsieć</span>
                  <span className="text-gray-200 font-mono text-xs">{subnet}.0/24</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Autostart</span>
                  <span className={autostartEnabled ? "text-green-400" : "text-gray-500"}>
                    {autostartEnabled ? "✓ Włączony" : "Wyłączony"}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-gray-800/30 p-3 text-xs text-gray-400 space-y-1.5">
                <div className="font-medium text-gray-300">🚀 Zacznij od:</div>
                <div>• Wpisz <code className="text-broxeen-300">skanuj sieć</code> — znajdź urządzenia</div>
                <div>• Wpisz <code className="text-broxeen-300">pomoc</code> — lista komend</div>
                <div>• Kliknij ikonę <strong>⚙</strong> aby zmienić ustawienia w dowolnym momencie</div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onOpenMicSettings?.()}
                  disabled={!onOpenMicSettings}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-200 transition hover:bg-gray-700 disabled:opacity-50"
                >
                  <Mic size={14} /> Mikrofon / STT
                </button>
                <button
                  onClick={() => onOpenTtsSettings?.()}
                  disabled={!onOpenTtsSettings}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-200 transition hover:bg-gray-700 disabled:opacity-50"
                >
                  <Volume2 size={14} /> Głośnik / TTS
                </button>
                <button
                  onClick={() => onOpenDiagnostics?.()}
                  disabled={!onOpenDiagnostics}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-200 transition hover:bg-gray-700 disabled:opacity-50"
                >
                  <Activity size={14} /> Diagnostyka
                </button>
                <button
                  onClick={() => onOpenDeviceDashboard?.()}
                  disabled={!onOpenDeviceDashboard}
                  className="flex items-center justify-center gap-2 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-200 transition hover:bg-gray-700 disabled:opacity-50"
                >
                  <Network size={14} /> Urządzenia
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-800 px-6 py-4">
          <button
            onClick={() => step > 0 && step < 3 ? setStep(step - 1) : onClose()}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm text-gray-400 transition hover:text-white"
          >
            {step === 3 ? (
              "Zamknij"
            ) : (
              <>
                <ChevronLeft size={15} />
                {step === 0 ? "Anuluj" : "Wstecz"}
              </>
            )}
          </button>

          {step < 2 && (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-1.5 rounded-lg bg-broxeen-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-broxeen-500 disabled:opacity-40"
            >
              Dalej
              <ChevronRight size={15} />
            </button>
          )}

          {step === 2 && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500"
            >
              <Check size={15} />
              Zapisz i zakończ
            </button>
          )}

          {step === 3 && (
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg bg-broxeen-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-broxeen-500"
            >
              Gotowe
              <Check size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

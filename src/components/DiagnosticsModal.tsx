import { useState, useEffect } from "react";
import { Activity, X } from "lucide-react";
import { type AudioSettings } from "../domain/audioSettings";
import { isTauriRuntime } from "../lib/runtime";
import { useSpeech } from "../hooks/useSpeech";
import { useStt } from "../hooks/useStt";
import { useTts } from "../hooks/useTts";

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AudioSettings;
}

export default function DiagnosticsModal({
  isOpen,
  onClose,
  settings,
}: DiagnosticsModalProps) {
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [micPermissionState, setMicPermissionState] = useState<
    "granted" | "denied" | "prompt" | "unsupported" | "unknown"
  >("unknown");
  const [testTtsText, setTestTtsText] = useState(
    "Test dźwięku. Jeśli to słyszysz, TTS działa.",
  );

  const runtimeIsTauri = isTauriRuntime();
  const speech = useSpeech(settings.tts_lang);
  const stt = useStt({ lang: settings.tts_lang });
  const tts = useTts({
    rate: settings.tts_rate,
    pitch: settings.tts_pitch,
    volume: settings.tts_volume,
    voice: settings.tts_voice,
    lang: settings.tts_lang,
  });

  useEffect(() => {
    if (!isOpen) return;

    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setAudioDevices(devices))
      .catch(() => setAudioDevices([]));

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => setAudioDevices(devices));
      })
      .catch(() => {});

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
  const speakerDevices = audioDevices.filter((d) => d.kind === "audiooutput");
  const hasDeviceLabels = audioDevices.some((d) => (d.label || "").trim());

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-gray-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Activity size={20} /> Diagnostyka
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Runtime info */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-2 text-xs">
            <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2">
              Środowisko
            </h3>
            <div className="flex items-center justify-between text-gray-300">
              <span>Runtime</span>
              <span className="font-mono text-gray-200">
                {runtimeIsTauri ? "tauri" : "browser"}
              </span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Secure context</span>
              <span className="font-mono text-gray-200">
                {typeof window !== "undefined" && window.isSecureContext
                  ? "true"
                  : "false"}
              </span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Uprawnienia mikrofonu</span>
              <span
                className={
                  "font-mono " +
                  (micPermissionState === "granted"
                    ? "text-green-400"
                    : micPermissionState === "denied"
                      ? "text-red-400"
                      : "text-gray-200")
                }
              >
                {micPermissionState}
              </span>
            </div>
            {micPermissionState === "denied" && (
              <div className="rounded-lg border border-yellow-600/30 bg-yellow-900/20 p-2 text-yellow-200">
                Mikrofon jest zablokowany (denied). Sprawdź ustawienia przeglądarki/systemu.
              </div>
            )}
          </div>

          {/* Audio devices */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-2 text-xs">
            <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2">
              Urządzenia audio
            </h3>
            <div className="flex items-center justify-between text-gray-300">
              <span>Wejście (mikrofony)</span>
              <span className="font-mono text-gray-200">{micDevices.length}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Wyjście (głośniki)</span>
              <span className="font-mono text-gray-200">{speakerDevices.length}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span>Etykiety urządzeń</span>
              <span
                className={
                  "font-mono " + (hasDeviceLabels ? "text-green-400" : "text-yellow-300")
                }
              >
                {hasDeviceLabels ? "widoczne" : "ukryte"}
              </span>
            </div>
            {!hasDeviceLabels && (
              <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-gray-300">
                Etykiety ukryte — brak zgody na mikrofon lub ograniczenia runtime.
              </div>
            )}
          </div>

          {/* API availability */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-2 text-xs">
            <h3 className="text-xs font-semibold uppercase text-gray-400 mb-2">
              Dostępność API
            </h3>
            <div className="flex items-center justify-between text-gray-300">
              <span>STT (Web Speech)</span>
              <span className={speech.isSupported ? "text-green-400" : "text-yellow-300"}>
                {speech.isSupported ? "dostępne" : "niedostępne"}
              </span>
            </div>
            {!speech.isSupported && speech.unsupportedReason && (
              <div className="rounded border border-yellow-600/30 bg-yellow-900/20 p-2 text-yellow-200">
                {speech.unsupportedReason}
              </div>
            )}
            <div className="flex items-center justify-between text-gray-300">
              <span>STT (nagranie + transkrypcja)</span>
              <span className={stt.isSupported ? "text-green-400" : "text-yellow-300"}>
                {stt.isSupported ? `dostępne (${stt.mode})` : "niedostępne"}
              </span>
            </div>
            {stt.unsupportedReason && (
              <div className="rounded border border-gray-700 bg-gray-900/40 p-2 text-gray-300">
                {stt.unsupportedReason}
              </div>
            )}
            {(stt.error || stt.lastErrorDetails) && (
              <div className="rounded border border-red-600/30 bg-red-900/20 p-2 text-red-200">
                <div className="font-semibold">Ostatni błąd STT</div>
                <div className="mt-1">{stt.error || stt.lastErrorDetails?.message}</div>
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
            <div className="flex items-center justify-between text-gray-300">
              <span>TTS</span>
              <span className={tts.isSupported ? "text-green-400" : "text-yellow-300"}>
                {tts.isSupported ? "dostępne" : "niedostępne"}
              </span>
            </div>
            {!tts.isSupported && tts.unsupportedReason && (
              <div className="rounded border border-yellow-600/30 bg-yellow-900/20 p-2 text-yellow-200">
                {tts.unsupportedReason}
              </div>
            )}
          </div>

          {/* Test buttons */}
          <div className="rounded-xl bg-gray-800/50 p-4 space-y-2">
            <span className="text-xs text-gray-400">Test TTS / STT</span>
            <input
              value={testTtsText}
              onChange={(e) => setTestTtsText(e.target.value)}
              className="block w-full rounded-lg bg-gray-700 px-3 py-2 text-xs text-white"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => tts.speak(testTtsText)}
                disabled={!tts.isSupported}
                className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs text-white transition hover:bg-gray-600 disabled:opacity-50"
              >
                Odtwórz TTS
              </button>
              <button
                onClick={() => tts.stop()}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition hover:bg-gray-700"
              >
                Stop TTS
              </button>
              <button
                onClick={() => {
                  if (speech.isSupported) {
                    speech.isListening ? speech.stopListening() : speech.startListening();
                    return;
                  }
                  if (stt.isSupported) {
                    stt.isRecording ? stt.stopRecording() : stt.startRecording();
                  }
                }}
                disabled={!settings.mic_enabled || (!speech.isSupported && !stt.isSupported)}
                className="rounded-lg bg-broxeen-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-broxeen-500 disabled:opacity-50"
              >
                {speech.isSupported
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
            {(speech.interimTranscript || speech.transcript || stt.transcript) && (
              <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-2 text-xs text-gray-200">
                {speech.isSupported ? (
                  <>
                    {speech.interimTranscript && (
                      <div className="text-gray-400">{speech.interimTranscript}</div>
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

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-700 hover:text-white"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}

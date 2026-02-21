import { Play, Pause, Square, Volume2 } from "lucide-react";

interface TtsControlsProps {
  isSpeaking: boolean;
  isPaused: boolean;
  progress: number;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export default function TtsControls({
  isSpeaking,
  isPaused,
  progress,
  onSpeak,
  onPause,
  onResume,
  onStop,
}: TtsControlsProps) {
  return (
    <div className="flex items-center gap-2">
      {!isSpeaking ? (
        <button
          onClick={onSpeak}
          className="flex items-center gap-1.5 rounded-lg bg-broxeen-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-broxeen-500"
          title="Odczytaj (TTS)"
        >
          <Volume2 size={16} />
          Odsłuchaj
        </button>
      ) : (
        <>
          {isPaused ? (
            <button
              onClick={onResume}
              className="rounded-lg bg-broxeen-600 p-1.5 text-white transition hover:bg-broxeen-500"
              title="Wznów"
            >
              <Play size={16} />
            </button>
          ) : (
            <button
              onClick={onPause}
              className="rounded-lg bg-yellow-600 p-1.5 text-white transition hover:bg-yellow-500"
              title="Pauza"
            >
              <Pause size={16} />
            </button>
          )}
          <button
            onClick={onStop}
            className="rounded-lg bg-red-600 p-1.5 text-white transition hover:bg-red-500"
            title="Stop"
          >
            <Square size={16} />
          </button>
          <div className="ml-1 h-1.5 w-24 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-broxeen-400 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

import { Play, Pause, Square } from "lucide-react";
import { logger } from "../lib/logger";

interface TtsControlsProps {
  isSpeaking: boolean;
  isPaused: boolean;
  progress: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export default function TtsControls({
  isSpeaking,
  isPaused,
  progress,
  onPause,
  onResume,
  onStop,
}: TtsControlsProps) {
  const handlePause = () => {
    logger.debug("TTS Controls: Pauza clicked");
    onPause();
  };

  const handleResume = () => {
    logger.debug("TTS Controls: Wznów clicked");
    onResume();
  };

  const handleStop = () => {
    logger.debug("TTS Controls: Stop clicked");
    onStop();
  };

  return (
    <div className="flex items-center gap-2">
      {isPaused ? (
        <button
          onClick={handleResume}
          className="rounded-lg bg-broxeen-600 p-1.5 text-white transition hover:bg-broxeen-500"
          title="Wznów"
        >
          <Play size={16} />
        </button>
      ) : (
        <button
          onClick={handlePause}
          className="rounded-lg bg-yellow-600 p-1.5 text-white transition hover:bg-yellow-500"
          title="Pauza"
        >
          <Pause size={16} />
        </button>
      )}
      {isSpeaking && (
        <>
          <button
            onClick={handleStop}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function CameraLiveInline(props: {
  url: string;
  cameraId: string;
  fps?: number;
  className?: string;
  imageClassName?: string;
  onClickImage?: (data: { base64: string; mimeType: string }) => void;
}) {
  const fps = Math.max(0.2, props.fps ?? 1);
  const intervalMs = useMemo(() => Math.round(1000 / fps), [fps]);

  const [frame, setFrame] = useState<{ base64: string; mimeType: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || !running) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const res = (await invoke("rtsp_capture_frame", {
          url: props.url,
          cameraId: props.cameraId,
          camera_id: props.cameraId,
        })) as { base64?: string };

        if (!cancelled && res?.base64) {
          setFrame({ base64: res.base64, mimeType: "image/jpeg" });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    void tick();
    timerRef.current = window.setInterval(() => void tick(), intervalMs);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [intervalMs, props.url, props.cameraId, running]);

  return (
    <div className={props.className}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs text-gray-400 truncate">
          Live {fps}fps — {props.cameraId}
        </div>
        <button
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
          onClick={() => setRunning((v) => !v)}
        >
          {running ? "Pauza" : "Start"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 mb-2 break-words">
          {error}
        </div>
      )}

      {frame ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.base64}`}
          alt={`Live ${props.cameraId}`}
          className={
            props.imageClassName ??
            "w-full h-auto object-contain max-h-80 rounded cursor-pointer hover:opacity-90 transition-opacity"
          }
          onClick={() => props.onClickImage?.(frame)}
        />
      ) : (
        <div className="w-full max-h-80 h-48 rounded bg-black/40 border border-gray-700 flex items-center justify-center text-gray-400 text-sm">
          Ładowanie klatki...
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const FRAME_CACHE = new Map<string, { base64: string; mimeType: string; ts: number }>();

export function CameraLiveInline(props: {
  url: string;
  cameraId: string;
  fps?: number;
  className?: string;
  imageClassName?: string;
  onClickImage?: (data: { base64: string; mimeType: string }) => void;
  initialFrame?: { base64: string; mimeType: string } | null;
  /** HTTP snapshot URL to fall back to when RTSP fails */
  snapshotUrl?: string | null;
  /** When true, skip RTSP entirely and start in HTTP snapshot mode immediately */
  startInSnapshotMode?: boolean;
}) {
  const fps = Math.max(0.2, props.fps ?? 1);
  const intervalMs = useMemo(() => Math.round(1000 / fps), [fps]);

  const cacheKey = useMemo(() => `${props.cameraId}|${props.url}`, [props.cameraId, props.url]);
  const [frame, setFrame] = useState<{ base64: string; mimeType: string } | null>(() => {
    if (props.initialFrame) return props.initialFrame;
    const cached = FRAME_CACHE.get(`${props.cameraId}|${props.url}`);
    return cached ? { base64: cached.base64, mimeType: cached.mimeType } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [effectiveFps, setEffectiveFps] = useState<number | null>(null);
  const [backendFrameCount, setBackendFrameCount] = useState<number | null>(null);
  // Track consecutive RTSP failures to trigger HTTP snapshot fallback
  const [usingSnapshot, setUsingSnapshot] = useState(() => !!(props.startInSnapshotMode && props.snapshotUrl));
  const rtspFailCountRef = useRef(0);
  const RTSP_FAIL_THRESHOLD = 3;

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // If caller provides an initial frame later, use it as an instant preview.
    if (props.initialFrame) {
      setFrame(props.initialFrame);
    }

    async function tick() {
      if (cancelled || !running) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      // Determine whether to use HTTP snapshot fallback
      const useHttp = usingSnapshot && !!props.snapshotUrl;

      try {
        let base64: string | undefined;
        let mimeType = "image/jpeg";
        let frameCount: number | undefined;

        if (useHttp) {
          // HTTP snapshot path via Tauri backend (avoids CORS)
          const res = (await invoke("http_fetch_base64", {
            url: props.snapshotUrl,
          })) as { base64?: string; content_type?: string | null; status?: number };
          if (res?.base64 && (res.status === undefined || (res.status >= 200 && res.status < 300))) {
            base64 = res.base64;
            mimeType = (res.content_type && res.content_type.includes('png')) ? 'image/png' : 'image/jpeg';
          }
        } else {
          // RTSP path
          const res = (await invoke("rtsp_capture_frame", {
            url: props.url,
            cameraId: props.cameraId,
            camera_id: props.cameraId,
          })) as { base64?: string; frame_count?: number; frame_age_ms?: number };
          base64 = res?.base64;
          frameCount = res?.frame_count;
        }

        if (!cancelled && base64) {
          const next = { base64, mimeType };
          setFrame(next);
          FRAME_CACHE.set(cacheKey, { ...next, ts: Date.now() });
          if (typeof frameCount === 'number') setBackendFrameCount(frameCount);
          // Reset RTSP fail counter on success
          if (!useHttp) rtspFailCountRef.current = 0;
          const now = Date.now();
          setLastFrameAt((prev) => {
            if (typeof prev === 'number' && prev > 0) {
              const dt = now - prev;
              if (dt > 0) {
                const nextFps = 1000 / dt;
                setEffectiveFps((old) => (typeof old === 'number' ? old * 0.7 + nextFps * 0.3 : nextFps));
              }
            }
            return now;
          });
          setError(null);
        } else if (!cancelled && !useHttp) {
          // RTSP returned no frame — count as failure
          rtspFailCountRef.current += 1;
          if (rtspFailCountRef.current >= RTSP_FAIL_THRESHOLD && props.snapshotUrl) {
            setUsingSnapshot(true);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!useHttp) {
            // Count RTSP errors toward fallback threshold
            rtspFailCountRef.current += 1;
            if (rtspFailCountRef.current >= RTSP_FAIL_THRESHOLD && props.snapshotUrl) {
              setUsingSnapshot(true);
              setError(null); // suppress RTSP error once we switch
            } else {
              setError(msg);
            }
          } else {
            setError(`HTTP snapshot: ${msg}`);
          }
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
  }, [intervalMs, props.url, props.cameraId, running, cacheKey, props.initialFrame, props.snapshotUrl, usingSnapshot]);

  return (
    <div className={props.className}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs text-gray-400 truncate">
          Live {fps}fps{typeof effectiveFps === 'number' ? ` (${effectiveFps.toFixed(1)})` : ''}{typeof backendFrameCount === 'number' ? ` #${backendFrameCount}` : ''} — {props.cameraId}
          {usingSnapshot && <span className="ml-1 text-amber-400">[HTTP snapshot]</span>}
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
            "w-full h-auto object-contain rounded cursor-pointer hover:opacity-90 transition-opacity"
          }
          onClick={() => props.onClickImage?.(frame)}
        />
      ) : (
        <div className="w-full h-48 rounded bg-black/40 border border-gray-700 flex items-center justify-center text-gray-400 text-sm">
          Ładowanie klatki...
        </div>
      )}
    </div>
  );
}

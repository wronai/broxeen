import { CameraLiveInline } from "./CameraLiveInline";

export interface ExpandedImageData {
  data: string;
  mimeType?: string;
}

export interface ExpandedLiveData {
  url: string;
  cameraId: string;
  fps?: number;
  initialBase64?: string;
  initialMimeType?: string;
}

interface ChatOverlaysProps {
  expandedImage: ExpandedImageData | null;
  expandedLive: ExpandedLiveData | null;
  onCloseImage: () => void;
  onCloseLive: () => void;
}

export function ChatOverlays({ expandedImage, expandedLive, onCloseImage, onCloseLive }: ChatOverlaysProps) {
  return (
    <>
      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={onCloseImage}
        >
          <div className="relative max-h-full max-w-full">
            <button
              className="absolute -top-10 right-0 p-2 text-white hover:text-gray-300"
              onClick={onCloseImage}
            >
              Zamknij (ESC)
            </button>
            <img
              src={`data:${expandedImage.mimeType || 'image/jpeg'};base64,${expandedImage.data}`}
              alt="Powiększony obraz"
              className="max-h-[90vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {expandedLive && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={onCloseLive}
        >
          <div className="relative h-full w-full max-w-6xl">
            <button
              className="absolute -top-10 right-0 p-2 text-white hover:text-gray-300"
              onClick={onCloseLive}
            >
              Zamknij (ESC)
            </button>
            <div className="h-full w-full" onClick={(e) => e.stopPropagation()}>
              <CameraLiveInline
                url={expandedLive.url}
                cameraId={expandedLive.cameraId}
                fps={expandedLive.fps}
                initialFrame={
                  expandedLive.initialBase64
                    ? { base64: expandedLive.initialBase64, mimeType: expandedLive.initialMimeType || 'image/jpeg' }
                    : null
                }
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Camera Preview Component
 * Displays camera preview with video stream
 */

import React, { useState, useRef, useEffect } from 'react';
import { Camera, Play, Pause, Maximize2, Settings, Volume2, VolumeX } from 'lucide-react';

export interface CameraPreviewProps {
  camera: {
    id: string;
    name: string;
    ip: string;
    status: 'online' | 'offline';
    type: string;
    streamUrl?: string;
    snapshot?: string;
  };
  onSelect?: (camera: any) => void;
  className?: string;
}

export const CameraPreview: React.FC<CameraPreviewProps> = ({
  camera,
  onSelect,
  className = ''
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup stream on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handlePlay = async () => {
    if (!camera.streamUrl) {
      setError('Brak dostępnego strumienia wideo');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // For RTSP/MJPEG streams, we'll use a placeholder approach
      // In a real implementation, this would connect to the actual camera stream
      if (videoRef.current) {
        // Simulate video stream (1 FPS as requested)
        const mockStream = createMockVideoStream();
        videoRef.current.srcObject = mockStream;
        streamRef.current = mockStream;
        
        await videoRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      setError('Nie udało się uruchomić strumienia');
      console.error('Camera stream error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const handleMuteToggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      videoRef.current.requestFullscreen?.();
    }
  };

  // Create mock video stream for testing
  const createMockVideoStream = (): MediaStream => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    
    // Create animated content for testing
    let frame = 0;
    const drawFrame = () => {
      // Clear canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw camera info
      ctx.fillStyle = '#fff';
      ctx.font = '24px Arial';
      ctx.fillText(`📷 ${camera.name}`, 20, 50);
      ctx.fillText(`🌐 ${camera.ip}`, 20, 80);
      ctx.fillText(`⏰ ${new Date().toLocaleTimeString()}`, 20, 110);
      
      // Draw animated elements (simulating 1 FPS)
      const seconds = Math.floor(frame / 30);
      ctx.fillStyle = '#0f0';
      ctx.beginPath();
      ctx.arc(320 + Math.sin(seconds) * 100, 240 + Math.cos(seconds) * 50, 20, 0, Math.PI * 2);
      ctx.fill();
      
      frame++;
    };

    // Create video stream from canvas
    const stream = canvas.captureStream(1); // 1 FPS as requested
    const videoTrack = stream.getVideoTracks()[0];
    
    // Animate the canvas
    setInterval(drawFrame, 1000); // 1 FPS
    
    return stream;
  };

  const getStatusColor = () => {
    switch (camera.status) {
      case 'online': return 'text-green-400';
      case 'offline': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className={`bg-gray-800 rounded-lg overflow-hidden ${className}`} data-testid={`camera-item-${camera.id}`}>
      {/* Camera Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Camera className="w-5 h-5 text-broxeen-400" />
            <div>
              <h4 className="font-medium text-gray-200">{camera.name}</h4>
              <div className="flex items-center space-x-2 text-sm">
                <span className="text-gray-400">{camera.ip}</span>
                <span className={`flex items-center space-x-1 ${getStatusColor()}`}>
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  <span>{camera.status}</span>
                </span>
              </div>
            </div>
          </div>
          
          {onSelect && (
            <button
              onClick={() => onSelect(camera)}
              className="p-2 text-gray-400 hover:text-broxeen-400 transition-colors"
              title="Wybierz kamerę"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Video Preview */}
      <div className="relative bg-black aspect-video">
        {camera.snapshot && !isPlaying && (
          <img
            src={camera.snapshot}
            alt={`${camera.name} snapshot`}
            className="w-full h-full object-cover"
            data-testid="camera-snapshot"
          />
        )}
        
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted={isMuted}
          playsInline
          data-testid="video-stream"
        />
        
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
              <p className="text-sm">Ładowanie strumienia...</p>
            </div>
          </div>
        )}
        
        {/* Error overlay */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-white text-center p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          </div>
        )}
        
        {/* Video controls overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {!isPlaying ? (
                <button
                  onClick={handlePlay}
                  className="p-2 bg-white/20 rounded-full text-white hover:bg-white/30 transition-colors"
                  title="Odtwórz"
                  data-testid="play-button"
                >
                  <Play className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handlePause}
                  className="p-2 bg-white/20 rounded-full text-white hover:bg-white/30 transition-colors"
                  title="Pauza"
                  data-testid="pause-button"
                >
                  <Pause className="w-4 h-4" />
                </button>
              )}
              
              <button
                onClick={handleMuteToggle}
                className="p-2 bg-white/20 rounded-full text-white hover:bg-white/30 transition-colors"
                title={isMuted ? "Włącz dźwięk" : "Wyłącz dźwięk"}
                data-testid="mute-button"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
            
            <button
              onClick={handleFullscreen}
              className="p-2 bg-white/20 rounded-full text-white hover:bg-white/30 transition-colors"
              title="Pełny ekran"
              data-testid="fullscreen-button"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Camera Info */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <div className="text-gray-400">
            <span className="mr-4">📷 {camera.type}</span>
            {camera.streamUrl && (
              <span className="text-green-400">📡 Strumień dostępny</span>
            )}
          </div>
          {isPlaying && (
            <span className="text-green-400 flex items-center space-x-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>1 FPS</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

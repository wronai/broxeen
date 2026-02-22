/**
 * Camera Preview Component
 * Displays camera preview with video stream and AI-powered change detection
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, Play, Pause, Maximize2, Settings, Volume2, VolumeX, Brain, Activity } from 'lucide-react';
import { usePlugins } from '../contexts/pluginContext';

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
  onAnalysisComplete?: (cameraId: string, analysis: string) => void;
}

interface FrameAnalysis {
  timestamp: number;
  imageData: string;
  changes: string[];
  analysis?: string;
}

export const CameraPreview: React.FC<CameraPreviewProps> = ({
  camera,
  onSelect,
  className = '',
  onAnalysisComplete
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<string>('');
  const [frameHistory, setFrameHistory] = useState<FrameAnalysis[]>([]);
  const [changeDetection, setChangeDetection] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { ask } = usePlugins();

  useEffect(() => {
    return () => {
      // Cleanup stream and intervals on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, []);

  const captureFrame = useCallback((): string => {
    if (!videoRef.current || !canvasRef.current) return '';
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    // Set canvas size to match video
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    // Draw current frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Get image data as base64
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  const compareFrames = useCallback((frame1: string, frame2: string): boolean => {
    if (!frame1 || !frame2) return false;
    
    // Simple pixel comparison for change detection
    const img1 = new Image();
    const img2 = new Image();
    
    return new Promise((resolve) => {
      img1.onload = () => {
        img2.onload = () => {
          const canvas1 = document.createElement('canvas');
          const canvas2 = document.createElement('canvas');
          const ctx1 = canvas1.getContext('2d')!;
          const ctx2 = canvas2.getContext('2d')!;
          
          canvas1.width = canvas2.width = 320; // Smaller size for faster comparison
          canvas1.height = canvas2.height = 240;
          
          ctx1.drawImage(img1, 0, 0, canvas1.width, canvas1.height);
          ctx2.drawImage(img2, 0, 0, canvas2.width, canvas2.height);
          
          const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height).data;
          const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height).data;
          
          let diff = 0;
          for (let i = 0; i < data1.length; i += 4) {
            const rDiff = Math.abs(data1[i] - data2[i]);
            const gDiff = Math.abs(data1[i + 1] - data2[i + 1]);
            const bDiff = Math.abs(data1[i + 2] - data2[i + 2]);
            diff += (rDiff + gDiff + bDiff) / 3;
          }
          
          const avgDiff = diff / (canvas1.width * canvas1.height);
          const hasChanged = avgDiff > 10; // Threshold for change detection
          
          resolve(hasChanged);
        };
      };
      
      img1.src = frame1;
      img2.src = frame2;
    }).then(result => result);
  }, []);

  const analyzeFrameChanges = useCallback(async (currentFrame: string, previousFrame: string) => {
    if (!currentFrame || !previousFrame || isAnalyzing) return;
    
    setIsAnalyzing(true);
    setChangeDetection(true);
    
    try {
      // Create cropped sections for comparison
      const sections = [
        { name: 'lewa część', crop: '0,0,160,240' },
        { name: 'prawa część', crop: '160,0,160,240' }
      ];
      
      const prompt = `Analizuj dwie klatki z kamery monitoringu i opisz co się wydarzyło.

Kamera: ${camera.name} (${camera.ip})
Czas: ${new Date().toLocaleString('pl-PL')}

Sekcja 1 (lewa część): [obraz 1]
Sekcja 2 (prawa część): [obraz 2]

Opisz w jednym zdaniu co konkretnie się wydarzyło na kamerze, skupiając się na różnicach między sekcjami. Jeśli nie ma znaczących zmian, napisz "Brak aktywności".`;

      // Call LLM for analysis
      const result = await ask(prompt, "text");
      
      if (result.status === 'success' && result.content.length > 0) {
        const analysis = result.content[0].data as string;
        setLastAnalysis(analysis);
        
        // Add to frame history
        const newFrame: FrameAnalysis = {
          timestamp: Date.now(),
          imageData: currentFrame,
          changes: [],
          analysis
        };
        
        setFrameHistory(prev => [...prev.slice(-10), newFrame]);
        
        // Notify parent component
        if (onAnalysisComplete) {
          onAnalysisComplete(camera.id, analysis);
        }
      }
    } catch (error) {
      console.error('Frame analysis failed:', error);
      setLastAnalysis('Błąd analizy klatki');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => setChangeDetection(false), 500);
    }
  }, [camera, isAnalyzing, ask, onAnalysisComplete]);

  const startAnalysis = useCallback(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    
    let previousFrame = '';
    
    analysisIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
        return;
      }
      
      const currentFrame = captureFrame();
      
      if (previousFrame) {
        const hasChanged = await compareFrames(previousFrame, currentFrame);
        
        if (hasChanged) {
          await analyzeFrameChanges(currentFrame, previousFrame);
        }
      }
      
      previousFrame = currentFrame;
    }, 1000); // Analyze every second
  }, [captureFrame, compareFrames, analyzeFrameChanges]);

  const stopAnalysis = useCallback(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
    setIsAnalyzing(false);
    setChangeDetection(false);
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
        
        // Start AI analysis when playing
        startAnalysis();
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
    
    // Stop AI analysis when paused
    stopAnalysis();
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
    let lastChange = 0;
    
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
      
      // Simulate changes every 5 seconds
      if (frame - lastChange > 5) {
        lastChange = frame;
        // Draw a "person" or "object" that appears
        ctx.fillStyle = `hsl(${frame * 30}, 70%, 50%)`;
        ctx.beginPath();
        ctx.arc(320 + Math.sin(frame * 0.1) * 100, 240 + Math.cos(frame * 0.1) * 50, 30, 0, Math.PI * 2);
        ctx.fill();
        
        // Add text indicating activity
        ctx.fillStyle = '#0f0';
        ctx.font = '16px Arial';
        ctx.fillText('AKTYWNOŚĆ WYKRYTA!', 250, 350);
      } else {
        // Normal animation
        ctx.fillStyle = '#0f0';
        ctx.beginPath();
        ctx.arc(320 + Math.sin(frame * 0.1) * 50, 240 + Math.cos(frame * 0.1) * 25, 15, 0, Math.PI * 2);
        ctx.fill();
      }
      
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
                {isPlaying && (
                  <span className="flex items-center space-x-1 text-blue-400">
                    <Brain className="w-3 h-3" />
                    <span>AI Analiza</span>
                  </span>
                )}
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
        
        <canvas
          ref={canvasRef}
          className="hidden"
          data-testid="analysis-canvas"
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
        
        {/* AI Analysis overlay */}
        {isAnalyzing && (
          <div className="absolute top-4 right-4 bg-blue-600/80 text-white px-3 py-2 rounded-lg flex items-center space-x-2">
            <Brain className="w-4 h-4 animate-pulse" />
            <span className="text-sm">Analizuję zmiany...</span>
          </div>
        )}
        
        {/* Change detection indicator */}
        {changeDetection && (
          <div className="absolute top-4 left-4 bg-green-600/80 text-white px-3 py-2 rounded-lg flex items-center space-x-2">
            <Activity className="w-4 h-4 animate-pulse" />
            <span className="text-sm">Wykryto zmianę!</span>
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

      {/* AI Analysis Results */}
      {lastAnalysis && (
        <div className="p-4 border-t border-gray-700 bg-gray-750">
          <div className="flex items-start space-x-2">
            <Brain className="w-4 h-4 text-blue-400 mt-1 flex-shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-300 mb-1">Analiza AI:</div>
              <div className="text-sm text-gray-400">{lastAnalysis}</div>
            </div>
          </div>
        </div>
      )}

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
              <span>1 FPS + AI</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

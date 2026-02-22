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
    rtspUrl?: string;
    username?: string;
    password?: string;
  };
  onSelect?: (camera: any) => void;
  className?: string;
  onAnalysisComplete?: (cameraId: string, analysis: string) => void;
  fps?: number; // Allow configurable FPS
  enableAI?: boolean; // Allow disabling AI for performance
  autoPlay?: boolean; // Auto-start stream
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
  onAnalysisComplete,
  fps = 1, // Default to 1 FPS
  enableAI = true, // AI enabled by default
  autoPlay = false // Auto-play disabled by default
}) => {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<string>('');
  const [frameHistory, setFrameHistory] = useState<FrameAnalysis[]>([]);
  const [changeDetection, setChangeDetection] = useState(false);
  const [streamType, setStreamType] = useState<'mock' | 'rtsp' | 'mjpeg' | 'webrtc'>('mock');
  const [currentFPS, setCurrentFPS] = useState(fps);
  const [streamStats, setStreamStats] = useState({
    framesReceived: 0,
    framesDropped: 0,
    bitrate: 0,
    resolution: { width: 640, height: 480 }
  });
  
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

  // Auto-play effect
  useEffect(() => {
    if (autoPlay && !isPlaying && camera.status === 'online') {
      handlePlay();
    }
  }, [autoPlay, camera.status]);

  // FPS change effect
  useEffect(() => {
    if (isPlaying) {
      // Restart stream with new FPS
      handlePause();
      setTimeout(() => handlePlay(), 100);
    }
  }, [fps]);

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

  const compareFrames = useCallback((frame1: string, frame2: string): Promise<boolean> => {
    if (!frame1 || !frame2) return Promise.resolve(false);
    
    // Simple pixel comparison for change detection
    const img1 = new Image();
    const img2 = new Image();
    
    return new Promise<boolean>((resolve) => {
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
    if (!camera.streamUrl && !camera.rtspUrl) {
      setError('Brak dostępnego strumienia wideo');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let stream: MediaStream;
      
      // Determine stream type and create appropriate stream
      if (camera.rtspUrl) {
        // Try RTSP stream first
        stream = await createRTSPStream();
        setStreamType('rtsp');
      } else if (camera.streamUrl?.includes('mjpeg')) {
        // MJPEG stream
        stream = await createMJPEGStream();
        setStreamType('mjpeg');
      } else if (camera.streamUrl?.includes('webrtc') || camera.streamUrl?.includes('rtc')) {
        // WebRTC stream
        stream = await createWebRTCStream();
        setStreamType('webrtc');
      } else {
        // Fallback to mock stream
        stream = createMockVideoStream();
        setStreamType('mock');
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        await videoRef.current.play();
        setIsPlaying(true);
        setCurrentFPS(fps);
        
        // Start AI analysis if enabled
        if (enableAI) {
          startAnalysis();
        }
        
        // Start stream statistics monitoring
        startStreamMonitoring();
      }
    } catch (err) {
      setError('Nie udało się uruchomić strumienia');
      console.error('Camera stream error:', err);
      
      // Fallback to mock stream
      try {
        const mockStream = createMockVideoStream();
        if (videoRef.current) {
          videoRef.current.srcObject = mockStream;
          streamRef.current = mockStream;
          await videoRef.current.play();
          setIsPlaying(true);
          setStreamType('mock');
          
          if (enableAI) {
            startAnalysis();
          }
        }
      } catch (fallbackErr) {
        console.error('Mock stream fallback failed:', fallbackErr);
      }
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
    
    // Stop stream monitoring
    stopStreamMonitoring();
  };

  // Create RTSP stream (placeholder for real implementation)
  const createRTSPStream = async (): Promise<MediaStream> => {
    // In a real implementation, this would use WebRTC or a proxy
    // For now, fallback to enhanced mock
    console.log(`Creating RTSP stream for ${camera.rtspUrl}`);
    return createMockVideoStream();
  };

  // Create MJPEG stream from URL
  const createMJPEGStream = async (): Promise<MediaStream> => {
    if (!camera.streamUrl) {
      throw new Error('No MJPEG URL provided');
    }
    
    console.log(`Creating MJPEG stream for ${camera.streamUrl}`);
    
    // Create canvas for MJPEG rendering
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    
    let frameCount = 0;
    
    const drawMJPEGFrame = async () => {
      try {
        const response = await fetch(camera.streamUrl!);
        const blob = await response.blob();
        const img = new Image();
        
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          frameCount++;
          setStreamStats(prev => ({
            ...prev,
            framesReceived: frameCount
          }));
        };
        
        img.src = URL.createObjectURL(blob);
      } catch (error) {
        console.error('MJPEG frame error:', error);
        // Draw error frame
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f00';
        ctx.font = '24px Arial';
        ctx.fillText('MJPEG Error', 20, canvas.height / 2);
      }
    };
    
    // Start MJPEG frame fetching
    const mjpegInterval = setInterval(drawMJPEGFrame, 1000 / fps);
    
    const stream = canvas.captureStream(fps);
    
    // Cleanup on track end
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      clearInterval(mjpegInterval);
    });
    
    return stream;
  };

  // Create WebRTC stream (placeholder for real implementation)
  const createWebRTCStream = async (): Promise<MediaStream> => {
    if (!camera.streamUrl) {
      throw new Error('No WebRTC URL provided');
    }
    
    console.log(`Creating WebRTC stream for ${camera.streamUrl}`);
    
    // In a real implementation, this would establish WebRTC connection
    // For now, fallback to mock
    return createMockVideoStream();
  };

  // Start stream statistics monitoring
  const startStreamMonitoring = () => {
    const monitoringInterval = setInterval(() => {
      if (videoRef.current && isPlaying) {
        const video = videoRef.current;
        
        setStreamStats(prev => ({
          ...prev,
          resolution: {
            width: video.videoWidth || prev.resolution.width,
            height: video.videoHeight || prev.resolution.height
          },
          bitrate: Math.random() * 1000 // Mock bitrate
        }));
      }
    }, 2000);
    
    // Store interval for cleanup
    (window as any).streamMonitoringInterval = monitoringInterval;
  };

  // Stop stream monitoring
  const stopStreamMonitoring = () => {
    if ((window as any).streamMonitoringInterval) {
      clearInterval((window as any).streamMonitoringInterval);
      delete (window as any).streamMonitoringInterval;
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
    let lastChange = 0;
    let frameCount = 0;
    
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
      ctx.fillText(`📹 ${streamType.toUpperCase()} | ${fps} FPS`, 20, 140);
      
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
      
      // Draw FPS counter
      ctx.fillStyle = '#ff0';
      ctx.font = '14px Arial';
      ctx.fillText(`FPS: ${currentFPS}`, canvas.width - 80, 30);
      
      frame++;
      frameCount++;
      
      // Update stream stats
      setStreamStats(prev => ({
        ...prev,
        framesReceived: frameCount
      }));
    };

    // Create video stream from canvas
    const stream = canvas.captureStream(fps);
    const videoTrack = stream.getVideoTracks()[0];
    
    // Animate the canvas at the specified FPS
    const interval = setInterval(drawFrame, 1000 / fps);
    
    // Cleanup on track end
    videoTrack.addEventListener('ended', () => {
      clearInterval(interval);
    });
    
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
        <div className="flex items-center justify-between text-sm mb-3">
          <div className="text-gray-400">
            <span className="mr-4">📷 {camera.type}</span>
            <span className="mr-4">📹 {streamType.toUpperCase()}</span>
            {(camera.streamUrl || camera.rtspUrl) && (
              <span className="text-green-400">📡 Strumień dostępny</span>
            )}
          </div>
          {isPlaying && (
            <span className="text-green-400 flex items-center space-x-1">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>{currentFPS} FPS + AI</span>
            </span>
          )}
        </div>
        
        {/* Stream Statistics */}
        {isPlaying && (
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mb-3">
            <div>
              <span className="text-gray-400">Klatki:</span> {streamStats.framesReceived}
            </div>
            <div>
              <span className="text-gray-400">Rozdzielczość:</span> {streamStats.resolution.width}x{streamStats.resolution.height}
            </div>
            <div>
              <span className="text-gray-400">Bitrate:</span> {Math.round(streamStats.bitrate)} kbps
            </div>
            <div>
              <span className="text-gray-400">Typ:</span> {streamType.toUpperCase()}
            </div>
          </div>
        )}
        
        {/* FPS Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-xs text-gray-400">FPS:</span>
            <div className="flex space-x-1">
              {[1, 2, 5, 10].map((fpsOption) => (
                <button
                  key={fpsOption}
                  onClick={() => setCurrentFPS(fpsOption)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    currentFPS === fpsOption
                      ? 'bg-broxeen-500 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  }`}
                  disabled={isPlaying}
                >
                  {fpsOption}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAnalyzing(!isAnalyzing)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                isAnalyzing
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              disabled={!isPlaying || !enableAI}
            >
              {isAnalyzing ? 'AI ON' : 'AI OFF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

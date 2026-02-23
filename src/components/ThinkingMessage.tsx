/**
 * ThinkingMessage — Shows an animated "processing" indicator in chat
 * with bouncing dots, a spinner icon, and an estimated countdown timer.
 *
 * Used when the system is processing a query (file search, email poll, etc.)
 * so the user sees that a response is being prepared.
 */

import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface ThinkingMessageProps {
  /** Label to show, e.g. "Szukam plików..." */
  label?: string;
  /** Estimated total seconds for the operation (drives countdown) */
  estimatedSeconds?: number;
  /** When the operation started (Date.now()) */
  startedAt?: number;
  /** Extra CSS class */
  className?: string;
}

export function ThinkingMessage({
  label = 'Przetwarzam zapytanie',
  estimatedSeconds = 5,
  startedAt,
  className = '',
}: ThinkingMessageProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(startedAt ?? Date.now());

  useEffect(() => {
    startRef.current = startedAt ?? Date.now();
  }, [startedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setElapsed(Math.floor((now - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, estimatedSeconds - elapsed);
  const showCountdown = estimatedSeconds > 0 && remaining > 0;

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl bg-gray-800 px-4 py-3 max-w-[85%] ${className}`}
      data-testid="thinking-message"
    >
      {/* Animated spinner */}
      <div className="flex-shrink-0 mt-0.5">
        <Loader2 size={18} className="animate-spin text-broxeen-400" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Label with animated dots */}
        <div className="flex items-center gap-1 text-sm text-gray-300">
          <span>{label}</span>
          <span className="inline-flex gap-[2px]">
            <span className="animate-bounce-dot-1 inline-block w-1 h-1 rounded-full bg-broxeen-400" />
            <span className="animate-bounce-dot-2 inline-block w-1 h-1 rounded-full bg-broxeen-400" />
            <span className="animate-bounce-dot-3 inline-block w-1 h-1 rounded-full bg-broxeen-400" />
          </span>
        </div>

        {/* Countdown / elapsed timer */}
        <div className="flex items-center gap-2 mt-1">
          {showCountdown ? (
            <span className="text-[11px] text-gray-500">
              ~{remaining}s do odpowiedzi
            </span>
          ) : (
            <span className="text-[11px] text-gray-500">
              {elapsed}s — trwa przetwarzanie
            </span>
          )}

          {/* Mini progress bar */}
          {estimatedSeconds > 0 && (
            <div className="flex-1 max-w-[120px] h-1 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-broxeen-500/60 transition-all duration-1000 ease-linear"
                style={{
                  width: `${Math.min(100, (elapsed / estimatedSeconds) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CSS keyframes for bouncing dots — add to index.css or tailwind config:
 *
 * @keyframes bounce-dot { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-4px); } }
 * .animate-bounce-dot-1 { animation: bounce-dot 1.4s infinite ease-in-out; }
 * .animate-bounce-dot-2 { animation: bounce-dot 1.4s infinite ease-in-out 0.2s; }
 * .animate-bounce-dot-3 { animation: bounce-dot 1.4s infinite ease-in-out 0.4s; }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTts } from "./useTts";

describe("useTts", () => {
  let mockUtterance: {
    text: string;
    rate: number;
    pitch: number;
    volume: number;
    lang: string;
    voice: SpeechSynthesisVoice | null;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    onboundary: ((e: { charIndex: number }) => void) | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUtterance = {
      text: "",
      rate: 1,
      pitch: 1,
      volume: 1,
      lang: "",
      voice: null,
      onstart: null,
      onend: null,
      onerror: null,
      onboundary: null,
    };
    (window.SpeechSynthesisUtterance as unknown) = vi.fn((text: string) => {
      mockUtterance.text = text;
      return mockUtterance;
    });
  });

  it("inicjalizuje z domyślnymi wartościami", () => {
    const { result } = renderHook(() => useTts());
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("speak() wywołuje speechSynthesis.speak", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("Witaj świecie");
    });
    expect(window.speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("speak() najpierw anuluje poprzednie", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("tekst 1");
    });
    act(() => {
      result.current.speak("tekst 2");
    });
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("speak() z pustym tekstem nie wywołuje speak", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("   ");
    });
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("onstart ustawia isSpeaking=true", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
    });
    act(() => {
      mockUtterance.onstart?.();
    });
    expect(result.current.isSpeaking).toBe(true);
    expect(result.current.isPaused).toBe(false);
  });

  it("onend ustawia isSpeaking=false i progress=100", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
      mockUtterance.onstart?.();
    });
    act(() => {
      mockUtterance.onend?.();
    });
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.progress).toBe(100);
  });

  it("onerror ustawia isSpeaking=false", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
      mockUtterance.onstart?.();
    });
    act(() => {
      mockUtterance.onerror?.();
    });
    expect(result.current.isSpeaking).toBe(false);
  });

  it("pause() wywołuje speechSynthesis.pause i ustawia isPaused=true", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
      mockUtterance.onstart?.();
    });
    act(() => {
      result.current.pause();
    });
    expect(window.speechSynthesis.pause).toHaveBeenCalled();
    expect(result.current.isPaused).toBe(true);
  });

  it("resume() wywołuje speechSynthesis.resume i ustawia isPaused=false", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
      mockUtterance.onstart?.();
      result.current.pause();
    });
    act(() => {
      result.current.resume();
    });
    expect(window.speechSynthesis.resume).toHaveBeenCalled();
    expect(result.current.isPaused).toBe(false);
  });

  it("stop() wywołuje cancel i resetuje stan", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("test");
      mockUtterance.onstart?.();
    });
    act(() => {
      result.current.stop();
    });
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("onboundary aktualizuje progress", () => {
    const { result } = renderHook(() => useTts());
    act(() => {
      result.current.speak("1234567890"); // 10 znaków
      mockUtterance.onstart?.();
    });
    act(() => {
      mockUtterance.onboundary?.({ charIndex: 5 });
    });
    expect(result.current.progress).toBe(50);
  });

  it("ustawia opcje rate/pitch/volume na utterance", () => {
    const { result } = renderHook(() =>
      useTts({ rate: 1.5, pitch: 0.8, volume: 0.7 }),
    );
    act(() => {
      result.current.speak("test");
    });
    expect(mockUtterance.rate).toBe(1.5);
    expect(mockUtterance.pitch).toBe(0.8);
    expect(mockUtterance.volume).toBe(0.7);
  });

  it("ładuje głosy przy inicjalizacji", () => {
    const mockVoices = [
      { name: "Polish Voice", lang: "pl-PL" } as SpeechSynthesisVoice,
    ];
    (window.speechSynthesis.getVoices as ReturnType<typeof vi.fn>).mockReturnValue(mockVoices);
    const { result } = renderHook(() => useTts());
    expect(result.current.voices).toEqual(mockVoices);
  });
});

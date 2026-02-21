import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeech } from "./useSpeech";

type MockRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((e: unknown) => void) | null;
};

let mockRecognition: MockRecognition;

const makeMockRecognition = (): MockRecognition => ({
  continuous: false,
  interimResults: true,
  lang: "",
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  onstart: null,
  onend: null,
  onerror: null,
  onresult: null,
});

describe("useSpeech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecognition = makeMockRecognition();
    const MockSpeechRecognition = vi.fn(() => mockRecognition);
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  });

  it("inicjalizuje z domyślnymi wartościami", () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.isListening).toBe(false);
    expect(result.current.transcript).toBe("");
    expect(result.current.interimTranscript).toBe("");
  });

  it("wykrywa wsparcie SpeechRecognition", () => {
    const { result } = renderHook(() => useSpeech());
    expect(result.current.isSupported).toBe(true);
  });

  it("isSupported=false gdy brak SpeechRecognition", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useSpeech());
    expect(result.current.isSupported).toBe(false);
  });

  it("startListening() wywołuje recognition.start()", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
    });
    expect(mockRecognition.start).toHaveBeenCalledOnce();
  });

  it("startListening() ustawia lang na przekazany język", () => {
    const { result } = renderHook(() => useSpeech("en-US"));
    act(() => {
      result.current.startListening();
    });
    expect(mockRecognition.lang).toBe("en-US");
  });

  it("onstart ustawia isListening=true i czyści transcript", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
    });
    act(() => {
      mockRecognition.onstart?.();
    });
    expect(result.current.isListening).toBe(true);
    expect(result.current.transcript).toBe("");
  });

  it("onend ustawia isListening=false", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
      mockRecognition.onstart?.();
    });
    act(() => {
      mockRecognition.onend?.();
    });
    expect(result.current.isListening).toBe(false);
  });

  it("onerror ustawia isListening=false", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
      mockRecognition.onstart?.();
    });
    act(() => {
      mockRecognition.onerror?.();
    });
    expect(result.current.isListening).toBe(false);
  });

  it("onresult ustawia finalny transcript", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
      mockRecognition.onstart?.();
    });
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "onet kropka pe el" }], {
            isFinal: true,
            length: 1,
          }),
        ],
      });
    });
    expect(result.current.transcript).toBe("onet kropka pe el");
  });

  it("onresult ustawia interimTranscript dla wyników tymczasowych", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
      mockRecognition.onstart?.();
    });
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "onet kro..." }], {
            isFinal: false,
            length: 1,
          }),
        ],
      });
    });
    expect(result.current.interimTranscript).toBe("onet kro...");
    expect(result.current.transcript).toBe("");
  });

  it("stopListening() wywołuje recognition.stop()", () => {
    const { result } = renderHook(() => useSpeech());
    act(() => {
      result.current.startListening();
      mockRecognition.onstart?.();
    });
    act(() => {
      result.current.stopListening();
    });
    expect(mockRecognition.stop).toHaveBeenCalledOnce();
    expect(result.current.isListening).toBe(false);
  });

  it("używa webkitSpeechRecognition jako fallback", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const webkitMock = makeMockRecognition();
    const WebkitMockClass = vi.fn(() => webkitMock);
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: WebkitMockClass,
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useSpeech());
    expect(result.current.isSupported).toBe(true);
    act(() => {
      result.current.startListening();
    });
    expect(webkitMock.start).toHaveBeenCalledOnce();
  });
});

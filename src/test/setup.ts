import "@testing-library/jest-dom";

// jsdom nie implementuje scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock Tauri invoke — not available in jsdom
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock Web Speech API
const mockSpeechSynthesis = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  getVoices: vi.fn(() => []),
  onvoiceschanged: null,
  speaking: false,
  pending: false,
  paused: false,
};

Object.defineProperty(window, "speechSynthesis", {
  value: mockSpeechSynthesis,
  writable: true,
});

Object.defineProperty(window, "SpeechSynthesisUtterance", {
  value: class SpeechSynthesisUtterance {
    text: string;
    rate = 1;
    pitch = 1;
    volume = 1;
    lang = "";
    voice: SpeechSynthesisVoice | null = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: ((e: { charIndex: number }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  },
  writable: true,
});

// Mock navigator.mediaDevices
Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: "audioinput", deviceId: "default", label: "Default Microphone" },
      { kind: "audiooutput", deviceId: "default", label: "Default Speaker" },
    ]),
  },
  writable: true,
});

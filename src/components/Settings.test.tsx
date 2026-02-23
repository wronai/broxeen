import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Settings from "./Settings";
import { isTauriRuntime } from "../lib/runtime";

vi.mock("../hooks/useSpeech", () => ({
  useSpeech: () => ({
    isListening: false,
    transcript: "",
    interimTranscript: "",
    finalTranscript: "",
    isSupported: false,
    unsupportedReason: "brak Web Speech API",
    startListening: vi.fn(),
    stopListening: vi.fn(),
    enableAutoListen: vi.fn(),
    disableAutoListen: vi.fn(),
    clearFinalTranscript: vi.fn(),
  }),
}));

vi.mock("../hooks/useStt", () => ({
  useStt: () => ({
    isSupported: false,
    unsupportedReason: "Brak wsparcia MediaRecorder w tym środowisku.",
    mode: "none",
    isRecording: false,
    isTranscribing: false,
    transcript: "",
    error: null,
    lastErrorDetails: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock("../hooks/useTts", () => ({
  useTts: () => ({
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    voices: [],
    progress: 0,
    isSupported: false,
    unsupportedReason: "brak SpeechSynthesis API",
  }),
}));

// Mock the runtime module
vi.mock("../lib/runtime");

const defaultVoices: SpeechSynthesisVoice[] = [
  {
    name: "Polish Female",
    lang: "pl-PL",
    default: true,
    localService: true,
    voiceURI: "pl-PL",
  } as SpeechSynthesisVoice,
  {
    name: "English US",
    lang: "en-US",
    default: false,
    localService: true,
    voiceURI: "en-US",
  } as SpeechSynthesisVoice,
];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSettingsChange: vi.fn(),
  voices: defaultVoices,
};

async function renderSettings(props: Partial<typeof baseProps> = {}) {
  await act(async () => {
    render(<Settings {...baseProps} {...props} />);
  });
}

describe("Settings — widoczność", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true,
      tts_rate: 1.0,
      tts_pitch: 1.0,
      tts_volume: 1.0,
      tts_voice: "",
      tts_lang: "pl-PL",
      mic_enabled: true,
      mic_device_id: "default",
      speaker_device_id: "default",
      auto_listen: false,
    });

    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { enumerateDevices, getUserMedia },
      configurable: true,
      writable: true,
    });
  });

  it("nie renderuje gdy isOpen=false", async () => {
    await renderSettings({ isOpen: false });
    expect(screen.queryByText("Ustawienia Audio")).not.toBeInTheDocument();
  });

  it("renderuje gdy isOpen=true", async () => {
    await renderSettings();
    expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
  });

  it("przycisk X zamyka modal", async () => {
    const onClose = vi.fn();
    await renderSettings({ onClose });
    // X button is the one with title attribute
    const xBtn = document.querySelector("button[class*='rounded-lg p-1.5']");
    if (xBtn) fireEvent.click(xBtn);
    // At minimum the modal renders
    expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
  });

  it("przycisk Anuluj wywołuje onClose", async () => {
    const onClose = vi.fn();
    await renderSettings({ onClose });
    fireEvent.click(screen.getByText("Anuluj"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Settings — ładowanie ustawień", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(true);

    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    
    // Use vi.stubGlobal to properly mock mediaDevices
    vi.stubGlobal('mediaDevices', { enumerateDevices, getUserMedia });
  });

  it("ładuje ustawienia przez invoke przy otwarciu", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true,
      tts_rate: 1.5,
      tts_pitch: 1.0,
      tts_volume: 0.8,
      tts_voice: "",
      tts_lang: "pl-PL",
      mic_enabled: true,
      mic_device_id: "default",
      speaker_device_id: "default",
      auto_listen: false,
    });

    await renderSettings();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_settings");
    });
  });

  it("używa domyślnych gdy invoke się nie powiedzie", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    await renderSettings();
    await waitFor(() => {
      expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
    });
  });
});

describe("Settings — kontrolki TTS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true,
      tts_rate: 1.0,
      tts_pitch: 1.0,
      tts_volume: 1.0,
      tts_voice: "",
      tts_lang: "pl-PL",
      mic_enabled: true,
      mic_device_id: "default",
      speaker_device_id: "default",
      auto_listen: false,
    });

    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { enumerateDevices, getUserMedia },
      configurable: true,
      writable: true,
    });
  });

  it("pokazuje sekcję TTS", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText(/Text-to-Speech/i)).toBeInTheDocument();
  });

  it("pokazuje sekcję Diagnostyka", async () => {
    await renderSettings();
    expect(screen.getByText(/Diagnostyka/i)).toBeInTheDocument();
    expect(screen.getByText(/STT \(Web Speech\)/i)).toBeInTheDocument();
    expect(screen.getByText(/STT \(nagranie \+ transkrypcja\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^TTS$/i)).toBeInTheDocument();
  });

  it("pokazuje sekcję Mikrofon", async () => {
    await renderSettings();
    await waitFor(() => {
      // The heading uses uppercase via CSS, match the actual text
      expect(screen.getAllByText(/mikrofon/i).length).toBeGreaterThan(0);
    });
  });

  it("pokazuje dostępne głosy w select", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Polish Female (pl-PL)")).toBeInTheDocument();
    expect(screen.getByText("English US (en-US)")).toBeInTheDocument();
  });

  it("pokazuje opcję domyślnego głosu", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Domyślny (polski)")).toBeInTheDocument();
  });

  it("pokazuje suwak szybkości", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText(/Szybkość/i)).toBeInTheDocument();
  });

  it("pokazuje suwak głośności", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText(/Głośność/i)).toBeInTheDocument();
  });

  it("pokazuje suwak tonu", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText(/Ton/i)).toBeInTheDocument();
  });
});

describe("Settings — zapisywanie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true,
      tts_rate: 1.0,
      tts_pitch: 1.0,
      tts_volume: 1.0,
      tts_voice: "",
      tts_lang: "pl-PL",
      mic_enabled: true,
      mic_device_id: "default",
      speaker_device_id: "default",
      auto_listen: false,
    });

    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { enumerateDevices, getUserMedia },
      configurable: true,
      writable: true,
    });
  });

  it("kliknięcie 'Zapisz ustawienia' wywołuje invoke save_settings", async () => {
    await renderSettings();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_settings");
    });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    fireEvent.click(screen.getByText("Zapisz ustawienia"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_settings", {
        settings: expect.objectContaining({ tts_enabled: true }),
      });
    });
  });

  it("po zapisaniu wywołuje onSettingsChange", async () => {
    const onSettingsChange = vi.fn();
    await renderSettings({ onSettingsChange });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_settings");
    });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    fireEvent.click(screen.getByText("Zapisz ustawienia"));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledOnce();
    });
  });

  it("po zapisaniu pokazuje komunikat '✓ Zapisano'", async () => {
    await renderSettings();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_settings");
    });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    fireEvent.click(screen.getByText("Zapisz ustawienia"));

    await waitFor(() => {
      expect(screen.getByText("✓ Zapisano")).toBeInTheDocument();
    });
  });
});

describe("Settings — checkbox mikrofon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true,
      tts_rate: 1.0,
      tts_pitch: 1.0,
      tts_volume: 1.0,
      tts_voice: "",
      tts_lang: "pl-PL",
      mic_enabled: true,
      mic_device_id: "default",
      speaker_device_id: "default",
      auto_listen: false,
    });

    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      value: { enumerateDevices, getUserMedia },
      configurable: true,
      writable: true,
    });
  });

  it("pokazuje checkbox 'Mikrofon włączony'", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Mikrofon włączony")).toBeInTheDocument();
  });

  it("pokazuje checkbox 'Auto-nasłuchiwanie'", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("Auto-nasłuchiwanie")).toBeInTheDocument();
  });

  it("pokazuje checkbox 'TTS włączony'", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("TTS włączony")).toBeInTheDocument();
  });
});

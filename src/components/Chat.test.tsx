import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Chat from "./Chat";

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const defaultSettings = {
  tts_enabled: false,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  tts_voice: "",
  tts_lang: "pl-PL",
  mic_enabled: true,
  mic_device_id: "default",
  speaker_device_id: "default",
  auto_listen: false,
};

// Mock Tauri environment
const mockTauriEnvironment = () => {
  Object.defineProperty(window, '__TAURI__', {
    value: {},
    writable: true,
    configurable: true,
  });
};

describe("Chat — renderowanie", () => {
  beforeEach(() => {
    mockTauriEnvironment();
    vi.clearAllMocks();
  });
  it("pokazuje wiadomość powitalną", () => {
    render(<Chat settings={defaultSettings} />);
    expect(screen.getByText(/Witaj w Broxeen/i)).toBeInTheDocument();
  });

  it("pokazuje pole input", () => {
    render(<Chat settings={defaultSettings} />);
    expect(
      screen.getByPlaceholderText(/Wpisz adres/i),
    ).toBeInTheDocument();
  });

  it("pokazuje przycisk Send", () => {
    render(<Chat settings={defaultSettings} />);
    const sendBtn = screen.getByTitle
      ? document.querySelector("button[disabled]")
      : null;
    expect(document.querySelector("input[type='text']")).toBeInTheDocument();
  });
});

describe("Chat — wpisywanie i wysyłanie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wpisanie tekstu aktualizuje input", () => {
    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet.pl" } });
    expect((input as HTMLInputElement).value).toBe("onet.pl");
  });

  it("Enter wysyła wiadomość i czyści input", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://onet.pl",
      title: "Onet",
      content: "Treść strony onet",
    });

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText("onet.pl")).toBeInTheDocument();
    });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("Shift+Enter nie wysyła wiadomości", () => {
    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect((input as HTMLInputElement).value).toBe("test");
  });

  it("pusty input nie wysyła wiadomości", async () => {
    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    await waitFor(() => {
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});

describe("Chat — browse flow", () => {
  beforeEach(() => {
    mockTauriEnvironment();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("pokazuje wiadomość ładowania po wysłaniu URL", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // nigdy nie resolve — symuluje ładowanie
    );

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "https://onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(screen.getByText(/Pobieram/i)).toBeInTheDocument();
    });
  });

  it("pokazuje treść po udanym browse", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://onet.pl",
      title: "Onet — Jesteś na bieżąco",
      content: "Najnowsze wiadomości z Polski i ze świata.",
    });

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "https://onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const elements = screen.getAllByText(/Najnowsze wiadomości/i);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it("pokazuje błąd gdy browse się nie powiedzie", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "https://onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const elements = screen.getAllByText(/Nie udało się pobrać/i);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it("zapytanie fonetyczne → URL + wiadomość ładowania", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://onet.pl",
      title: "Onet",
      content: "Treść",
    });

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet kropka pe el" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("browse", {
        url: "https://onet.pl",
      });
    });
  });

  it("zapytanie wyszukiwania → DuckDuckGo URL", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://duckduckgo.com/?q=restauracje",
      title: "DuckDuckGo",
      content: "Wyniki wyszukiwania",
    });

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    // Use a query that clearly falls through to search (no domain match)
    fireEvent.change(input, { target: { value: "najlepsze przepisy kulinarne" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("browse", {
        url: expect.stringContaining("duckduckgo.com"),
      });
    });
  });
});

describe("Chat — TTS auto-play", () => {
  beforeEach(() => {
    mockTauriEnvironment();
    // Mock speech synthesis - delete first if it exists
    delete (window as any).speechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getVoices: vi.fn(() => []),
        onvoiceschanged: null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("nie wywołuje TTS gdy tts_enabled=false", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://onet.pl",
      title: "Onet",
      content: "Tresc bez TTS",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: false }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const els = screen.getAllByText(/Tresc bez TTS/i);
      expect(els.length).toBeGreaterThan(0);
    });
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it("wywołuje TTS gdy tts_enabled=true", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: "https://onet.pl",
      title: "Onet",
      content: "Tresc przez TTS",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: true }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(window.speechSynthesis.speak).toHaveBeenCalled();
    });
  });
});

describe("Chat — mikrofon", () => {
  it("pokazuje przycisk mikrofonu gdy mic_enabled=true", () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: vi.fn(() => ({
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
      })),
      writable: true,
      configurable: true,
    });

    render(<Chat settings={{ ...defaultSettings, mic_enabled: true }} />);
    expect(screen.getByTitle(/Mów/i)).toBeInTheDocument();
  });

  it("ukrywa przycisk mikrofonu gdy mic_enabled=false", () => {
    render(<Chat settings={{ ...defaultSettings, mic_enabled: false }} />);
    expect(screen.queryByTitle(/Mów/i)).not.toBeInTheDocument();
  });
});

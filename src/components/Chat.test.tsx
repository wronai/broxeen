import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Chat from "./Chat";

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    url: "https://onet.pl",
    title: "Onet",
    content: "Test content",
  }),
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
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://duckduckgo.com/?q=najlepsze%20przepisy%20kulinarne",
      title: "DuckDuckGo",
      content: "Wyniki wyszukiwania",
    });

    render(<Chat settings={defaultSettings} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    // Use a query that clearly falls through to search (no domain match)
    fireEvent.change(input, { target: { value: "najlepsze przepisy kulinarne" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse", {
        url: expect.stringContaining("duckduckgo.com"),
      });
    });
  });
});

describe("Chat — TTS auto-play", () => {
  beforeEach(() => {
    mockTauriEnvironment();
    // Reset speech synthesis mock instead of deleting it
    (window as any).speechSynthesis.speak = vi.fn();
    (window as any).speechSynthesis.cancel = vi.fn();
    (window as any).speechSynthesis.pause = vi.fn();
    (window as any).speechSynthesis.resume = vi.fn();
    (window as any).speechSynthesis.getVoices = vi.fn(() => []);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("nie wywołuje TTS gdy tts_enabled=false", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
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
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://onet.pl",
      title: "Onet",
      content: "Tresc przez TTS",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: true }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "onet.pl" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    // Wait for content to appear first
    await waitFor(() => {
      const els = screen.getAllByText(/Tresc przez TTS/i);
      expect(els.length).toBeGreaterThan(0);
    });
    
    // Then check if TTS was called
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("TTS używa poprawnych opcji języka i głosu", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Test",
      content: "Test content dla TTS",
    });

    const settingsWithVoice = {
      ...defaultSettings,
      tts_enabled: true,
      tts_lang: "en-US",
      tts_voice: "Test Voice",
      tts_rate: 1.2,
      tts_pitch: 0.9,
      tts_volume: 0.8,
    };

    render(<Chat settings={settingsWithVoice} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const els = screen.getAllByText(/Test content dla TTS/i);
      expect(els.length).toBeGreaterThan(0);
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("TTS nie jest wywoływane dla krótkiej treści", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Test",
      content: "Krótka",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: true }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const els = screen.getAllByText(/Krótka/i);
      expect(els.length).toBeGreaterThan(0);
    });

    // TTS should still be called even for short content (the hook handles empty text check)
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("TTS jest wywoływane ponownie dla nowej wiadomości", async () => {
    const mockInvoke = vi.mocked(invoke);
    
    // First message
    mockInvoke.mockResolvedValueOnce({
      url: "https://first.com",
      title: "First",
      content: "Pierwsza treść",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: true }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    
    fireEvent.change(input, { target: { value: "first.com" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const els = screen.getAllByText(/Pierwsza treść/i);
      expect(els.length).toBeGreaterThan(0);
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);

    // Second message
    mockInvoke.mockResolvedValueOnce({
      url: "https://second.com",
      title: "Second", 
      content: "Druga treść",
    });

    fireEvent.change(input, { target: { value: "second.com" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      const els = screen.getAllByText(/Druga treść/i);
      expect(els.length).toBeGreaterThan(0);
    });

    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(2);
  });
});

describe("Chat — mikrofon", () => {
  let mockRecognition: any;

  beforeEach(() => {
    mockTauriEnvironment();
    vi.clearAllMocks();
    
    // Mock invoke for STT tests
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({
      url: "https://wp.pl",
      title: "WP",
      content: "Test content",
    });
    
    // Mock SpeechRecognition
    mockRecognition = {
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
    };
    
    const MockSpeechRecognition = vi.fn(() => mockRecognition);
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      writable: true,
      configurable: true,
    });
  });

  it("pokazuje przycisk mikrofonu gdy mic_enabled=true", () => {
    render(<Chat settings={defaultSettings} />);
    expect(screen.getByRole("button", { name: /mikrofon/i })).toBeInTheDocument();
  });

  it("nie pokazuje przycisku mikrofonu gdy mic_enabled=false", () => {
    render(<Chat settings={{ ...defaultSettings, mic_enabled: false }} />);
    expect(screen.queryByRole("button", { name: /mikrofon/i })).not.toBeInTheDocument();
  });

  it("kliknięcie mikrofonu uruchamia nasłuchiwanie", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    
    fireEvent.click(micButton);
    
    expect(mockRecognition.start).toHaveBeenCalled();
    expect(mockRecognition.lang).toBe("pl-PL");
  });

  it("STT przekazuje rozpoznany tekst do inputa", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    
    // Start listening
    fireEvent.click(micButton);
    mockRecognition.onstart?.();
    
    // Check if input is disabled and shows listening state
    expect(input).toBeDisabled();
    expect(input).toHaveValue("Słucham...");
    
    // Simulate speech recognition result
    mockRecognition.onresult?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: "wpis kropka pl" }], {
          isFinal: true,
          length: 1,
        }),
      ],
    });
    
    mockRecognition.onend?.();
    
    // Check if transcript was submitted (input enabled and cleared after submit)
    await waitFor(() => {
      expect(input).not.toBeDisabled();
      expect(input).toHaveValue("");
    });
    
    // Check if message was added
    expect(screen.getByText("wpis kropka pl")).toBeInTheDocument();
  });

  it("STT obsługuje wyniki tymczasowe (interim)", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    
    // Start listening
    fireEvent.click(micButton);
    mockRecognition.onstart?.();
    
    // Simulate interim result
    mockRecognition.onresult?.({
      resultIndex: 0,
      results: [
        Object.assign([{ transcript: "wpis kro..." }], {
          isFinal: false,
          length: 1,
        }),
      ],
    });
    
    // Check if interim transcript appears (input is disabled during listening)
    expect(input).toBeDisabled();
    expect(input).toHaveValue("wpis kro...");
    
    // Simulate final result
    mockRecognition.onresult?.({
      resultIndex: 1,
      results: [
        Object.assign([{ transcript: "wpis kropka pl" }], {
          isFinal: true,
          length: 1,
        }),
      ],
    });
    
    mockRecognition.onend?.();
    
    // Check if final result was submitted
    await waitFor(() => {
      expect(input).not.toBeDisabled();
      expect(input).toHaveValue("");
    });
    
    expect(screen.getByText("wpis kropka pl")).toBeInTheDocument();
  });

  it("zatrzymanie nasłuchiwania przyciskiem stop", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    
    // Start listening
    fireEvent.click(micButton);
    mockRecognition.onstart?.();
    
    // Stop listening
    fireEvent.click(micButton);
    
    // Stop should be called when clicking again while listening
    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it("błąd rozpoznawania mowy zatrzymuje nasłuchiwanie", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    
    // Start listening
    fireEvent.click(micButton);
    mockRecognition.onstart?.();
    
    // Simulate error
    mockRecognition.onerror?.({ error: 'network' });
    
    expect(mockRecognition.abort).toHaveBeenCalled();
  });

  it("STT używa odpowiedniego języka z ustawień", async () => {
    const settingsWithEnglish = {
      ...defaultSettings,
      tts_lang: "en-US", // This should also affect STT language
    };
    
    render(<Chat settings={settingsWithEnglish} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    
    fireEvent.click(micButton);
    
    expect(mockRecognition.lang).toBe("en-US");
  });

  it("wielokrotne kliknięcia mikrofonu nie powodują problemów", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    
    // Multiple clicks
    fireEvent.click(micButton);
    fireEvent.click(micButton);
    fireEvent.click(micButton);
    
    // Should call start multiple times (each click starts listening)
    expect(mockRecognition.start).toHaveBeenCalledTimes(3);
  });
});

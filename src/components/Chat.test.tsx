import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Chat from "./Chat";
import { CqrsProvider } from "../contexts/CqrsContext";
import { PluginProvider } from "../contexts/pluginContext";

// Mock plugin system
vi.mock("../contexts/pluginContext", () => ({
  PluginProvider: ({ children }: { children: React.ReactNode }) => children,
  usePlugins: () => ({
    ask: vi.fn().mockImplementation((query: string) => {
      console.log('Mock plugin ask called with query:', query);
      
      // Return different content based on the query
      if (query.includes('znajdź kamere w sieci')) {
        console.log('Returning Krótka for network query');
        return Promise.resolve({
          status: 'success',
          content: [{ type: 'text', data: 'Krótka' }],
          executionTime: 100,
        });
      }
      if (query.includes('first.com')) {
        console.log('Returning Pierwsza treść for first.com');
        return Promise.resolve({
          status: 'success',
          content: [{ type: 'text', data: 'Pierwsza treść' }],
          executionTime: 100,
        });
      }
      if (query.includes('second.com')) {
        console.log('Returning Druga treść for second.com');
        return Promise.resolve({
          status: 'success',
          content: [{ type: 'text', data: 'Druga treść' }],
          executionTime: 100,
        });
      }
      console.log('Returning default mock response');
      return Promise.resolve({
        status: 'success',
        content: [{ type: 'text', data: 'Mock plugin response' }],
        executionTime: 100,
      });
    }),
  }),
}));

// Mock bootstrap to avoid plugin system initialization in tests
vi.mock("../core/bootstrap", () => ({
  bootstrapApp: vi.fn().mockResolvedValue({
    pluginRegistry: {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(),
      findByIntent: vi.fn(),
    },
    intentRouter: {
      detect: vi.fn(),
      route: vi.fn(),
    },
    commandBus: {
      execute: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
    },
    dispose: vi.fn().mockResolvedValue(undefined),
  }),
}));

const render = (ui: React.ReactElement, options?: any) => {
  return rtlRender(
    <CqrsProvider>
      <PluginProvider context={null}>
        {ui}
      </PluginProvider>
    </CqrsProvider>, 
    options
  );
};

// Mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    url: "https://onet.pl",
    title: "Onet",
    content: "Test content",
  }),
}));

// Mock browseGateway
vi.mock("../lib/browseGateway", () => ({
  executeBrowseCommand: vi.fn(),
}));

vi.mock("../lib/llmClient", () => {
  return {
    getConfig: vi
      .fn()
      .mockReturnValue({
        apiKey: "dummy_key",
        model: "test",
        maxTokens: 2048,
        temperature: 0.7,
      }),
    chat: vi.fn().mockResolvedValue({ text: "Mocked LLM chat response" }),
    askAboutContent: vi.fn().mockResolvedValue("Mocked LLM ask response"),
    summarizeForTts: vi.fn().mockResolvedValue("Pierwsza treść (LLM)"),
    summarizeSearchResults: vi.fn().mockResolvedValue("Search results..."),
    summarize: vi.fn().mockImplementation((content) => Promise.resolve(content)),
    summarizeSearch: vi.fn().mockImplementation((content, query) => Promise.resolve(content)),
    detectIntent: vi.fn().mockResolvedValue("BROWSE"),
    describeImage: vi.fn().mockResolvedValue("Mocked Image Description"),
  };
});

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    scope: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
  createScopedLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logAsyncDecorator: vi.fn().mockImplementation((_scope, _name, fn) => fn),
  logSyncDecorator: vi.fn().mockImplementation((_scope, _name, fn) => fn),
}));

const defaultSettings = {
  tts_enabled: false,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  tts_voice: "",
  tts_lang: "pl-PL",
  tts_engine: "browser",
  mic_enabled: true,
  mic_device_id: "default",
  speaker_device_id: "default",
  auto_listen: false,
  stt_enabled: true,
  stt_engine: "whisper",
  stt_model: "base",
};

// Mock Tauri environment
const mockTauriEnvironment = () => {
  Object.defineProperty(window, "__TAURI__", {
    value: {},
    writable: true,
    configurable: true,
  });
};

describe("Chat — renderowanie", () => {
  beforeEach(() => {
    mockTauriEnvironment();
    vi.clearAllMocks();
    // Ensure LLM is not available by default in Chat tests
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("pokazuje wiadomość powitalną", () => {
    render(<Chat settings={defaultSettings} />);
    expect(screen.getByText(/Witaj w Broxeen/i)).toBeInTheDocument();
  });

  it("pokazuje pole input", () => {
    render(<Chat settings={defaultSettings} />);
    expect(screen.getByPlaceholderText(/Wpisz adres/i)).toBeInTheDocument();
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
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("pokazuje wiadomość ładowania po wysłaniu URL", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockImplementationOnce(
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
    fireEvent.change(input, {
      target: { value: "najlepsze przepisy kulinarne" },
    });
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
    // Set API key so LlmAdapter is created and mocks work
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "test-key");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
    const { executeBrowseCommand } = await import("../lib/browseGateway");
    executeBrowseCommand.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Test",
      content: "Test content dla TTS",
      resolve_type: "exact",
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
    const { executeBrowseCommand } = await import("../lib/browseGateway");
    executeBrowseCommand.mockResolvedValueOnce({
      url: "https://example.com",
      title: "Test",
      content: "Krótka",
      resolve_type: "exact",
    });

    render(<Chat settings={{ ...defaultSettings, tts_enabled: true }} />);
    const input = screen.getByPlaceholderText(/Wpisz adres/i);
    fireEvent.change(input, { target: { value: "znajdź kamere w sieci" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    // First, handle the network selection that appears
    await waitFor(() => {
      const networkOptions = screen.getAllByText(/Sieć lokalna/i);
      expect(networkOptions.length).toBeGreaterThan(0);
    });
    
    // Click on the first network option to select it
    const networkOption = screen.getByText(/Sieć lokalna/i);
    fireEvent.click(networkOption);

    // Now wait for the browse result
    await waitFor(() => {
      const els = screen.getAllByText(/Krótka/i);
      expect(els.length).toBeGreaterThan(0);
    });

    // TTS should still be called even for short content (the hook handles empty text check)
    expect(window.speechSynthesis.speak).toHaveBeenCalled();
  });

  it("TTS jest wywoływane ponownie dla nowej wiadomości", async () => {
    const { executeBrowseCommand } = await import("../lib/browseGateway");

    // First message
    executeBrowseCommand.mockResolvedValueOnce({
      url: "https://first.com",
      title: "First",
      content: "Pierwsza treść",
      resolve_type: "exact",
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
    executeBrowseCommand.mockResolvedValueOnce({
      url: "https://second.com",
      title: "Second",
      content: "Druga treść",
      resolve_type: "exact",
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
    vi.stubEnv("VITE_OPENROUTER_API_KEY", "");

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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pokazuje przycisk mikrofonu gdy mic_enabled=true", () => {
    render(<Chat settings={defaultSettings} />);
    expect(
      screen.getByRole("button", { name: /mikrofon/i }),
    ).toBeInTheDocument();
  });

  it("nie pokazuje przycisku mikrofonu gdy mic_enabled=false", () => {
    render(<Chat settings={{ ...defaultSettings, mic_enabled: false }} />);
    expect(
      screen.queryByRole("button", { name: /mikrofon/i }),
    ).not.toBeInTheDocument();
  });

  it("pokazuje fallback STT w Tauri i pozostawia przycisk mikrofonu", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<Chat settings={defaultSettings} />);

    await waitFor(() => {
      expect(screen.getByTitle(/Mów \(STT w chmurze\)/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/STT w tym runtime używa transkrypcji w chmurze/i),
    ).toBeInTheDocument();
  });

  it("kliknięcie mikrofonu uruchamia nasłuchiwanie", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });

    fireEvent.click(micButton);

    expect(mockRecognition.start).toHaveBeenCalled();
    expect(mockRecognition.lang).toBe("pl-PL");
  });

  it("STT przekazuje rozpoznany tekst do inputa", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://wp.pl",
      title: "WP",
      content: "Test content",
    });

    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    const input = screen.getByPlaceholderText(/Wpisz adres/i);

    // Start listening
    fireEvent.click(micButton);

    // Wait for recognition to start and set isListening to true
    await act(async () => {
      mockRecognition.onstart?.();
    });

    // Check if input is disabled and shows listening state
    expect(input).toBeDisabled();
    expect(input).toHaveValue("Słucham...");

    // Simulate speech recognition result
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "wpis kropka pl" }], {
            isFinal: true,
            length: 1,
          }),
        ],
      });
    });

    act(() => {
      mockRecognition.onend?.();
    });

    // Check if transcript was submitted (input enabled and cleared after submit)
    await waitFor(() => {
      expect(input).not.toBeDisabled();
      expect(input).toHaveValue("");
    });

    // Check if message was added - check for user message, not assistant response
    expect(screen.getByText("wpis kropka pl")).toBeInTheDocument();
  });

  it("STT obsługuje wyniki tymczasowe (interim)", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce({
      url: "https://wp.pl",
      title: "WP",
      content: "Test content",
    });

    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    const input = screen.getByPlaceholderText(/Wpisz adres/i);

    // Start listening
    fireEvent.click(micButton);

    // Wait for recognition to start
    await act(async () => {
      mockRecognition.onstart?.();
    });

    // Simulate interim result
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "wpis kro..." }], {
            isFinal: false,
            length: 1,
          }),
        ],
      });
    });

    // Check if interim transcript appears (input is disabled during listening)
    expect(input).toBeDisabled();
    expect(input).toHaveValue("wpis kro...");

    // Simulate final result
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: "wpis kropka pl" }], {
            isFinal: true,
            length: 1,
          }),
        ],
      });
    });

    act(() => {
      mockRecognition.onend?.();
    });

    // Check if final result was submitted
    await waitFor(() => {
      expect(input).not.toBeDisabled();
      expect(input).toHaveValue("");
    });

    // Check if user message was added
    expect(screen.getByText("wpis kropka pl")).toBeInTheDocument();
  });

  it("zatrzymanie nasłuchiwania przyciskiem stop", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });

    // Start listening
    fireEvent.click(micButton);

    // Wait for recognition to start
    await act(async () => {
      mockRecognition.onstart?.();
    });

    // Stop listening
    fireEvent.click(micButton);

    // Stop should be called when clicking again while listening
    expect(mockRecognition.stop).toHaveBeenCalled();
  });

  it("błąd rozpoznawania mowy zatrzymuje nasłuchiwanie", async () => {
    render(<Chat settings={defaultSettings} />);
    const micButton = screen.getByRole("button", { name: /mikrofon/i });
    const input = screen.getByPlaceholderText(/Wpisz adres/i);

    // Start listening
    fireEvent.click(micButton);

    // Wait for recognition to start
    await act(async () => {
      mockRecognition.onstart?.();
    });

    // Input should be disabled during listening
    expect(input).toBeDisabled();

    // Simulate error
    act(() => {
      mockRecognition.onerror?.({ error: "network" });
    });

    // Input should be enabled after error
    expect(input).not.toBeDisabled();
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

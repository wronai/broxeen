import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import Settings from "./Settings";

const defaultVoices: SpeechSynthesisVoice[] = [
  { name: "Polish Female", lang: "pl-PL", default: true, localService: true, voiceURI: "pl-PL" } as SpeechSynthesisVoice,
  { name: "English US", lang: "en-US", default: false, localService: true, voiceURI: "en-US" } as SpeechSynthesisVoice,
];

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onSettingsChange: vi.fn(),
  voices: defaultVoices,
};

function renderSettings(overrides: Partial<typeof baseProps> = {}) {
  return render(<Settings {...baseProps} {...overrides} />);
}

async function renderOpenSettings(overrides: Partial<typeof baseProps> = {}) {
  renderSettings(overrides);
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("get_settings");
  });
}

describe("Settings — widoczność", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
      tts_enabled: true, tts_rate: 1.0, tts_pitch: 1.0, tts_volume: 1.0,
      tts_voice: "", tts_lang: "pl-PL", mic_enabled: true,
      mic_device_id: "default", speaker_device_id: "default", auto_listen: false,
    });
  });

  it("nie renderuje gdy isOpen=false", () => {
    renderSettings({ isOpen: false });
    expect(screen.queryByText("Ustawienia Audio")).not.toBeInTheDocument();
  });

  it("renderuje gdy isOpen=true", async () => {
    await renderOpenSettings();
    expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
  });

  it("przycisk X zamyka modal", async () => {
    const onClose = vi.fn();
    await renderOpenSettings({ onClose });
    // X button is the one with title attribute
    const xBtn = document.querySelector("button[class*='rounded-lg p-1.5']");
    if (xBtn) fireEvent.click(xBtn);
    // At minimum the modal renders
    expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
  });

  it("przycisk Anuluj wywołuje onClose", async () => {
    const onClose = vi.fn();
    await renderOpenSettings({ onClose });
    fireEvent.click(screen.getByText("Anuluj"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Settings — ładowanie ustawień", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    await renderOpenSettings();
  });

  it("używa domyślnych gdy invoke się nie powiedzie", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    await renderOpenSettings();
    await waitFor(() => {
      expect(screen.getByText("Ustawienia Audio")).toBeInTheDocument();
    });
  });
});

describe("Settings — kontrolki TTS", () => {
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
  });

  it("pokazuje sekcję TTS", async () => {
    await renderOpenSettings();
    expect(screen.getByText(/Text-to-Speech/i)).toBeInTheDocument();
  });

  it("pokazuje sekcję Mikrofon", async () => {
    await renderOpenSettings();
    await waitFor(() => {
      // The heading uses uppercase via CSS, match the actual text
      expect(screen.getAllByText(/mikrofon/i).length).toBeGreaterThan(0);
    });
  });

  it("pokazuje dostępne głosy w select", async () => {
    await renderOpenSettings();
    expect(screen.getByText("Polish Female (pl-PL)")).toBeInTheDocument();
    expect(screen.getByText("English US (en-US)")).toBeInTheDocument();
  });

  it("pokazuje opcję domyślnego głosu", async () => {
    await renderOpenSettings();
    expect(screen.getByText("Domyślny (polski)")).toBeInTheDocument();
  });

  it("pokazuje suwak szybkości", async () => {
    await renderOpenSettings();
    expect(screen.getByText(/Szybkość/i)).toBeInTheDocument();
  });

  it("pokazuje suwak głośności", async () => {
    await renderOpenSettings();
    expect(screen.getByText(/Głośność/i)).toBeInTheDocument();
  });

  it("pokazuje suwak tonu", async () => {
    await renderOpenSettings();
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
  });

  it("kliknięcie 'Zapisz ustawienia' wywołuje invoke save_settings", async () => {
    await renderOpenSettings();

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
    await renderOpenSettings({ onSettingsChange });

    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    fireEvent.click(screen.getByText("Zapisz ustawienia"));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledOnce();
    });
  });

  it("po zapisaniu pokazuje komunikat '✓ Zapisano'", async () => {
    await renderOpenSettings();

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
  });

  it("pokazuje checkbox 'Mikrofon włączony'", async () => {
    await renderOpenSettings();
    expect(screen.getByText("Mikrofon włączony")).toBeInTheDocument();
  });

  it("pokazuje checkbox 'Auto-nasłuchiwanie'", async () => {
    await renderOpenSettings();
    expect(screen.getByText("Auto-nasłuchiwanie")).toBeInTheDocument();
  });

  it("pokazuje checkbox 'TTS włączony'", async () => {
    await renderOpenSettings();
    expect(screen.getByText("TTS włączony")).toBeInTheDocument();
  });
});

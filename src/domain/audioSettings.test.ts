import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
} from "./audioSettings";

describe("audioSettings domain", () => {
  it("provides stable defaults", () => {
    expect(DEFAULT_AUDIO_SETTINGS).toMatchObject({
      tts_enabled: true,
      tts_lang: "pl-PL",
      mic_enabled: true,
      auto_listen: false,
    });
  });

  it("fills missing values with defaults", () => {
    const merged = withAudioSettingsDefaults({ tts_rate: 1.7 });

    expect(merged.tts_rate).toBe(1.7);
    expect(merged.tts_lang).toBe("pl-PL");
    expect(merged.mic_enabled).toBe(true);
  });

  it("keeps explicit values over defaults", () => {
    const merged = withAudioSettingsDefaults({
      tts_enabled: false,
      tts_lang: "en-US",
      mic_enabled: false,
    });

    expect(merged.tts_enabled).toBe(false);
    expect(merged.tts_lang).toBe("en-US");
    expect(merged.mic_enabled).toBe(false);
  });
});

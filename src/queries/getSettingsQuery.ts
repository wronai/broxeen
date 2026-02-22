import type { AudioSettings } from "../domain/audioSettings";
import {
  DEFAULT_AUDIO_SETTINGS,
  withAudioSettingsDefaults,
} from "../domain/audioSettings";
import { isTauriRuntime } from "../lib/runtime";
import { createScopedLogger } from "../lib/logger";

const logger = createScopedLogger("query:getSettings");

/**
 * GetSettingsQuery — loads audio settings from backend or defaults.
 * Pure query, no state mutation.
 */
export class GetSettingsQuery {
  async execute(): Promise<AudioSettings> {
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const backendSettings =
          await invoke<Partial<AudioSettings>>("get_settings");
        logger.info("Settings loaded from backend", backendSettings);
        return withAudioSettingsDefaults(backendSettings);
      } catch (err) {
        logger.error("Failed to load settings from backend", err);
        return DEFAULT_AUDIO_SETTINGS;
      }
    }

    logger.info("Using default settings (browser mode)");
    return DEFAULT_AUDIO_SETTINGS;
  }
}

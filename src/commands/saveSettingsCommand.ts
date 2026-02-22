import type { EventStore } from "../domain/eventStore";
import type { AudioSettings } from "../domain/audioSettings";
import { isTauriRuntime } from "../lib/runtime";
import { createScopedLogger } from "../lib/logger";

const logger = createScopedLogger("cmd:saveSettings");

/**
 * SaveSettingsCommand — validates and persists audio settings.
 * Emits settings_changed event on success.
 */
export class SaveSettingsCommand {
  constructor(private eventStore: EventStore) {}

  async execute(settings: AudioSettings): Promise<void> {
    logger.info("Saving settings", {
      ttsEnabled: settings.tts_enabled,
      sttEnabled: settings.stt_enabled,
    });

    try {
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_settings", { settings });
      }

      this.eventStore.append({
        type: "settings_changed",
        payload: settings,
        timestamp: Date.now(),
      });

      logger.info("Settings saved successfully");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to save settings", { error: errorMsg });

      this.eventStore.append({
        type: "error_occurred",
        payload: { context: "saveSettings", error: errorMsg },
        timestamp: Date.now(),
      });

      throw err;
    }
  }
}

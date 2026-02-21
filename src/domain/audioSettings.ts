export interface AudioSettings {
  tts_enabled: boolean;
  tts_rate: number;
  tts_pitch: number;
  tts_volume: number;
  tts_voice: string;
  tts_lang: string;
  mic_enabled: boolean;
  mic_device_id: string;
  speaker_device_id: string;
  auto_listen: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
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
};

export function withAudioSettingsDefaults(
  partial: Partial<AudioSettings>,
): AudioSettings {
  return { ...DEFAULT_AUDIO_SETTINGS, ...partial };
}

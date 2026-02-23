export interface AudioSettings {
  tts_enabled: boolean;
  tts_rate: number;
  tts_pitch: number;
  tts_volume: number;
  tts_voice: string;
  tts_lang: string;
  tts_engine: string;
  stt_enabled: boolean;
  stt_engine: string;
  stt_model: string;
  mic_enabled: boolean;
  mic_device_id: string;
  speaker_device_id: string;
  auto_listen: boolean;
  /** How long silence must last (ms) before auto-listen stops recording and sends the transcript. */
  auto_listen_silence_ms: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  tts_enabled: true,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  tts_voice: "",
  tts_lang: "pl-PL",
  tts_engine: "auto",
  stt_enabled: true,
  stt_engine: "openrouter",
  stt_model: "whisper-1",
  mic_enabled: true,
  mic_device_id: "default",
  speaker_device_id: "default",
  auto_listen: false,
  auto_listen_silence_ms: 1000,
};

export function withAudioSettingsDefaults(
  partial: Partial<AudioSettings>,
): AudioSettings {
  return { ...DEFAULT_AUDIO_SETTINGS, ...partial };
}

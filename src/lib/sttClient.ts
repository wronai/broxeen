import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";
import { logger, logAsyncDecorator } from "./logger";

const sttLogger = logger.scope("speech:stt");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type SttAudioFormat =
  | "wav"
  | "mp3"
  | "aiff"
  | "aac"
  | "ogg"
  | "flac"
  | "m4a"
  | "pcm16"
  | "pcm24";

export interface SttConfig {
  apiKey: string;
  model: string;
  language: string;
}

export function getSttConfig(): SttConfig {
  return {
    apiKey: import.meta.env.VITE_OPENROUTER_API_KEY ?? "",
    model: import.meta.env.VITE_STT_MODEL ?? "google/gemini-2.0-flash",
    language: import.meta.env.VITE_STT_LANG ?? "pl",
  };
}

export async function transcribeAudio(
  audioBase64: string,
  format: SttAudioFormat,
  languageOverride?: string,
  configOverride?: Partial<SttConfig>,
): Promise<string> {
  const run = logAsyncDecorator("speech:stt", "transcribeAudio", async () => {
    const cfg = { ...getSttConfig(), ...configOverride };

    if (!audioBase64.trim()) {
      throw new Error("Missing audio payload");
    }

    const isTauri = isTauriRuntime();
    sttLogger.info("Dispatching STT transcription", {
      runtime: isTauri ? "tauri" : "browser",
      model: cfg.model,
      format,
      audioBase64Length: audioBase64.length,
    });

    if (isTauri) {
      const result = await invoke<{ text?: string } | string>(
        "stt_transcribe",
        {
          audioBase64,
          format,
          language: languageOverride ?? cfg.language,
          apiKey: cfg.apiKey,
          model: cfg.model,
        },
      );

      if (typeof result === "string") {
        return result.trim();
      }

      return (result?.text ?? "").trim();
    }

    if (!cfg.apiKey) {
      throw new Error("OPENROUTER_API_KEY not set. Configure in .env file.");
    }

    const prompt =
      `Please transcribe this audio to text. ` +
      `Return only the transcription. ` +
      `Language: ${languageOverride ?? cfg.language}.`;

    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://broxeen.local",
        "X-Title": "broxeen",
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "input_audio",
                input_audio: {
                  data: audioBase64,
                  format,
                },
              },
            ],
          },
        ],
        max_tokens: 256,
        temperature: 0.0,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`STT HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content ?? "").toString();
    return text.trim();
  });

  return run();
}

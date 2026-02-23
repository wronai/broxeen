import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";
import { logger, logAsyncDecorator } from "./logger";
import { configStore } from "../config/configStore";

const sttLogger = logger.scope("speech:stt");

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

export function buildSttRequestBody(params: {
  model: string;
  prompt: string;
  audioBase64: string;
  format: SttAudioFormat;
  maxTokens: number;
  temperature: number;
}) {
  return {
    model: params.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: params.prompt },
          {
            type: "input_audio",
            inputAudio: {
              data: params.audioBase64,
              format: params.format,
            },
          },
        ],
      },
    ],
    max_tokens: params.maxTokens,
    temperature: params.temperature,
  };
}

export function getSttConfig(): SttConfig {
  const cfg = configStore.getAll();
  return {
    apiKey: cfg.llm.apiKey,
    model: cfg.stt.model,
    language: cfg.stt.language,
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

    const appCfg = configStore.getAll();
    const resp = await fetch(appCfg.llm.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": appCfg.llm.httpReferer,
        "X-Title": appCfg.llm.appTitle,
      },
      body: JSON.stringify(
        buildSttRequestBody({
          model: cfg.model,
          prompt,
          audioBase64,
          format,
          maxTokens: appCfg.stt.maxTokens,
          temperature: appCfg.stt.temperature,
        }),
      ),
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

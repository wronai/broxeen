import { describe, expect, it } from "vitest";
import { buildSttRequestBody } from "./sttClient";

describe("sttClient.buildSttRequestBody", () => {
  it("uses inputAudio (camelCase) for input_audio content part", () => {
    const body = buildSttRequestBody({
      model: "google/gemini-2.0-flash-exp:free",
      prompt: "Please transcribe",
      audioBase64: "AAA",
      format: "wav",
      maxTokens: 123,
      temperature: 0,
    });

    const part = body.messages?.[0]?.content?.[1] as any;
    expect(part?.type).toBe("input_audio");
    expect(part?.inputAudio).toEqual({ data: "AAA", format: "wav" });
    expect(part?.input_audio).toBeUndefined();
  });
});

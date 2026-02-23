import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn(),
  };
});

vi.mock("../lib/runtime", () => {
  return {
    isTauriRuntime: vi.fn(),
  };
});

vi.mock("../config/configStore", () => {
  return {
    configStore: {
      getAll: vi.fn(() => ({
        llm: { apiKey: "test" },
        stt: { model: "test-model" },
      })),
    },
  };
});

vi.mock("../lib/sttClient", () => {
  return {
    transcribeAudio: vi.fn(async () => ""),
  };
});

import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";
import { useStt } from "./useStt";

describe("useStt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Tauri: startRecording() calls stt_start only once when called twice quickly", async () => {
    (isTauriRuntime as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "stt_start") return Promise.resolve(null);
      if (cmd === "stt_stop") return Promise.resolve("ok");
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useStt({ lang: "pl-PL" }));

    await act(async () => {
      result.current.startRecording();
      result.current.startRecording();
      await Promise.resolve();
    });

    const calls = invokeMock.mock.calls.filter((c) => c[0] === "stt_start");
    expect(calls.length).toBe(1);
  });

  it("Tauri: stopRecording() calls stt_stop only once when called twice quickly", async () => {
    (isTauriRuntime as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    vi.useFakeTimers();

    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "stt_start") return Promise.resolve(null);
      if (cmd === "stt_stop") return new Promise((resolve) => setTimeout(() => resolve(""), 10));
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useStt({ lang: "pl-PL" }));

    await act(async () => {
      result.current.startRecording();
      await Promise.resolve();
    });

    await act(async () => {
      result.current.stopRecording();
      result.current.stopRecording();
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });

    const calls = invokeMock.mock.calls.filter((c) => c[0] === "stt_stop");
    expect(calls.length).toBe(1);

    vi.useRealTimers();
  });
});

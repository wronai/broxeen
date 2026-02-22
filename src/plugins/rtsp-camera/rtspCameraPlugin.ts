/**
 * @module plugins/rtsp-camera/rtspCameraPlugin
 * @description RTSP Camera plugin — captures frames from IP cameras
 * and uses LLM vision to describe scenes.
 *
 * Architecture:
 * - Frame capture: native Rust (Tauri) or HTTP snapshot endpoint
 * - Scene description: delegates to LLM service (Gemini Vision)
 * - Implements both DataSourcePlugin and VisualPlugin interfaces
 *
 * Intents handled:
 * - "camera:describe" — describe what's visible on a camera
 * - "camera:list"     — list available cameras
 * - "camera:snapshot" — capture a frame without description
 */

import type {
  ContentBlock,
  DataSourcePlugin,
  PluginCapabilities,
  PluginId,
  PluginQuery,
  PluginResult,
  VisualPlugin,
} from "../../core/plugin.types";

// ─── Camera Configuration ───────────────────────────────────

export interface CameraConfig {
  readonly id: string;
  readonly name: string;
  /** RTSP stream URL, e.g. "rtsp://192.168.1.100:554/stream" */
  readonly rtspUrl?: string;
  /** HTTP snapshot URL (fallback), e.g. "http://192.168.1.100/snapshot.jpg" */
  readonly snapshotUrl?: string;
  /** Location label for context, e.g. "Wejście główne" */
  readonly location?: string;
}

// ─── Frame Grabber Interface (Strategy pattern) ─────────────

export interface FrameGrabber {
  readonly name: string;
  isAvailable(): boolean;
  /** Capture a single frame, return as base64 JPEG */
  capture(camera: CameraConfig): Promise<CapturedFrame>;
}

export interface CapturedFrame {
  readonly base64: string;
  readonly mimeType: "image/jpeg" | "image/png";
  readonly width?: number;
  readonly height?: number;
  readonly timestamp: number;
}

// ─── Frame Grabber Implementations ──────────────────────────

/** HTTP snapshot — works in browser and Tauri */
export class HttpSnapshotGrabber implements FrameGrabber {
  readonly name = "http-snapshot";

  isAvailable(): boolean {
    return true;
  }

  async capture(camera: CameraConfig): Promise<CapturedFrame> {
    const url = camera.snapshotUrl;
    if (!url) {
      throw new Error(`Camera "${camera.id}" has no snapshotUrl configured`);
    }

    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw new Error(`Snapshot HTTP ${response.status} for camera "${camera.id}"`);
    }

    const blob = await response.blob();
    const base64 = await blobToBase64(blob);

    return {
      base64,
      mimeType: "image/jpeg",
      timestamp: Date.now(),
    };
  }
}

/**
 * Tauri native RTSP frame grabber.
 * Delegates to a Rust command that uses ffmpeg or gstreamer.
 */
export class TauriRtspGrabber implements FrameGrabber {
  readonly name = "tauri-rtsp";

  private readonly invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  constructor(
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
  ) {
    this.invoke = invoke;
  }

  isAvailable(): boolean {
    return true;
  }

  async capture(camera: CameraConfig): Promise<CapturedFrame> {
    const url = camera.rtspUrl;
    if (!url) {
      throw new Error(`Camera "${camera.id}" has no rtspUrl configured`);
    }

    const result = (await this.invoke("rtsp_capture_frame", {
      url,
      cameraId: camera.id,
    })) as { base64: string; width: number; height: number };

    return {
      base64: result.base64,
      mimeType: "image/jpeg",
      width: result.width,
      height: result.height,
      timestamp: Date.now(),
    };
  }
}

// ─── Scene Describer Interface ──────────────────────────────

export interface SceneDescriber {
  describe(frame: CapturedFrame, prompt?: string): Promise<string>;
}

/**
 * LLM-based scene description.
 * Delegates to existing describeImage() from llmClient.ts
 */
export class LlmSceneDescriber implements SceneDescriber {
  private readonly describeImage: (
    base64: string,
    mimeType?: string,
    prompt?: string,
  ) => Promise<string>;

  constructor(
    describeImage: (
      base64: string,
      mimeType?: string,
      prompt?: string,
    ) => Promise<string>,
  ) {
    this.describeImage = describeImage;
  }

  async describe(frame: CapturedFrame, prompt?: string): Promise<string> {
    const defaultPrompt =
      "Opisz krótko co widzisz na tym obrazie z kamery monitoringu. " +
      "Skup się na osobach, pojazdach i nietypowych zdarzeniach. " +
      "Odpowiedz po polsku, maksymalnie 2-3 zdania.";

    return this.describeImage(
      frame.base64,
      frame.mimeType,
      prompt ?? defaultPrompt,
    );
  }
}

// ─── RTSP Camera Plugin ─────────────────────────────────────

export interface RtspCameraPluginOptions {
  cameras: CameraConfig[];
  grabbers?: FrameGrabber[];
  describer?: SceneDescriber;
}

export class RtspCameraPlugin implements DataSourcePlugin, VisualPlugin {
  readonly id: PluginId = "rtsp-camera";
  readonly name = "RTSP Camera";
  readonly capabilities: PluginCapabilities = {
    intents: ["camera:describe", "camera:list", "camera:snapshot", "camera:stream"],
    streaming: true, // Streaming support added
    requiresNetwork: true,
    browserCompatible: true, // HTTP snapshot works in browser
    priority: 70,
  };

  private cameras: Map<string, CameraConfig>;
  private grabbers: FrameGrabber[];
  private describer: SceneDescriber | null;

  constructor(options: RtspCameraPluginOptions) {
    this.cameras = new Map(options.cameras.map((c) => [c.id, c]));
    this.grabbers = (
      options.grabbers ?? [new HttpSnapshotGrabber()]
    ).filter((g) => g.isAvailable());
    this.describer = options.describer ?? null;
  }

  async initialize(): Promise<void> {
    if (this.cameras.size === 0) {
      throw new Error("No cameras configured for RTSP Camera plugin");
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.cameras.size > 0 && this.grabbers.length > 0;
  }

  async execute(query: PluginQuery): Promise<PluginResult> {
    const start = performance.now();

    switch (query.intent) {
      case "camera:list":
        return this.handleList(start);
      case "camera:snapshot":
        return this.handleSnapshot(query, start);
      case "camera:describe":
        return this.handleDescribe(query, start);
      default:
        return this.errorResult(`Nieznana intencja: ${query.intent}`, start);
    }
  }

  // ── VisualPlugin interface ──────────────────────────────

  async captureFrame(target: string): Promise<ContentBlock> {
    const camera = this.resolveCamera(target);
    const frame = await this.grabFrame(camera);

    return {
      type: "image",
      data: frame.base64,
      mimeType: frame.mimeType,
      title: `Klatka z kamery: ${camera.name}`,
    };
  }

  async describeScene(target: string, prompt?: string): Promise<string> {
    if (!this.describer) {
      throw new Error("Brak konfiguracji LLM do opisu sceny");
    }
    const camera = this.resolveCamera(target);
    const frame = await this.grabFrame(camera);
    return this.describer.describe(frame, prompt);
  }

  async dispose(): Promise<void> {
    // Clean up any persistent connections
  }

  // ── Intent Handlers ─────────────────────────────────────

  private handleList(start: number): PluginResult {
    const list = Array.from(this.cameras.values())
      .map((c) => `• ${c.name}${c.location ? ` (${c.location})` : ""} [ID: ${c.id}]`)
      .join("\n");

    return {
      pluginId: this.id,
      status: "success",
      content: [
        {
          type: "text",
          data: `Dostępne kamery:\n${list}`,
          summary: `${this.cameras.size} kamer dostępnych`,
        },
      ],
      metadata: this.meta(start),
    };
  }

  private async handleSnapshot(
    query: PluginQuery,
    start: number,
  ): Promise<PluginResult> {
    try {
      const camera = this.resolveCamera(query.resolvedTarget ?? query.rawInput);
      const frame = await this.grabFrame(camera);

      return {
        pluginId: this.id,
        status: "success",
        content: [
          {
            type: "image",
            data: frame.base64,
            mimeType: frame.mimeType,
            title: camera.name,
          },
        ],
        metadata: this.meta(start),
      };
    } catch (err) {
      return this.errorResult(
        err instanceof Error ? err.message : String(err),
        start,
      );
    }
  }

  private async handleDescribe(
    query: PluginQuery,
    start: number,
  ): Promise<PluginResult> {
    if (!this.describer) {
      return this.errorResult(
        "Opis sceny wymaga konfiguracji LLM (np. Gemini Vision)",
        start,
      );
    }

    try {
      const camera = this.resolveCamera(query.resolvedTarget ?? query.rawInput);
      const frame = await this.grabFrame(camera);
      const description = await this.describer.describe(
        frame,
        query.params.prompt as string | undefined,
      );

      return {
        pluginId: this.id,
        status: "success",
        content: [
          {
            type: "text",
            data: description,
            title: `${camera.name} — opis sceny`,
            summary: description,
          },
          {
            type: "image",
            data: frame.base64,
            mimeType: frame.mimeType,
            title: camera.name,
          },
        ],
        metadata: this.meta(start),
      };
    } catch (err) {
      return this.errorResult(
        err instanceof Error ? err.message : String(err),
        start,
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────

  private resolveCamera(input: string): CameraConfig {
    // Try direct ID match
    const byId = this.cameras.get(input);
    if (byId) return byId;

    // Try name match (case-insensitive)
    const lower = input.toLowerCase();
    for (const cam of this.cameras.values()) {
      if (cam.name.toLowerCase().includes(lower)) return cam;
      if (cam.location?.toLowerCase().includes(lower)) return cam;
    }

    // Default to first camera
    const first = this.cameras.values().next().value;
    if (first) return first;

    throw new Error("Brak skonfigurowanych kamer");
  }

  private async grabFrame(camera: CameraConfig): Promise<CapturedFrame> {
    let lastError: Error | null = null;

    for (const grabber of this.grabbers) {
      try {
        return await grabber.capture(camera);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error("Brak dostępnych metod przechwytywania obrazu");
  }

  private meta(start: number): PluginResult["metadata"] {
    return {
      duration_ms: performance.now() - start,
      cached: false,
      truncated: false,
    };
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: "error",
      content: [{ type: "text", data: message }],
      metadata: this.meta(start),
    };
  }
}

// ─── Utility ────────────────────────────────────────────────

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

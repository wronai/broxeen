/**
 * MotionDetectionPlugin — chat interface for the Smart Motion Detection Pipeline
 *
 * Commands (via chat):
 *   "detekcja ruchu rtsp://..."  → start pipeline
 *   "stop detekcji cam01"        → stop pipeline
 *   "status detekcji ruchu"      → list active pipelines
 *   "statystyki detekcji cam01"  → DB stats last 24h
 *   "wykrycia cam01"             → last detections
 *   "konfiguruj detekcję ruchu"  → show config prompt
 */

import type { Plugin, PluginContext, PluginResult } from "../../core/types";
import { configStore } from "../../config/configStore";
import { logger } from "../../lib/logger";
import type { ConfigPromptData } from "../../components/ChatConfigPrompt";

const motionLog = logger.scope("motion:detection");

type UnlistenFn = () => void;

interface PipelineStatus {
  camera_id: string;
  rtsp_url: string;
  started_at: number;
  running: boolean;
}

interface DetectionStats {
  total: number;
  by_class: Record<string, number>;
  by_hour: Record<string, number>;
  unique_events_30s: number;
  llm_sent: number;
  llm_reduction_pct: number;
}

interface DetectionRow {
  id: number;
  timestamp: string;
  camera_id: string;
  label: string;
  confidence: number;
  llm_label?: string;
  llm_description?: string;
  area: number;
  sent_to_llm: boolean;
}

export class MotionDetectionPlugin implements Plugin {
  readonly id = "motion-detection";
  readonly name = "Smart Motion Detection";
  readonly version = "1.0.0";
  readonly supportedIntents = [
    "motion:start", "motion:stop", "motion:status",
    "motion:stats", "motion:detections", "motion:config",
  ];

  private unlisten: UnlistenFn | null = null;

  async initialize(context: PluginContext): Promise<void> {
    if (!context.isTauri || !context.tauriInvoke) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      this.unlisten = await listen<{ camera_id: string; raw: string }>(
        "broxeen:motion_event",
        (event) => {
          try {
            const parsed = JSON.parse(event.payload.raw);
            if (parsed.type === "detection") {
              motionLog.info(
                `[${event.payload.camera_id}] ${parsed.label} conf=${parsed.confidence}`,
              );
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("broxeen:motion_detection", { detail: parsed }),
                );
              }
            }
          } catch { /* ignore */ }
        },
      );
    } catch (err) {
      motionLog.warn("Failed to register motion event listener", err);
    }
  }

  async dispose(): Promise<void> {
    if (this.unlisten) { this.unlisten(); this.unlisten = null; }
  }

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      /detekcj[aęi].*ruch|ruch.*detekcj/i.test(lower) ||
      /motion.*detect|detect.*motion/i.test(lower) ||
      /wykrywan.*ruch|ruch.*wykrywan/i.test(lower) ||
      /start.*pipeline|pipeline.*start/i.test(lower) ||
      /stop.*detekcj|zatrzymaj.*detekcj/i.test(lower) ||
      /status.*detekcj|detekcj.*status/i.test(lower) ||
      /statystyki.*detekcj|detekcj.*statystyki/i.test(lower) ||
      /wykrycia.*cam|cam.*wykrycia/i.test(lower) ||
      /konfiguruj.*detekcj|detekcj.*konfigur/i.test(lower) ||
      /yolov8|mog2|background.*subtract/i.test(lower) ||
      /edge.*detect|rpi.*detect|n5105.*detect/i.test(lower)
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    if (!context.isTauri || !context.tauriInvoke) {
      return this.errorResult(
        "⚠️ **Detekcja ruchu wymaga Tauri** — uruchom `make tauri-dev`.\n\n" +
          "Bezpośrednie uruchomienie Python:\n" +
          "```bash\npython3 scripts/motion_pipeline.py \\\n" +
          "  --rtsp rtsp://user:pass@192.168.1.100:554/stream \\\n" +
          "  --camera-id cam01 --output-events --verbose\n```",
        start,
      );
    }

    if (/stop.*detekcj|zatrzymaj.*detekcj|stop.*pipeline/i.test(lower))
      return this.handleStop(input, context, start);
    if (/status.*detekcj|detekcj.*status|aktywne.*pipeline/i.test(lower))
      return this.handleStatus(context, start);
    if (/statystyki.*detekcj|detekcj.*statystyki|stats.*cam/i.test(lower))
      return this.handleStats(input, context, start);
    if (/wykrycia|detections/i.test(lower))
      return this.handleDetections(input, context, start);
    if (/konfiguruj.*detekcj|config.*motion/i.test(lower))
      return this.handleConfig(start);

    return this.handleStart(input, context, start);
  }

  // ── Start ───────────────────────────────────────────────────────────────────

  private async handleStart(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const rtspUrl = this.extractRtspUrl(input);
    if (!rtspUrl) {
      return this.errorResult(
        "Podaj URL RTSP kamery:\n" +
          "- `detekcja ruchu rtsp://admin:pass@192.168.1.100:554/stream`\n\n" +
          "**Instalacja Python:**\n" +
          "```bash\npip install opencv-python-headless ultralytics requests Pillow\n```",
        start,
      );
    }

    const cameraId = this.extractCameraId(input, rtspUrl);
    const cfg = configStore.getAll().motionDetection;
    const processEvery = cfg.platform === "n5105"
      ? Math.min(cfg.processEveryNFrames, 3)
      : cfg.processEveryNFrames;
    const apiKey = (configStore.get("llm.apiKey") as string) || "";

    try {
      await context.tauriInvoke!("motion_pipeline_start", {
        camera_id: cameraId,
        rtsp_url: rtspUrl,
        db_path: cfg.detectionsDbPath,
        python_path: cfg.pythonPath,
        pipeline_script: cfg.pipelinePath,
        process_every: processEvery,
        min_area: cfg.minContourArea,
        max_area: cfg.maxContourArea,
        var_threshold: cfg.varThreshold,
        bg_history: cfg.bgHistory,
        llm_threshold: cfg.llmConfidenceThreshold,
        cooldown_sec: cfg.cooldownSec,
        max_crop_px: cfg.maxCropPx,
        llm_model: cfg.llmVerifyModel,
        api_key: apiKey,
        platform: cfg.platform,
        night_mode: false,
        stats_interval: 60,
      });

      const platformLabel = cfg.platform === "n5105"
        ? "N5105 Intel (OpenVINO, ~5ms/frame)"
        : cfg.platform === "rpi5"
          ? "RPi 5 (TFLite, ~40ms/frame)"
          : "auto";

      const data =
        `✅ **Pipeline detekcji ruchu uruchomiony**\n\n` +
        `📷 **Kamera:** \`${cameraId}\`\n` +
        `🎥 **RTSP:** \`${rtspUrl}\`\n` +
        `⚙️ **Platforma:** ${platformLabel}\n` +
        `🔄 **Co N klatek:** ${processEvery}\n` +
        `🎯 **Próg LLM:** ${(cfg.llmConfidenceThreshold * 100).toFixed(0)}% confidence\n` +
        `⏱️ **Cooldown:** ${cfg.cooldownSec}s per klasa\n` +
        `🗄️ **DB:** \`${cfg.detectionsDbPath}\`\n\n` +
        "```\n" +
        `RTSP → co ${processEvery} klatek → MOG2 BackgroundSubtractor\n` +
        `     → kontury → crop ≤${cfg.maxCropPx}px\n` +
        `     → YOLOv8n nano (lokalnie)\n` +
        `     → conf ≥ ${(cfg.llmConfidenceThreshold * 100).toFixed(0)}%? → SQLite\n` +
        `     → conf < ${(cfg.llmConfidenceThreshold * 100).toFixed(0)}%? → Claude Haiku → SQLite\n` +
        "```\n\n" +
        `💡 \`statystyki detekcji ${cameraId}\` — wyniki\n` +
        `💡 \`stop detekcji ${cameraId}\` — zatrzymaj`;

      return {
        pluginId: this.id, status: "success",
        content: [{ type: "text", data }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.errorResult(
        `❌ **Nie udało się uruchomić pipeline:** ${msg}\n\n` +
          "Sprawdź:\n- `python3 --version`\n- `python3 -c \"import cv2\"`\n" +
          "- `python3 -c \"from ultralytics import YOLO\"`\n\n" +
          "```bash\npip install opencv-python-headless ultralytics requests Pillow\n```",
        start,
      );
    }
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  private async handleStop(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const cameraId = this.extractCameraIdGeneric(input);
    if (!cameraId) {
      return this.errorResult("Podaj ID kamery: `stop detekcji cam01`", start);
    }
    try {
      await context.tauriInvoke!("motion_pipeline_stop", { camera_id: cameraId });
      return {
        pluginId: this.id, status: "success",
        content: [{ type: "text", data: `✅ **Pipeline zatrzymany:** \`${cameraId}\`` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`❌ ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  private async handleStatus(context: PluginContext, start: number): Promise<PluginResult> {
    try {
      const result = (await context.tauriInvoke!("motion_pipeline_status")) as {
        pipelines: PipelineStatus[]; count: number;
      };

      if (result.count === 0) {
        const configPrompt: ConfigPromptData = {
          title: "🎯 Uruchom detekcję ruchu",
          description: "Brak aktywnych pipeline'ów.",
          actions: [
            {
              id: "start-example", label: "▶️ Przykład (cam01)",
              type: "prefill",
              prefillText: "detekcja ruchu rtsp://admin:pass@192.168.1.100:554/stream cam01",
              variant: "primary", description: "Uruchom pipeline dla kamery",
            },
            {
              id: "config", label: "⚙️ Konfiguracja",
              type: "execute", executeQuery: "konfiguruj detekcję ruchu",
              variant: "secondary",
            },
          ],
          layout: "buttons",
        };
        return {
          pluginId: this.id, status: "success",
          content: [
            { type: "text", data: "ℹ️ **Brak aktywnych pipeline'ów detekcji ruchu.**" },
            { type: "config_prompt", data: "🎯 Uruchom", title: "🎯 Uruchom", configPrompt },
          ],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      const lines = result.pipelines.map((p) => {
        const uptime = Math.round((Date.now() - p.started_at) / 1000);
        const uptimeStr = uptime > 3600
          ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
          : uptime > 60 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : `${uptime}s`;
        return `**${p.camera_id}** 🟢  RTSP: \`${p.rtsp_url}\`  Uptime: ${uptimeStr}`;
      });

      const configPrompt: ConfigPromptData = {
        title: "⚙️ Akcje",
        description: "",
        actions: [
          ...result.pipelines.map((p) => ({
            id: `stop-${p.camera_id}`, label: `⏹️ Stop ${p.camera_id}`,
            type: "execute" as const, executeQuery: `stop detekcji ${p.camera_id}`,
            variant: "warning" as const,
          })),
          ...result.pipelines.map((p) => ({
            id: `stats-${p.camera_id}`, label: `📊 Stats ${p.camera_id}`,
            type: "execute" as const, executeQuery: `statystyki detekcji ${p.camera_id}`,
            variant: "secondary" as const,
          })),
        ],
        layout: "buttons",
      };

      return {
        pluginId: this.id, status: "success",
        content: [
          { type: "text", data: `## 🎯 Aktywne pipeline'y (${result.count})\n\n${lines.join("\n\n")}` },
          { type: "config_prompt", data: "⚙️ Akcje", title: "⚙️ Akcje", configPrompt },
        ],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`❌ ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  private async handleStats(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const cameraId = this.extractCameraIdGeneric(input) ?? undefined;
    const cfg = configStore.getAll().motionDetection;
    const hours = this.extractHours(input) ?? 24;

    try {
      const stats = (await context.tauriInvoke!("motion_pipeline_stats", {
        db_path: cfg.detectionsDbPath,
        camera_id: cameraId ?? null,
        hours,
      })) as DetectionStats;

      const byClassLines = Object.entries(stats.by_class)
        .sort((a, b) => b[1] - a[1])
        .map(([lbl, cnt]) => {
          const bar = "█".repeat(Math.min(20, Math.round((cnt / Math.max(stats.total, 1)) * 20)));
          return `  ${lbl.padEnd(12)} ${String(cnt).padStart(5)}  ${bar}`;
        }).join("\n");

      const peakHour = Object.entries(stats.by_hour).sort((a, b) => b[1] - a[1])[0];

      const data =
        `## 📊 Statystyki detekcji${cameraId ? ` — \`${cameraId}\`` : ""} (${hours}h)\n\n` +
        `**Łącznie:** ${stats.total}  |  **Unikalne zdarzenia:** ${stats.unique_events_30s}\n` +
        `**LLM:** ${stats.llm_sent}/${stats.total}  |  **Redukcja LLM:** **${stats.llm_reduction_pct}%** 🎯\n\n` +
        `### Klasy\n\`\`\`\n${byClassLines || "  (brak danych)"}\n\`\`\`\n\n` +
        (peakHour ? `**Szczyt:** godzina ${peakHour[0]}:00 (${peakHour[1]} wykryć)\n\n` : "") +
        `💡 \`wykrycia ${cameraId ?? "cam01"}\` — pokaż ostatnie wykrycia`;

      return {
        pluginId: this.id, status: "success",
        content: [{ type: "text", data }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`❌ ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  // ── Detections list ─────────────────────────────────────────────────────────

  private async handleDetections(input: string, context: PluginContext, start: number): Promise<PluginResult> {
    const cameraId = this.extractCameraIdGeneric(input) ?? undefined;
    const cfg = configStore.getAll().motionDetection;
    const label = this.extractLabel(input) ?? undefined;
    const hours = this.extractHours(input) ?? 2;

    try {
      const rows = (await context.tauriInvoke!("motion_pipeline_detections", {
        db_path: cfg.detectionsDbPath,
        camera_id: cameraId ?? null,
        label: label ?? null,
        hours,
        limit: 20,
        include_thumbnails: false,
      })) as DetectionRow[];

      if (rows.length === 0) {
        return {
          pluginId: this.id, status: "success",
          content: [{ type: "text", data: `ℹ️ Brak wykryć w ostatnich ${hours}h.` }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      const lines = rows.map((r) => {
        const ts = new Date(r.timestamp).toLocaleString("pl-PL");
        const conf = (r.confidence * 100).toFixed(0);
        const llmInfo = r.sent_to_llm
          ? ` → LLM: **${r.llm_label}** (${r.llm_description?.slice(0, 60) ?? ""})`
          : "";
        return `- \`${ts}\` **${r.label}** ${conf}%${llmInfo} [${r.camera_id}]`;
      });

      return {
        pluginId: this.id, status: "success",
        content: [{
          type: "text",
          data: `## 🔍 Ostatnie wykrycia${cameraId ? ` — \`${cameraId}\`` : ""}\n\n` +
            lines.join("\n") + `\n\n*${rows.length} wykryć z ${hours}h*`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(`❌ ${err instanceof Error ? err.message : String(err)}`, start);
    }
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  private handleConfig(start: number): PluginResult {
    const cfg = configStore.getAll().motionDetection;

    const data =
      `## ⚙️ Konfiguracja detekcji ruchu\n\n` +
      `| Parametr | Wartość |\n|---|---|\n` +
      `| Python | \`${cfg.pythonPath}\` |\n` +
      `| Platforma | \`${cfg.platform}\` |\n` +
      `| Co N klatek | ${cfg.processEveryNFrames} |\n` +
      `| Próg LLM | ${(cfg.llmConfidenceThreshold * 100).toFixed(0)}% |\n` +
      `| Cooldown | ${cfg.cooldownSec}s |\n` +
      `| Max crop | ${cfg.maxCropPx}px |\n` +
      `| Model LLM | \`${cfg.llmVerifyModel}\` |\n` +
      `| DB | \`${cfg.detectionsDbPath}\` |\n\n` +
      "### Instalacja\n```bash\n" +
      "pip install opencv-python-headless ultralytics requests Pillow\n\n" +
      "# N5105 Intel (OpenVINO — 3-5x szybszy)\npip install openvino\n" +
      "python3 -c \"from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='openvino')\"\n```\n\n" +
      "### Wydajność\n| | RPi 5 | N5105 |\n|---|---|---|\n" +
      "| YOLOv8n TFLite | ~40ms | ~15ms |\n" +
      "| YOLOv8n OpenVINO | n/d | **~5ms** |\n" +
      "| FPS | 10-15 | 25-30 |\n| RAM | ~300MB | ~400MB |";

    const configPrompt: ConfigPromptData = {
      title: "⚙️ Platforma",
      description: "Wybierz platformę sprzętową:",
      actions: [
        { id: "rpi5", label: "🍓 RPi 5 (TFLite)", type: "set_config",
          configPath: "motionDetection.platform", configValue: "rpi5",
          variant: "primary", description: "Raspberry Pi 5 — YOLOv8n TFLite float16" },
        { id: "n5105", label: "🖥️ N5105 (OpenVINO)", type: "set_config",
          configPath: "motionDetection.platform", configValue: "n5105",
          variant: "primary", description: "Intel N5105 — OpenVINO ~5ms/frame" },
        { id: "auto", label: "🤖 Auto", type: "set_config",
          configPath: "motionDetection.platform", configValue: "auto",
          variant: "secondary", description: "Automatyczne wykrywanie" },
        { id: "threshold-60", label: "🎯 Próg LLM 60%", type: "set_config",
          configPath: "motionDetection.llmConfidenceThreshold", configValue: 0.6,
          variant: "secondary" },
        { id: "threshold-40", label: "🎯 Próg LLM 40%", type: "set_config",
          configPath: "motionDetection.llmConfidenceThreshold", configValue: 0.4,
          variant: "warning", description: "Więcej weryfikacji LLM" },
      ],
      layout: "buttons",
    };

    return {
      pluginId: this.id, status: "success",
      content: [
        { type: "text", data },
        { type: "config_prompt", data: "⚙️ Platforma", title: "⚙️ Platforma", configPrompt },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private extractRtspUrl(input: string): string | null {
    const m = input.match(/rtsp:\/\/[^\s"']+/i);
    return m ? m[0].replace(/[,;.]+$/, "") : null;
  }

  private extractCameraId(input: string, rtspUrl: string): string {
    const withoutRtsp = input.replace(rtspUrl, "").trim();
    const m = withoutRtsp.match(/\b(cam\w+|camera[\w-]+|kamera[\w-]+)\b/i);
    if (m) return m[1].toLowerCase();
    // Match IP after @ (with credentials) or after rtsp:// (without credentials)
    const ipM = rtspUrl.match(/(?:@|\/\/(?:[^@/]+@)?)([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})/);
    if (ipM) return `cam-${ipM[1].replace(/\./g, "-")}`;
    return "cam01";
  }

  private extractCameraIdGeneric(input: string): string | null {
    const m = input.match(/\b(cam[\w-]+|camera[\w-]+|kamera[\w-]+)\b/i);
    return m ? m[1].toLowerCase() : null;
  }

  private extractCameraIdFromStop(input: string): string | null {
    const m = input.match(/(?:stop|zatrzymaj|przestan)\s+(?:detekcj[aęi]\s+)?(\S+)/i);
    if (m && m[1] && !m[1].match(/^(detekcj|ruchu|pipeline)/i)) return m[1];
    return this.extractCameraIdGeneric(input);
  }

  private extractHours(input: string): number | null {
    const m = input.match(/(\d+)\s*h(?:our)?/i);
    return m ? parseInt(m[1], 10) : null;
  }

  private extractLabel(input: string): string | null {
    const labels = ["person", "car", "truck", "bus", "motorcycle", "bicycle", "dog", "cat", "bird"];
    const lower = input.toLowerCase();
    return labels.find((l) => lower.includes(l)) ?? null;
  }

  private errorResult(message: string, start: number): PluginResult {
    return {
      pluginId: this.id, status: "error",
      content: [{ type: "text", data: message }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }
}

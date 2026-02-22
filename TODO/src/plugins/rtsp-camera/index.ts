/**
 * @module plugins/rtsp-camera
 */

import type { PluginRegistry } from "../../core/pluginRegistry";
import {
  RtspCameraPlugin,
  LlmSceneDescriber,
  TauriRtspGrabber,
  type CameraConfig,
  type RtspCameraPluginOptions,
} from "./rtspCameraPlugin";

export { RtspCameraPlugin } from "./rtspCameraPlugin";
export type {
  CameraConfig,
  FrameGrabber,
  SceneDescriber,
  CapturedFrame,
} from "./rtspCameraPlugin";

export interface RegisterRtspCameraOptions {
  cameras: CameraConfig[];
  describeImage?: (base64: string, mimeType?: string, prompt?: string) => Promise<string>;
  tauriInvoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function registerRtspCameraPlugin(
  registry: PluginRegistry,
  options: RegisterRtspCameraOptions,
): RtspCameraPlugin {
  const pluginOptions: RtspCameraPluginOptions = {
    cameras: options.cameras,
    describer: options.describeImage
      ? new LlmSceneDescriber(options.describeImage)
      : undefined,
  };

  const plugin = new RtspCameraPlugin(pluginOptions);

  if (options.tauriInvoke) {
    // Add native RTSP grabber with highest priority
    const grabbers = [
      new TauriRtspGrabber(options.tauriInvoke),
      ...((pluginOptions as any).grabbers ?? []),
    ];
    // Re-create plugin with Tauri grabber
    const tauriPlugin = new RtspCameraPlugin({
      ...pluginOptions,
      grabbers,
    });
    registry.register(tauriPlugin);
    return tauriPlugin;
  }

  registry.register(plugin);
  return plugin;
}

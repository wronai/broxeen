export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return "__TAURI__" in runtimeWindow || "__TAURI_INTERNALS__" in runtimeWindow;
}

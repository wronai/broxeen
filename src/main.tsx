import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { logger, logSyncDecorator } from "./lib/logger";
import { isTauriRuntime } from "./lib/runtime";

const startupLogger = logger.scope("startup:frontend");
const disableStrictModeForTauriDev = import.meta.env.DEV && isTauriRuntime();
startupLogger.info("Starting Broxeen frontend", {
  mode: import.meta.env.MODE,
  debugLogs: import.meta.env.VITE_DEBUG === "true",
  strictMode: disableStrictModeForTauriDev ? "disabled (tauri-dev)" : "enabled",
});

const renderApp = logSyncDecorator(
  "startup:frontend",
  "renderReactTree",
  (root: HTMLElement) => {
    const app = <App />;
    ReactDOM.createRoot(root).render(
      disableStrictModeForTauriDev ? app : <React.StrictMode>{app}</React.StrictMode>,
    );
  },
);

const rootElement = document.getElementById("root");
if (!rootElement) {
  startupLogger.error("Failed to find #root element. App cannot start.");
} else {
  startupLogger.info("Root element found. Rendering app...");
  renderApp(rootElement);
}


import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { logger, logSyncDecorator } from "./lib/logger";

const startupLogger = logger.scope("startup:frontend");
startupLogger.info("Starting Broxeen frontend", {
  mode: import.meta.env.MODE,
  debugLogs: import.meta.env.VITE_DEBUG === "true",
});

const renderApp = logSyncDecorator(
  "startup:frontend",
  "renderReactTree",
  (root: HTMLElement) => {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
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


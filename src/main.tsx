import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { logger } from "./lib/logger";

logger.info("Starting Broxeen frontend...");

const rootElement = document.getElementById("root");
if (!rootElement) {
  logger.error("Failed to find root element!");
} else {
  logger.debug("Root element found, rendering app...");
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}


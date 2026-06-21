import React from "react";
import ReactDOM from "react-dom/client";
import "@xorkavi/arcade-gen/styles.css";
import "./styles/tailwind.css";
import "./styles/arcade-gen-patches.css";
import "./styles/studio.css";
import { App } from "./App";
import { initRendererTelemetry } from "./lib/telemetry/renderer";
import { installWebviewPasteBridge } from "./lib/webviewPasteBridge";

// Enable Cmd+V into our inputs when running inside the Cursor/VS Code webview
// (inert in a normal browser/Electron, where native paste already works).
installWebviewPasteBridge();

async function boot() {
  try {
    const res = await fetch("/api/telemetry/identity");
    if (res.ok) {
      const id = await res.json();
      await initRendererTelemetry({ config: id.config, distinctId: id.distinctId, sessionId: id.sessionId, version: id.version, os: id.os });
    }
  } catch {
    // telemetry must never block boot
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}

void boot();

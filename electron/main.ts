import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startVite, stopVite } from "./viteRunner.js";
import { initUpdater } from "./updater.js";
import { shouldRetryBoot, bootErrorHtml, BOOT_MAX_ATTEMPTS } from "./bootError.js";
import { initMainTelemetry, emitAppLaunched, emitAppShutdown, emitBootError } from "./telemetry.js";
import { bootstrapAwsProfile } from "./shared/awsBootstrap.js";

/**
 * File-based logging — code-signed packaged apps detach from the TTY,
 * so console.log goes to a black hole. Pipe to ~/Library/Logs/.
 */
const LOG_FILE = path.join(os.homedir(), "Library", "Logs", "arcade-studio-electron.log");
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch {}
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
const writeLog = (level: string, args: unknown[]) => {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}\n`;
  try { logStream.write(line); } catch {}
};
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
console.log = (...args) => { writeLog("info", args); origLog(...args); };
console.error = (...args) => { writeLog("error", args); origErr(...args); };
process.on("uncaughtException", (err) => {
  writeLog("uncaught", [err.message, err.stack]);
});
process.on("unhandledRejection", (reason) => {
  writeLog("rejection", [String(reason)]);
});
console.log("[main] boot", { isPackaged: app.isPackaged, version: app.getVersion(), execPath: process.execPath, resourcesPath: process.resourcesPath });

/**
 * In the packaged app, prefix PATH with the bundled CLI directories
 * so middleware-spawned subprocesses (claude, cloudflared, aws,
 * figmanage) resolve to our vendored binaries. In dev, the host's
 * PATH is used as-is.
 */
function patchPath(): void {
  if (!app.isPackaged) return;
  const resourcesPath = process.resourcesPath;
  const dirs = [
    path.join(resourcesPath, "bin"),
    path.join(resourcesPath, "aws-cli"),
  ];
  process.env.PATH = `${dirs.join(":")}:${process.env.PATH ?? ""}`;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = path.join(resourcesPath, "bin", "claude");
}
patchPath();

// Surface packaging state + version to the Vite child (it inherits
// process.env when spawned). Must be set before createWindow() →
// startVite() forks the child.
process.env.ARCADE_IS_PACKAGED = app.isPackaged ? "1" : "0";
process.env.ARCADE_APP_VERSION = app.getVersion();

bootstrapAwsProfile();

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;
let windowReady = false;

/**
 * Resolves the app's repo root.
 *
 * Production (packaged): app lives at <Resources>/app/.
 *   process.resourcesPath = <Bundle>/Contents/Resources
 *
 * Dev (`pnpm run studio:electron`): we run from the repo root.
 *   process.cwd() is the repo root.
 */
function appRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return process.cwd();
}

/** Start Vite with bounded retries. Returns the URL, or null after BOOT_MAX_ATTEMPTS
 *  failures (caller then shows the error page instead of hanging — the 0.42.0 fix). */
async function tryStartVite(): Promise<string | null> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    console.log("[main] startVite begin", { appRoot: appRoot(), attempt });
    try {
      const url = await startVite(appRoot());
      console.log("[main] startVite ready", { url, attempt });
      return url;
    } catch (err) {
      console.error("[main] startVite FAILED", { attempt, message: (err as Error)?.message });
      if (!shouldRetryBoot(attempt, BOOT_MAX_ATTEMPTS)) return null;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

/** Load the inline error page (data: URL, no Vite dependency). */
async function showBootError(): Promise<void> {
  if (!mainWindow) return;
  await mainWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(bootErrorHtml(LOG_FILE)),
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Arcade Studio",
    backgroundColor: "#0d0d0d",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Attach diagnostic listeners BEFORE any loadURL so early load failures and
  // renderer console output are captured. If the real (http) page fails to load
  // even though the port answered — Vite child crashed at/after the port check,
  // strictPort reclaim race — fall back to the error page ONCE (guarded so the
  // data: URL load, which does NOT fire did-fail-load, can't recurse).
  let bootErrorShown = false;
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    console.error("[main] did-fail-load", { code, desc, validatedURL });
    if (!bootErrorShown && validatedURL?.startsWith("http")) {
      bootErrorShown = true;
      void showBootError();
    }
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log("[renderer]", { level, message, line, source });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    windowReady = false;
  });

  const url = await tryStartVite();
  if (!url) {
    console.error("[main] Vite failed after retries — showing error page");
    emitBootError();
    await showBootError();
    return;
  }

  const finalUrl = pendingDeepLink
    ? `${url}/#share=${encodeURIComponent(pendingDeepLink)}`
    : url;
  pendingDeepLink = null;
  console.log("[main] loadURL", { finalUrl });
  await mainWindow.loadURL(finalUrl);
  console.log("[main] loadURL completed");
  windowReady = true;
}

// macOS: register as the handler for arcade-studio:// URLs.
app.setAsDefaultProtocolClient("arcade-studio");

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow && windowReady) {
    // Window already exists — forward the deep link via hash navigation.
    mainWindow.webContents.executeJavaScript(
      `window.location.hash = "share=${encodeURIComponent(url)}";`,
    );
  } else {
    // App launched via deep link before the window exists. Stash and
    // apply during createWindow.
    pendingDeepLink = url;
  }
});

app.whenReady().then(async () => {
  await initMainTelemetry();
  emitAppLaunched(false);
  void createWindow();
  initUpdater();
});

app.on("window-all-closed", () => {
  // macOS convention: keep app alive when all windows close, but for a
  // single-window dev tool app the user expectation is that Cmd-Q quits.
  // Quit on close; matches the current browser-tab UX.
  app.quit();
});

app.on("before-quit", async (event) => {
  // Stop Vite cleanly before exit.
  event.preventDefault();
  await emitAppShutdown();
  await stopVite();
  app.exit(0);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

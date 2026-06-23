import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startVite, stopVite } from "./viteRunner.js";
import { initUpdater } from "./updater.js";
import { initMainTelemetry, emitAppLaunched, emitAppShutdown } from "./telemetry.js";
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

async function createWindow(): Promise<void> {
  console.log("[main] startVite begin", { appRoot: appRoot() });
  const url = await startVite(appRoot()).catch((err) => {
    console.error("[main] startVite FAILED", err?.message, err?.stack);
    throw err;
  });
  console.log("[main] startVite ready", { url });

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Arcade Studio",
    backgroundColor: "#0d0d0d",
    webPreferences: {
      // No node integration in the renderer — the React shell is plain
      // browser code that talks to Vite middleware via fetch. Same model
      // as the current browser-tab UX.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Forward deep-link to the React shell as a hash fragment, the same
  // way the old launcher.sh did it. The shell's useDeepLinkRoute hook
  // reads the hash on boot.
  const finalUrl = pendingDeepLink
    ? `${url}/#share=${encodeURIComponent(pendingDeepLink)}`
    : url;
  pendingDeepLink = null;

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, validatedURL) => {
    console.error("[main] did-fail-load", { code, desc, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[main] render-process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log("[renderer]", { level, message, line, source });
  });
  console.log("[main] loadURL", { finalUrl });
  await mainWindow.loadURL(finalUrl);
  console.log("[main] loadURL completed");

  // Open external links (e.g., docs, share URLs to Cloudflare) in the
  // user's default browser instead of the Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// macOS: register as the handler for arcade-studio:// URLs.
app.setAsDefaultProtocolClient("arcade-studio");

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow) {
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

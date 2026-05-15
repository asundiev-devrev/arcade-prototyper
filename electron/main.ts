import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { startVite, stopVite } from "./viteRunner";

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
  const url = await startVite(appRoot());

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

  await mainWindow.loadURL(finalUrl);

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

app.whenReady().then(() => {
  void createWindow();
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
  await stopVite();
  app.exit(0);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

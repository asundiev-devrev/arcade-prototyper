import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startVite, stopVite } from "./viteRunner.js";
import { initUpdater } from "./updater.js";

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
    path.join(resourcesPath, "bin", "figmanage-bin"),
    path.join(resourcesPath, "aws-cli"),
  ];
  process.env.PATH = `${dirs.join(":")}:${process.env.PATH ?? ""}`;
  process.env.ARCADE_STUDIO_CLAUDE_BIN = path.join(resourcesPath, "bin", "claude");
}
patchPath();

/**
 * First-run bootstrap of ~/.aws/config with the DevRev SSO [profile dev]
 * block. Ported from the legacy launcher.sh.
 *
 * Idempotent: if a [profile dev] block already exists (literal line
 * match, not parsing), the file is left alone. This protects users who
 * customized their profile from getting clobbered.
 *
 * Always sets AWS_PROFILE=dev (unless user already set it) so claude/aws
 * subprocess invocations default to the SSO profile without users
 * editing their shell rc files.
 *
 * The values match the DevRev Bedrock SSO portal. If they change, this
 * block AND studio/docs/aws-setup.md must be updated in lockstep.
 */
function bootstrapAwsProfile(): void {
  const awsDir = path.join(os.homedir(), ".aws");
  const awsConfig = path.join(awsDir, "config");

  let existing = "";
  try {
    existing = fs.readFileSync(awsConfig, "utf-8");
  } catch {
    // ENOENT — file doesn't exist yet, treat as empty
  }

  if (!/^\[profile dev\]/m.test(existing)) {
    const block = [
      "",
      "[profile dev]",
      "sso_start_url = https://d-9067645937.awsapps.com/start#",
      "sso_region = us-east-1",
      "sso_account_id = 020040093233",
      "sso_role_name = BedrockLongLivedTokenAccess",
      "region = us-east-1",
      "",
    ].join("\n");
    fs.mkdirSync(awsDir, { recursive: true });
    fs.appendFileSync(awsConfig, block);
    console.log(`[main] Installed [profile dev] into ${awsConfig}`);
  }

  process.env.AWS_PROFILE = process.env.AWS_PROFILE || "dev";
}
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
  await stopVite();
  app.exit(0);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

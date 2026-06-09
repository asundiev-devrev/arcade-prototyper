import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

const VITE_PORT = 5556;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

let viteProc: ChildProcess | null = null;
/** Set when the child exits before we confirm it's serving — lets waitForPort
 *  bail immediately instead of waiting out the full timeout (and never letting
 *  a foreign server's response masquerade as ours). */
let viteExitedDuringStartup = false;

/**
 * Spawns Vite as a child process and waits for localhost:5556 to respond.
 * Returns the URL. Throws if Vite doesn't come up within STARTUP_TIMEOUT_MS.
 *
 * In production (packaged app), the repo source lives at
 * <Resources>/app/. In dev (running from the repo), we run from the
 * worktree root.
 */
export async function startVite(appRoot: string): Promise<string> {
  const viteEntry = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(appRoot, "studio", "vite.config.ts");

  // Pre-flight: if something ALREADY answers on 5556, it's not us — a stale
  // prior instance, a leftover dev server, or a port squatter. Vite is
  // strictPort, so our child would fail to bind and exit; but the app hardcodes
  // 5556 and would then load that FOREIGN server. Detect + fail loudly instead
  // of silently driving the wrong process.
  if (await tryGet(VITE_URL)) {
    throw new Error(
      `[viteRunner] Port ${VITE_PORT} is already in use by another process. ` +
      `Arcade Studio may already be running, or a previous instance didn't exit cleanly. ` +
      `Quit it (or free port ${VITE_PORT}) and relaunch.`,
    );
  }

  console.log(`[viteRunner] spawning Vite via ${process.execPath} entry=${viteEntry} cwd=${appRoot}`);
  viteExitedDuringStartup = false;
  viteProc = spawn(process.execPath, [viteEntry, "--config", configPath], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      // Suppress Vite's `open: true` — we render in our BrowserWindow,
      // not the user's default browser. studio/vite.config.ts honors
      // this env var.
      ARCADE_STUDIO_OPEN_BROWSER: "0",
      // Telemetry context for the Vite child (Task 9 boot block reads
      // these). ARCADE_TELEMETRY_DEBUG is already forwarded via ...process.env.
      ARCADE_RESOURCES_PATH: process.resourcesPath ?? "",
      ARCADE_IS_PACKAGED: process.env.ARCADE_IS_PACKAGED ?? "",
      ARCADE_APP_VERSION: process.env.ARCADE_APP_VERSION ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  viteProc.stdout?.on("data", (chunk) => {
    console.log(`[vite stdout] ${chunk.toString().trimEnd()}`);
  });
  viteProc.stderr?.on("data", (chunk) => {
    console.error(`[vite stderr] ${chunk.toString().trimEnd()}`);
  });
  viteProc.on("error", (err) => {
    console.error(`[viteRunner] spawn error: ${err.message}`);
  });
  viteProc.on("exit", (code, signal) => {
    console.log(`[viteRunner] Vite exited with code=${code} signal=${signal}`);
    viteExitedDuringStartup = true;
    viteProc = null;
  });

  await waitForPort(VITE_URL, STARTUP_TIMEOUT_MS);
  return VITE_URL;
}

/**
 * Stops the Vite child process. Sends SIGTERM, waits up to 2s, then
 * SIGKILL. Idempotent — safe to call multiple times.
 */
export function stopVite(): Promise<void> {
  return new Promise((resolve) => {
    const proc = viteProc;
    if (!proc || proc.killed) {
      resolve();
      return;
    }
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    proc.on("exit", finish);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (viteProc && !viteProc.killed) {
        viteProc.kill("SIGKILL");
      }
      // Final fallback after SIGKILL
      setTimeout(finish, 200);
    }, 2000);
  });
}

async function waitForPort(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // If the child died (e.g. strictPort bind failure), stop waiting — don't
    // risk a foreign server on this port answering and looking like success.
    if (viteExitedDuringStartup) {
      throw new Error(
        `[viteRunner] Vite exited during startup before serving ${url}. ` +
        `Likely a port ${VITE_PORT} bind failure (strictPort) — another instance may hold it.`,
      );
    }
    if (await tryGet(url)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Vite did not respond on ${url} within ${timeoutMs}ms`);
}

function tryGet(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

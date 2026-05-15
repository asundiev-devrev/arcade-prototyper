import { spawn, ChildProcess } from "node:child_process";
import path from "node:path";
import http from "node:http";

const VITE_PORT = 5556;
const VITE_URL = `http://localhost:${VITE_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

let viteProc: ChildProcess | null = null;

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

  console.log(`[viteRunner] spawning Vite via ${process.execPath} entry=${viteEntry} cwd=${appRoot}`);
  viteProc = spawn(process.execPath, [viteEntry, "--config", configPath], {
    cwd: appRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
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

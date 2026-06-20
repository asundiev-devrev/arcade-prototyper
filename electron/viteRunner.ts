import { spawn, ChildProcess, execFile } from "node:child_process";
import path from "node:path";
import http from "node:http";

const DEFAULT_VITE_PORT = 5556;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

let viteProc: ChildProcess | null = null;
/** Set when the child exits before we confirm it's serving — lets waitForPort
 *  bail immediately instead of waiting out the full timeout (and never letting
 *  a foreign server's response masquerade as ours). */
let viteExitedDuringStartup = false;
/** The port the current child was told to bind. Reclaim helpers key off this. */
let activePort = DEFAULT_VITE_PORT;

/**
 * Spawns Vite as a child process and waits for localhost:5556 to respond.
 * Returns the URL. Throws if Vite doesn't come up within STARTUP_TIMEOUT_MS.
 *
 * In production (packaged app), the repo source lives at
 * <Resources>/app/. In dev (running from the repo), we run from the
 * worktree root.
 */
export async function startVite(
  appRoot: string,
  opts: { port?: number } = {},
): Promise<string> {
  activePort = opts.port ?? DEFAULT_VITE_PORT;
  const viteUrl = `http://localhost:${activePort}`;
  const viteEntry = path.join(appRoot, "node_modules", "vite", "bin", "vite.js");
  const configPath = path.join(appRoot, "studio", "vite.config.ts");

  // Pre-flight: if something ALREADY answers on 5556, our strictPort child
  // can't bind and the app would load the FOREIGN server (or, more often, show
  // a windowless shell). The common cause is a STALE Arcade Vite — an orphaned
  // child from an auto-update restart that raced its own cleanup, or a leftover
  // `pnpm run studio` dev server. We self-heal those: identify the holder and,
  // ONLY if it is unmistakably an Arcade Vite (its argv runs studio/vite.config
  // via vite.js), kill it and wait for the port to free. A genuine foreign
  // process is never touched — we still fail loudly so we don't hijack it.
  // Reclaim if ANYTHING holds the port — not only when it answers HTTP. On an
  // auto-update relaunch the previous instance's Vite is often mid-shutdown: it
  // still owns the TCP listener (so our strictPort bind fails) but no longer
  // answers HTTP (so a `tryGet` probe alone misses it, skips reclaim, and the
  // spawn dies "port in use" → the window never loads). Checking for a live
  // listener catches that teardown window too. reclaimStaleVitePort only ever
  // kills a process whose argv is unmistakably our own Vite (isArcadeViteCommand).
  const portHeld = (await tryGet(viteUrl)) || (await listenersOnPort(activePort)).length > 0;
  if (portHeld) {
    const reclaimed = await reclaimStaleVitePort(activePort);
    if (!reclaimed) {
      throw new Error(
        `[viteRunner] Port ${activePort} is already in use by another process ` +
        `(not an Arcade Studio Vite server). Free port ${activePort} and relaunch.`,
      );
    }
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
      ARCADE_STUDIO_PORT: String(activePort),
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

  await waitForPort(viteUrl, STARTUP_TIMEOUT_MS);
  return viteUrl;
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

/**
 * Is this process command line unmistakably an Arcade Studio Vite server?
 * Pure + exported for tests. The signature is the Vite entry script running
 * our config — true for BOTH a packaged-app child and a `pnpm run studio` dev
 * server, false for any unrelated process (a different vite, a random server),
 * so we only ever kill something that is genuinely our own stale Vite.
 */
export function isArcadeViteCommand(command: string): boolean {
  if (!command) return false;
  // Require the actual Vite ENTRY SCRIPT (vite/bin/vite.js), not merely the
  // substring "vite" — otherwise a process whose args happen to contain "vite"
  // (e.g. "...vite.config.ts.bak") would false-match, and we KILL matches.
  const hasViteEntry = command.includes("vite/bin/vite.js");
  // Require our config passed as a real --config argument (with a separator
  // after the path), so "studio/vite.config.ts.bak" doesn't satisfy it.
  const hasOurConfig = /studio\/vite\.config\.ts(\s|$|")/.test(command);
  return hasViteEntry && hasOurConfig;
}

/**
 * Parse `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpc` output into the listening
 * pid(s) + their command names. lsof -F emits field-prefixed lines: `p<pid>`,
 * `c<command>`. Pure + exported for tests.
 */
export function parseLsofListeners(output: string): Array<{ pid: number; command: string }> {
  const out: Array<{ pid: number; command: string }> = [];
  let pid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      const n = Number.parseInt(line.slice(1), 10);
      pid = Number.isFinite(n) ? n : null;
    } else if (line.startsWith("c") && pid !== null) {
      out.push({ pid, command: line.slice(1) });
    }
  }
  return out;
}

/** Full argv of a pid via `ps -o command=`. Empty string on any failure. */
function processCommand(pid: number): Promise<string> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "command=", "-p", String(pid)], (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
  });
}

/** Pids LISTENing on the given port, via lsof. Empty on any failure (lsof missing,
 *  nothing listening) — the caller then can't reclaim and fails loudly. */
function listenersOnPort(port: number): Promise<Array<{ pid: number; command: string }>> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
      (err, stdout) => {
        if (err && !stdout) { resolve([]); return; }
        resolve(parseLsofListeners(stdout));
      },
    );
  });
}

/**
 * If the given port is held by a STALE Arcade Vite (per isArcadeViteCommand on
 * its full argv), SIGKILL it and wait for the port to free. Returns true if the
 * port is now free to bind, false if the holder is foreign (caller fails loudly)
 * or it couldn't be freed. Never kills a non-Arcade process.
 */
async function reclaimStaleVitePort(port: number): Promise<boolean> {
  const listeners = await listenersOnPort(port);
  if (!listeners.length) {
    // Something answered HTTP but we can't see a listener (e.g. lsof absent).
    // Don't blind-kill; treat as not-reclaimable.
    return false;
  }
  for (const { pid } of listeners) {
    // Use the FULL argv (ps), not lsof's truncated command name, to match.
    const argv = await processCommand(pid);
    if (!isArcadeViteCommand(argv)) {
      console.error(`[viteRunner] port ${port} held by foreign pid ${pid} (${argv.slice(0, 80)}); not killing.`);
      return false;
    }
    console.log(`[viteRunner] reclaiming stale Arcade Vite pid ${pid} holding port ${port}`);
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
  // Wait up to ~3s for the port to actually free (TIME_WAIT / socket teardown).
  const viteUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await tryGet(viteUrl))) return true;
    await sleep(150);
  }
  return false;
}

async function waitForPort(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // If the child died (e.g. strictPort bind failure), stop waiting — don't
    // risk a foreign server on this port answering and looking like success.
    if (viteExitedDuringStartup) {
      throw new Error(
        `[viteRunner] Vite exited during startup before serving ${url}. ` +
        `Likely a port ${activePort} bind failure (strictPort) — another instance may hold it.`,
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

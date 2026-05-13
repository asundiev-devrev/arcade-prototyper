import { spawn, type ChildProcess } from "node:child_process";

/**
 * Spawn `cloudflared tunnel --url http://localhost:<port>` and resolve with
 * the ephemeral `*.trycloudflare.com` URL when it appears in cloudflared's
 * stderr output. Cloudflared writes logs to stderr, not stdout.
 *
 * Only one tunnel is supported at a time. Call stopTunnel() to terminate.
 * A second startTunnel() call without stopping first will reject.
 */

const TRYCLOUDFLARE_URL_RE = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;
const START_TIMEOUT_MS = 30_000;

let currentProc: ChildProcess | null = null;
let currentUrl: string | null = null;

export interface StartTunnelOptions {
  port: number;
}

export async function startTunnel(opts: StartTunnelOptions): Promise<string> {
  if (currentProc) {
    throw new Error("Tunnel already running — stopTunnel() first");
  }

  let proc: ChildProcess;
  try {
    proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${opts.port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error(
        "cloudflared not found. Install with `brew install cloudflared` or bundle with the DMG.",
      );
    }
    throw err;
  }

  currentProc = proc;

  return new Promise<string>((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      stopTunnel();
      reject(new Error("cloudflared did not emit a URL within 30s"));
    }, START_TIMEOUT_MS);

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(TRYCLOUDFLARE_URL_RE);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timer);
        currentUrl = match[1];
        resolve(match[1]);
      }
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    proc.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        currentProc = null;
        reject(new Error(`cloudflared exited with code ${code} before emitting a URL`));
      }
    });
  });
}

export function stopTunnel(): void {
  if (!currentProc) return;
  try { currentProc.kill("SIGTERM"); } catch {}
  currentProc = null;
  currentUrl = null;
}

export function currentTunnelUrl(): string | null {
  return currentUrl;
}

/** Test-only: reset module state. Does NOT kill any real process. */
export function __resetTunnelForTests(): void {
  currentProc = null;
  currentUrl = null;
}

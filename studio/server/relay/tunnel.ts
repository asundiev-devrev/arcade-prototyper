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

  // Spawn returns a ChildProcess even when the binary doesn't exist —
  // ENOENT is delivered asynchronously via the 'error' event, NOT thrown
  // synchronously. We must attach an error handler on the returned proc
  // BEFORE Node gets a chance to raise it as an unhandled event (which
  // would kill the Vite process and take all of Studio down with it).
  //
  // The synchronous try/catch below is kept as belt-and-suspenders for
  // platforms/paths where spawn does throw; empirically on macOS it
  // doesn't.
  let proc: ChildProcess;
  try {
    // Cloudflared emits the trycloudflare URL at INFO level, not WARN —
    // dropping to `--loglevel warn` hides the URL entirely. We stay on
    // the default log level and instead detach our data listeners as
    // soon as we've parsed the URL (see below), so the downstream noise
    // drains silently.
    proc = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${opts.port}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const errno = (err as NodeJS.ErrnoException | undefined)?.code;
    if (errno === "ENOENT") {
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
      if (resolved) return; // Drop data once we've parsed the URL.
      const text = chunk.toString();
      const match = text.match(TRYCLOUDFLARE_URL_RE);
      if (match) {
        resolved = true;
        clearTimeout(timer);
        currentUrl = match[1];
        // Detach listeners so future tunnel output doesn't flow through
        // our event loop (just quietly drains the pipe buffers).
        proc.stdout?.removeAllListeners("data");
        proc.stderr?.removeAllListeners("data");
        // Pipe remaining output to /dev/null-equivalent: `on("data", noop)`
        // prevents the pipe from filling up, which would eventually stall
        // cloudflared's writes.
        proc.stdout?.on("data", () => {});
        proc.stderr?.on("data", () => {});
        resolve(match[1]);
      }
    };

    proc.stdout?.on("data", onChunk);
    proc.stderr?.on("data", onChunk);

    // Must attach an 'error' handler — on macOS, a missing binary produces
    // an async 'error' event (ENOENT) rather than a synchronous throw. An
    // unhandled 'error' event on a ChildProcess is fatal to the Node process.
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      currentProc = null;
      if (err.code === "ENOENT") {
        reject(new Error(
          "cloudflared not found. Install it with `brew install cloudflared` and restart Studio.",
        ));
      } else {
        reject(new Error(`cloudflared spawn failed: ${err.message}`));
      }
    });

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

/** Test-only: pre-populate the tunnel URL so acquireTunnel skips spawn. */
export function __setTunnelUrlForTests(url: string | null): void {
  currentUrl = url;
}

const refs = new Set<string>();

/**
 * Acquire the shared tunnel on behalf of a project. If the tunnel isn't
 * running, start it. Multiple projects share one cloudflared process —
 * the public tunnel URL is identical for all of them; allowlist enforcement
 * happens at the WebSocket layer, not at the tunnel.
 */
export async function acquireTunnel(holderId: string): Promise<string> {
  refs.add(holderId);
  const existing = currentTunnelUrl();
  const url = existing ?? (await startTunnel({ port: 5556 }));
  // Best-effort rendezvous publish: tunnel still works without it (only
  // 0.21+ guests benefit). holderId is the projectShareId for shared-project
  // holders; for non-shared holders (legacy session ids) getProject returns
  // undefined and we skip the publish silently.
  void publishHolderRendezvous(holderId, url).catch((err) => {
    console.warn(`[tunnel] rendezvous publish failed for ${holderId}:`, err?.message ?? err);
  });
  return url;
}

async function publishHolderRendezvous(holderId: string, tunnelUrl: string): Promise<void> {
  // Dynamic imports break the otherwise-circular dependency:
  //   projectRegistry.republishAllRendezvous() -> tunnel.acquireTunnel()
  //   tunnel.publishHolderRendezvous() -> projectRegistry.getProject()
  const { getShareKey } = await import("../secrets/shareKey");
  const { publishRendezvous } = await import("../cloudflare/rendezvous");
  const { getProject } = await import("./projectRegistry");
  const key = await getShareKey();
  if (!key) return;
  const project = getProject(holderId);
  if (!project) return; // Holder is not a shared-project (e.g. legacy session id).
  const wssUrl = tunnelUrl.replace(/^https:/, "wss:") + "/api/multiplayer/ws";
  await publishRendezvous({
    shareKey: key,
    shareId: holderId,
    relayUrl: wssUrl,
    hostDevu: project.hostDevu,
    hostDisplayName: await resolveHostDisplayName(project.hostDevu),
  });
}

async function resolveHostDisplayName(hostDevu: string): Promise<string> {
  // Display name only ever surfaces in a guest's offline banner so a stable
  // fallback (the bare devu id) is fine when PAT lookup is unavailable.
  try {
    const { resolveDevuFromPat } = await import("./auth");
    const { getDevRevPat } = await import("../secrets/keychain");
    const pat = (await getDevRevPat()) || process.env.DEVREV_PAT || "";
    if (!pat) return hostDevu;
    const me = await resolveDevuFromPat(pat);
    if (me?.id === hostDevu && me.displayName) return me.displayName;
    return hostDevu;
  } catch {
    return hostDevu;
  }
}

/**
 * Release the tunnel on behalf of a project. When the last holder
 * releases, the tunnel is stopped to reclaim the cloudflared process.
 */
export async function releaseTunnel(holderId: string): Promise<void> {
  refs.delete(holderId);
  if (refs.size === 0) {
    await stopTunnel();
  }
}

/** Test-only: clear the holder set without touching the tunnel. */
export function __resetTunnelRefsForTests(): void {
  refs.clear();
}

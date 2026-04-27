import { spawn, type SpawnOptions } from "node:child_process";

/**
 * First-run dependency pre-flight.
 *
 * Reports which required dependencies are missing on first run — `brew`,
 * `node`, `pnpm`, and `figmanage` (the REST-API Figma CLI the agent
 * depends on). v1 only reports; no silent install. A UI banner can
 * later paste the shell snippet that installs them.
 *
 * Notes on design:
 *   - `brew` is macOS-only — on Linux/Windows we skip that check entirely.
 *   - Each `which` probe has a short timeout so a hanging `which` (extremely
 *     rare, but possible under a saturated shell init) never stalls the
 *     endpoint.
 *   - Results are cached for 60s because deps don't change mid-session and
 *     the frontend may poll.
 */

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 3_000;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions
) => ReturnType<typeof spawn>;

export interface EnsureDepsOptions {
  spawnFn?: SpawnFn;
  /** Injected clock so cache tests are deterministic. */
  now?: () => number;
  /** Override for tests. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export interface EnsureDepsResult {
  ok: boolean;
  missing: string[];
}

let cached: { at: number; value: EnsureDepsResult } | null = null;

/** Test-only: reset the in-memory cache so each test starts clean. */
export function resetEnsureDepsCache(): void {
  cached = null;
}

export async function ensureDeps(
  opts: EnsureDepsOptions = {}
): Promise<EnsureDepsResult> {
  const now = opts.now ?? Date.now;
  if (cached && now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const platform = opts.platform ?? process.platform;
  const missing: string[] = [];

  // `brew` is only expected on macOS. On Linux/Windows we skip it —
  // otherwise the banner would always complain about missing brew, which
  // is both misleading and unactionable.
  if (platform === "darwin") {
    if (!(await has("brew", opts))) missing.push("brew");
  }

  if (!(await has("node", opts))) missing.push("node");
  if (!(await has("pnpm", opts))) missing.push("pnpm");
  if (!(await has("figmanage", opts))) missing.push("figmanage");

  const value: EnsureDepsResult = { ok: missing.length === 0, missing };
  cached = { at: now(), value };
  return value;
}

/**
 * Run `which <cmd>` and resolve true iff it exits 0.
 * Resolves false on non-zero exit, spawn errors (e.g. `which` itself
 * missing — vanishingly unlikely but possible in a broken container),
 * synchronous spawn throws, or after a timeout.
 */
export function has(cmd: string, opts: EnsureDepsOptions = {}): Promise<boolean> {
  const spawnFn = opts.spawnFn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawnFn("which", [cmd], { stdio: "ignore" });
    } catch {
      settle(false);
      return;
    }

    timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      settle(false);
    }, timeoutMs);

    proc.on("close", (code) => {
      settle(code === 0);
    });
    proc.on("error", () => {
      settle(false);
    });
  });
}

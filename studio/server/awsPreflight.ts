import { spawn, type SpawnOptions } from "node:child_process";

/**
 * Pre-flight check for AWS SSO credentials.
 *
 * Uses `aws sts get-caller-identity` to verify that credentials are valid.
 * Caches a successful result for 30s so we don't hammer the AWS CLI on every
 * chat turn.
 *
 * If the `aws` binary itself is missing we treat it as pass-through (valid):
 * the user clearly isn't using Bedrock-backed `claude`, so SSO is not our
 * concern. Only a real nonzero exit from `aws` counts as "expired".
 */

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

let lastOk = 0;

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions
) => ReturnType<typeof spawn>;

export interface ProbeOptions {
  spawnFn?: SpawnFn;
  timeoutMs?: number;
}

export type ProbeResult = "ok" | "failed" | "not-installed";

function isNotInstalledError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ENOENT";
}

/**
 * Run `aws sts get-caller-identity`.
 *  - "ok": exited 0 (valid credentials)
 *  - "failed": aws ran but exited nonzero (expired / not configured) or timed out
 *  - "not-installed": aws binary missing (ENOENT on spawn)
 */
export function probe(opts: ProbeOptions = {}): Promise<ProbeResult> {
  const spawnFn = opts.spawnFn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const settle = (value: ProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawnFn("aws", ["sts", "get-caller-identity"], {
        env: process.env,
        stdio: "ignore",
      });
    } catch (err) {
      settle(isNotInstalledError(err) ? "not-installed" : "failed");
      return;
    }

    timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      settle("failed");
    }, timeoutMs);

    proc.on("close", (code) => {
      settle(code === 0 ? "ok" : "failed");
    });
    proc.on("error", (err) => {
      settle(isNotInstalledError(err) ? "not-installed" : "failed");
    });
  });
}

export async function ssoIsValid(opts: ProbeOptions = {}): Promise<boolean> {
  // Test/dev escape hatch: integration tests of the chat middleware don't
  // want to invoke the real `aws` CLI. Setting this env var short-circuits
  // the probe without touching the 30s cache.
  if (process.env.ARCADE_STUDIO_SKIP_SSO_CHECK === "1") return true;
  if (Date.now() - lastOk < CACHE_TTL_MS) return true;
  const result = await probe(opts);
  // "not-installed" means the user isn't on Bedrock — claude handles auth
  // some other way (API key, etc.). Treat as pass-through.
  if (result === "ok" || result === "not-installed") {
    if (result === "ok") lastOk = Date.now();
    return true;
  }
  return false;
}

/** Test-only: reset the in-memory cache so each test starts clean. */
export function resetPreflightCache(): void {
  lastOk = 0;
}

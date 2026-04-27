// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  ssoIsValid,
  probe,
  resetPreflightCache,
  type SpawnFn,
} from "../../server/awsPreflight";

type FakeProc = EventEmitter & Pick<ChildProcess, "kill">;

/** Build a fake child process that emits `close` with the given code after `delayMs`. */
function makeCloseStub(code: number, delayMs = 0): { spawnFn: SpawnFn; proc: FakeProc } {
  const proc = new EventEmitter() as FakeProc;
  proc.kill = vi.fn().mockReturnValue(true);
  const spawnFn = vi.fn(() => {
    setTimeout(() => proc.emit("close", code), delayMs);
    return proc as unknown as ChildProcess;
  }) as unknown as SpawnFn;
  return { spawnFn, proc };
}

/** Build a fake child process that emits `error` after `delayMs`. */
function makeErrorStub(err: Error, delayMs = 0): { spawnFn: SpawnFn; proc: FakeProc } {
  const proc = new EventEmitter() as FakeProc;
  proc.kill = vi.fn().mockReturnValue(true);
  const spawnFn = vi.fn(() => {
    setTimeout(() => proc.emit("error", err), delayMs);
    return proc as unknown as ChildProcess;
  }) as unknown as SpawnFn;
  return { spawnFn, proc };
}

/** A fake child process that never emits anything (simulates a hang). */
function makeHangStub(): { spawnFn: SpawnFn; proc: FakeProc } {
  const proc = new EventEmitter() as FakeProc;
  proc.kill = vi.fn().mockReturnValue(true);
  const spawnFn = vi.fn(() => proc as unknown as ChildProcess) as unknown as SpawnFn;
  return { spawnFn, proc };
}

describe("awsPreflight", () => {
  beforeEach(() => {
    resetPreflightCache();
  });

  it("returns true on cache hit without spawning a probe", async () => {
    // Seed the cache by doing one successful probe.
    const seed = makeCloseStub(0);
    expect(await ssoIsValid({ spawnFn: seed.spawnFn })).toBe(true);
    expect(seed.spawnFn).toHaveBeenCalledTimes(1);

    // Second call within the 30s TTL must NOT spawn again.
    const again = makeCloseStub(0);
    expect(await ssoIsValid({ spawnFn: again.spawnFn })).toBe(true);
    expect(again.spawnFn).toHaveBeenCalledTimes(0);
  });

  it("returns true on cache miss + successful exit and updates the cache", async () => {
    const { spawnFn } = makeCloseStub(0);
    expect(await ssoIsValid({ spawnFn })).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // Subsequent call should now be cached.
    const followup = makeCloseStub(1); // would be false if it did spawn
    expect(await ssoIsValid({ spawnFn: followup.spawnFn })).toBe(true);
    expect(followup.spawnFn).toHaveBeenCalledTimes(0);
  });

  it("returns false on cache miss + non-zero exit and does not update cache", async () => {
    const { spawnFn } = makeCloseStub(1);
    expect(await ssoIsValid({ spawnFn })).toBe(false);

    // Cache must still be empty: next call should spawn again.
    const followup = makeCloseStub(1);
    expect(await ssoIsValid({ spawnFn: followup.spawnFn })).toBe(false);
    expect(followup.spawnFn).toHaveBeenCalledTimes(1);
  });

  it("treats missing aws binary (ENOENT async) as pass-through (not on Bedrock)", async () => {
    const err = Object.assign(new Error("spawn aws ENOENT"), { code: "ENOENT" });
    const { spawnFn } = makeErrorStub(err);
    expect(await ssoIsValid({ spawnFn })).toBe(true);
  });

  it("treats missing aws binary (ENOENT sync throw) as pass-through", async () => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error("spawn aws ENOENT"), { code: "ENOENT" });
    }) as unknown as SpawnFn;
    expect(await ssoIsValid({ spawnFn })).toBe(true);
  });

  it("returns false when the spawn emits a non-ENOENT error (real failure)", async () => {
    const { spawnFn } = makeErrorStub(new Error("EPERM"));
    expect(await ssoIsValid({ spawnFn })).toBe(false);
  });

  it("returns 'failed' when spawn throws a non-ENOENT error synchronously", async () => {
    const spawnFn = vi.fn(() => {
      throw new Error("spawn failed");
    }) as unknown as SpawnFn;
    expect(await probe({ spawnFn })).toBe("failed");
  });

  it("kills the process and returns 'failed' when the probe times out", async () => {
    const { spawnFn, proc } = makeHangStub();
    const result = await probe({ spawnFn, timeoutMs: 20 });
    expect(result).toBe("failed");
    expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("probe ignores late close events after timeout fired", async () => {
    const { spawnFn, proc } = makeHangStub();
    const p = probe({ spawnFn, timeoutMs: 20 });
    // Before resolution, simulate a late close - should not flip the already-settled result.
    setTimeout(() => proc.emit("close", 0), 40);
    expect(await p).toBe("failed");
  });

  it("probe returns 'ok' on exit code 0 and 'failed' on nonzero", async () => {
    expect(await probe({ spawnFn: makeCloseStub(0).spawnFn })).toBe("ok");
    expect(await probe({ spawnFn: makeCloseStub(255).spawnFn })).toBe("failed");
  });

  it("probe returns 'not-installed' on ENOENT from async error event", async () => {
    const err = Object.assign(new Error("spawn aws ENOENT"), { code: "ENOENT" });
    const { spawnFn } = makeErrorStub(err);
    expect(await probe({ spawnFn })).toBe("not-installed");
  });

  it("'not-installed' result does NOT prime the cache (next call re-probes)", async () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const first = makeErrorStub(err);
    expect(await ssoIsValid({ spawnFn: first.spawnFn })).toBe(true);
    expect(first.spawnFn).toHaveBeenCalledTimes(1);

    // If the user then installs aws and runs it, we should re-probe, not trust a stale cache.
    const second = makeCloseStub(1);
    expect(await ssoIsValid({ spawnFn: second.spawnFn })).toBe(false);
    expect(second.spawnFn).toHaveBeenCalledTimes(1);
  });
});

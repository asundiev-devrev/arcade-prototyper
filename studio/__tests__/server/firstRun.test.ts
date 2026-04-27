// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  ensureDeps,
  has,
  resetEnsureDepsCache,
  type SpawnFn,
} from "../../server/firstRun";

type FakeProc = EventEmitter & Pick<ChildProcess, "kill">;

/**
 * Build a fake `which` that emits `close(0)` when the requested command is
 * in `present` and `close(1)` otherwise. Mimics how real `which` behaves
 * on both macOS and Linux.
 */
function makeWhichSpawn(present: Set<string>): SpawnFn {
  return vi.fn((_cmd: string, args: readonly string[]) => {
    const proc = new EventEmitter() as FakeProc;
    proc.kill = vi.fn().mockReturnValue(true);
    const target = args[0];
    const code = present.has(target) ? 0 : 1;
    setTimeout(() => proc.emit("close", code), 0);
    return proc as unknown as ChildProcess;
  }) as unknown as SpawnFn;
}

describe("firstRun.ensureDeps", () => {
  beforeEach(() => {
    resetEnsureDepsCache();
  });

  it("reports ok when all deps are present (darwin)", async () => {
    const spawnFn = makeWhichSpawn(new Set(["brew", "node", "pnpm", "figmanage"]));
    const result = await ensureDeps({ spawnFn, platform: "darwin" });
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("reports pnpm missing when `which pnpm` fails", async () => {
    const spawnFn = makeWhichSpawn(new Set(["brew", "node", "figmanage"])); // no pnpm
    const result = await ensureDeps({ spawnFn, platform: "darwin" });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("pnpm");
  });

  it("reports figmanage missing when `which figmanage` fails", async () => {
    const spawnFn = makeWhichSpawn(new Set(["brew", "node", "pnpm"])); // no figmanage
    const result = await ensureDeps({ spawnFn, platform: "darwin" });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("figmanage");
  });

  it("does not check brew on non-darwin platforms", async () => {
    const spawnFn = makeWhichSpawn(new Set(["node", "pnpm", "figmanage"])); // no brew
    const result = await ensureDeps({ spawnFn, platform: "linux" });
    expect(result).toEqual({ ok: true, missing: [] });
    // Only node/pnpm/figmanage should have been probed — brew must not be
    // spawned at all on Linux.
    const calls = (spawnFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const probedCmds = calls.map((c: unknown[]) => (c[1] as string[])[0]);
    expect(probedCmds).not.toContain("brew");
    expect(probedCmds).toEqual(expect.arrayContaining(["node", "pnpm", "figmanage"]));
  });

  it("caches the result for 60s and skips re-probing on subsequent calls", async () => {
    const spawnFn = makeWhichSpawn(new Set(["brew", "node", "pnpm", "figmanage"]));
    let nowValue = 1_000_000;
    const now = () => nowValue;

    const first = await ensureDeps({ spawnFn, platform: "darwin", now });
    expect(first).toEqual({ ok: true, missing: [] });
    const callsAfterFirst = (spawnFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Advance less than 60s — must be a cache hit (no new spawns).
    nowValue += 30_000;
    const second = await ensureDeps({ spawnFn, platform: "darwin", now });
    expect(second).toEqual({ ok: true, missing: [] });
    expect((spawnFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    // Advance past 60s — cache expires, should re-probe.
    nowValue += 40_000;
    const third = await ensureDeps({ spawnFn, platform: "darwin", now });
    expect(third).toEqual({ ok: true, missing: [] });
    expect(
      (spawnFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsAfterFirst);
  });

  describe("has()", () => {
    it("returns false when the spawn itself throws synchronously", async () => {
      const spawnFn = vi.fn(() => {
        throw new Error("spawn failed");
      }) as unknown as SpawnFn;
      expect(await has("node", { spawnFn })).toBe(false);
    });

    it("returns false when the process emits an error (e.g. `which` missing)", async () => {
      const spawnFn = vi.fn(() => {
        const proc = new EventEmitter() as FakeProc;
        proc.kill = vi.fn().mockReturnValue(true);
        setTimeout(() => proc.emit("error", new Error("ENOENT")), 0);
        return proc as unknown as ChildProcess;
      }) as unknown as SpawnFn;
      expect(await has("node", { spawnFn })).toBe(false);
    });

    it("kills the process and returns false on timeout", async () => {
      const killed = vi.fn().mockReturnValue(true);
      const spawnFn = vi.fn(() => {
        const proc = new EventEmitter() as FakeProc;
        proc.kill = killed;
        // Never emits close/error — simulates a hang.
        return proc as unknown as ChildProcess;
      }) as unknown as SpawnFn;
      const result = await has("node", { spawnFn, timeoutMs: 20 });
      expect(result).toBe(false);
      expect(killed).toHaveBeenCalledWith("SIGKILL");
    });
  });
});

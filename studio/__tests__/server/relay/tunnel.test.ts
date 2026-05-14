import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => {
  const mock = { spawn: mockSpawn };
  return { ...mock, default: mock };
});

const { startTunnel, stopTunnel, __resetTunnelForTests } = await import(
  "../../../server/relay/tunnel"
);

type FakeProc = ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

function makeFakeProc(): FakeProc {
  const emitter = new EventEmitter() as unknown as FakeProc;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = vi.fn() as unknown as FakeProc["kill"];
  return emitter;
}

beforeEach(() => {
  mockSpawn.mockReset();
  __resetTunnelForTests();
});
afterEach(() => { __resetTunnelForTests(); });

describe("tunnel", () => {
  it("spawns cloudflared and parses the trycloudflare URL from stdout", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF +--------------------------------------------------------------------------------------------+\n",
    );
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n",
    );
    proc.stderr.write(
      "2026-05-13T10:00:00Z INF |  https://brave-squirrel-42.trycloudflare.com                                              |\n",
    );
    const url = await promise;
    expect(url).toBe("https://brave-squirrel-42.trycloudflare.com");
    expect(mockSpawn).toHaveBeenCalledWith(
      "cloudflared",
      ["tunnel", "--url", "http://localhost:5556"],
      expect.any(Object),
    );
  });

  it("rejects if cloudflared exits before emitting a URL", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    setTimeout(() => (proc as unknown as EventEmitter).emit("exit", 1), 0);
    await expect(promise).rejects.toThrow(/cloudflared exited/);
  });

  it("rejects with a clear message if spawn throws ENOENT synchronously", async () => {
    mockSpawn.mockImplementation(() => {
      const err: NodeJS.ErrnoException = new Error("spawn cloudflared ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    await expect(startTunnel({ port: 5556 })).rejects.toThrow(
      /cloudflared not found/,
    );
  });

  it("rejects cleanly when spawn emits an async ENOENT 'error' event (real macOS behavior)", async () => {
    // On macOS, spawn("cloudflared", …) for a missing binary does NOT throw
    // synchronously — it returns a ChildProcess, then emits 'error' on the
    // next tick. This was the bug: the returned proc had no error handler,
    // so the unhandled 'error' event crashed the entire Node process.
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    setTimeout(() => {
      const err: NodeJS.ErrnoException = new Error("spawn cloudflared ENOENT");
      err.code = "ENOENT";
      (proc as unknown as EventEmitter).emit("error", err);
    }, 0);
    await expect(promise).rejects.toThrow(/cloudflared not found/);
  });

  it("stopTunnel SIGTERMs the running proc and is idempotent", async () => {
    const proc = makeFakeProc();
    mockSpawn.mockReturnValue(proc);
    const promise = startTunnel({ port: 5556 });
    proc.stderr.write("https://bar.trycloudflare.com\n");
    await promise;
    stopTunnel();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    // A second call should not throw.
    stopTunnel();
  });
});

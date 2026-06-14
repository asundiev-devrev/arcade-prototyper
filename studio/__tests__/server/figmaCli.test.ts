import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

function mockSpawn(stdout: string, code = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutEmitter = new EventEmitter();
  (proc as any).stdout = stdoutEmitter;
  (proc as any).stderr = new EventEmitter();
  queueMicrotask(() => {
    stdoutEmitter.emit("data", Buffer.from(stdout));
    proc.emit("close", code);
  });
  return proc;
}

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => {
  const mock = { spawn: spawnMock };
  return { ...mock, default: mock };
});

describe("parseFigmaUrl", () => {
  it("extracts file id and node id from a Figma URL", async () => {
    const { parseFigmaUrl } = await import("../../server/figmaCli");
    const r = parseFigmaUrl("https://www.figma.com/design/AbC123/My-file?node-id=1038-14518");
    expect(r).toEqual({ fileId: "AbC123", nodeId: "1038:14518" });
  });
  it("returns null for non-Figma url", async () => {
    const { parseFigmaUrl } = await import("../../server/figmaCli");
    expect(parseFigmaUrl("https://example.com/x")).toBeNull();
  });
});

describe("figmaCli (figmanage bridge)", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it("figmaWhoami parses the plain-text output and returns the email", async () => {
    spawnMock.mockImplementation(
      () => mockSpawn("User:  Andrey Sundiev\nEmail: andrey@devrev.ai\nAuth:  PAT\n", 0) as any,
    );
    const { figmaWhoami } = await import("../../server/figmaCli");
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(true);
    expect(r.user?.email).toBe("andrey@devrev.ai");
    // figmanage whoami does NOT accept --json, so we must NOT pass it.
    // Regression guard: a prior bug had us sending --json, which caused
    // every whoami call to exit 1 ("error: unknown option '--json'"), so
    // the frontend saw authenticated:false even when the user was logged
    // in. Exit-code path then worked by accident on hosts where
    // figmanage happened to accept the flag, but not on others.
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["whoami"],
      expect.anything(),
    );
  });

  it("figmaWhoami returns authenticated true even when email parse fails", async () => {
    // Forward-compat: if a future figmanage version changes the output
    // format, we should still trust the exit code as the auth signal.
    spawnMock.mockImplementation(() => mockSpawn("some unknown format", 0) as any);
    const { figmaWhoami } = await import("../../server/figmaCli");
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(true);
    expect(r.user).toBeUndefined();
  });

  it("figmaWhoami returns authenticated false when figmanage whoami exits non-zero", async () => {
    spawnMock.mockImplementation(() => mockSpawn("not logged in", 1) as any);
    const { figmaWhoami } = await import("../../server/figmaCli");
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(false);
  });

  it("figmaWhoami returns authenticated false (not a rejection) when spawn fails", async () => {
    // Regression guard: previously `proc.on("error", reject)` rejected
    // the promise, which cascaded to a 500 response from the middleware,
    // which the frontend rendered as "Figma error — retry". That was
    // misleading for the genuine "figmanage is just not installed" case.
    // Now spawn errors resolve to code -1 and authenticated:false, so
    // the frontend shows "Connect Figma" and the server log explains
    // why.
    spawnMock.mockImplementation(() => {
      const proc = new EventEmitter() as ChildProcess;
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      queueMicrotask(() => proc.emit("error", new Error("spawn ENOENT")));
      return proc;
    });
    const { figmaWhoami } = await import("../../server/figmaCli");
    const r = await figmaWhoami();
    expect(r.authenticated).toBe(false);
  });

  it("getNode calls `figmanage reading get-nodes <fileKey> <nodeId> --json`", async () => {
    spawnMock.mockImplementation(() => mockSpawn(JSON.stringify({ name: "Button" }), 0) as any);
    const { getNode } = await import("../../server/figmaCli");
    const r = await getNode("FILEKEY", "1:2");
    expect(r).toEqual({ name: "Button" });
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["reading", "get-nodes", "FILEKEY", "1:2", "--json"],
      expect.anything(),
    );
  });

  it("nodeTree passes --depth when specified", async () => {
    spawnMock.mockImplementation(() => mockSpawn(JSON.stringify({ name: "root" }), 0) as any);
    const { nodeTree } = await import("../../server/figmaCli");
    await nodeTree("FILEKEY", "1:2", 4);
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["reading", "get-nodes", "FILEKEY", "1:2", "--depth", "4", "--json"],
      expect.anything(),
    );
  });

  it("getVariables calls `variables list-local` and hoists meta.variables", async () => {
    // Figma's /variables/local nests under `meta`; getVariables hoists it to a
    // flat `.variables`. The command MUST be `variables list-local` — the old
    // `reading get-variables` was not a real subcommand (silent null → tokens
    // never resolved, all colors fell back to hex).
    spawnMock.mockImplementation(() => mockSpawn(JSON.stringify({ meta: { variables: { x: { name: "t" } } } }), 0) as any);
    const { getVariables } = await import("../../server/figmaCli");
    const r = await getVariables("AbC123");
    expect(r).toEqual({ variables: { x: { name: "t" } } });
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["variables", "list-local", "AbC123", "--json"],
      expect.any(Object),
    );
  });

  it("getVariables also accepts an already-flat variables payload", async () => {
    spawnMock.mockImplementation(() => mockSpawn(JSON.stringify({ variables: { y: { name: "u" } } }), 0) as any);
    const { getVariables } = await import("../../server/figmaCli");
    expect(await getVariables("AbC123")).toEqual({ variables: { y: { name: "u" } } });
  });

  it("getVariables returns null when no variables present (e.g. non-Enterprise plan)", async () => {
    spawnMock.mockImplementation(() => mockSpawn(JSON.stringify({ error: "requires Figma Enterprise plan" }), 0) as any);
    const { getVariables } = await import("../../server/figmaCli");
    expect(await getVariables("AbC123")).toBeNull();
  });

  it("getVariables returns null on non-zero exit instead of throwing", async () => {
    spawnMock.mockImplementation(() => mockSpawn("boom", 2) as any);
    const { getVariables } = await import("../../server/figmaCli");
    expect(await getVariables("AbC123")).toBeNull();
  });
});

describe("runFigmanage timeout", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it("SIGTERMs the child and returns null (via getVariables) when figmanage hangs past its wall clock", async () => {
    // Root cause of 0.15.0 "Working… with no output" hangs: figmanage reads
    // (get-variables, get-styles, get-components, get-file) had no per-call
    // timeout. A stuck subprocess held the design-system sync forever —
    // which in turn held the chat turn. Every caller now inherits a
    // 30-second wall clock via runFigmanage. This test exercises the kill
    // path for getVariables; the other runFigmanage-backed calls share the
    // same implementation branch.
    vi.useFakeTimers();
    try {
      let killed = false;
      spawnMock.mockImplementation(() => {
        const proc = new EventEmitter() as ChildProcess;
        (proc as any).stdout = new EventEmitter();
        (proc as any).stderr = new EventEmitter();
        (proc as any).kill = (_sig?: string) => {
          killed = true;
          // Production: SIGTERM → close with 143. Simulate the close event
          // so runFigmanage's close handler runs (but settle() has already
          // been called by the timeout, so this is a no-op).
          queueMicrotask(() => proc.emit("close", 143));
          return true;
        };
        // Never emit anything on our own — the timer is the only exit.
        return proc;
      });
      const { getVariables } = await import("../../server/figmaCli");
      const pending = getVariables("fk");
      // Fast-forward past the 30s default timeout.
      await vi.advanceTimersByTimeAsync(31_000);
      const r = await pending;
      expect(killed).toBe(true);
      // getVariables returns null on any non-zero exit; timeout counts.
      expect(r).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("exportNodePng (array shape from figmanage)", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it("handles the array response shape and downloads the PNG", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const arrayReply = JSON.stringify([
      { node_id: "1448:43844", url: "https://example.invalid/img.png" },
    ]);
    spawnMock.mockImplementation(() => mockSpawn(arrayReply, 0) as any);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as any);
    try {
      const { exportNodePng } = await import("../../server/figmaCli");
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "figma-export-test-"));
      const out = path.join(tmp, "x.png");
      const result = await exportNodePng("AbC", "1448:43844", out, 2);
      expect(result).toBe(out);
      expect(fetchSpy).toHaveBeenCalledWith("https://example.invalid/img.png");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("getStyles", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it("returns parsed JSON when figmanage succeeds", async () => {
    const mockResponse = JSON.stringify({ styles: [{ node_id: "1:1", name: "bg/canvas" }] });
    spawnMock.mockImplementation(() => mockSpawn(mockResponse, 0) as any);
    const { getStyles } = await import("../../server/figmaCli");
    const out = await getStyles("fk");
    expect(Array.isArray(out?.styles)).toBe(true);
    expect(out.styles[0].name).toBe("bg/canvas");
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["components", "list-file-styles", "fk", "--json"],
      expect.anything(),
    );
  });

  it("returns null on non-zero exit (best-effort)", async () => {
    spawnMock.mockImplementation(() => mockSpawn("error", 1) as any);
    const { getStyles } = await import("../../server/figmaCli");
    const out = await getStyles("fk");
    expect(out).toBeNull();
  });
});

describe("getComponents", () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it("returns parsed JSON when figmanage succeeds", async () => {
    const mockResponse = JSON.stringify({ components: [{ node_id: "2:2", name: "Button/Primary" }] });
    spawnMock.mockImplementation(() => mockSpawn(mockResponse, 0) as any);
    const { getComponents } = await import("../../server/figmaCli");
    const out = await getComponents("fk");
    expect(Array.isArray(out?.components)).toBe(true);
    expect(out.components[0].name).toBe("Button/Primary");
    expect(spawnMock).toHaveBeenCalledWith(
      "figmanage",
      ["components", "list-file-components", "fk", "--json"],
      expect.anything(),
    );
  });

  it("returns null on non-zero exit", async () => {
    spawnMock.mockImplementation(() => mockSpawn("error", 1) as any);
    const { getComponents } = await import("../../server/figmaCli");
    const out = await getComponents("fk");
    expect(out).toBeNull();
  });
});

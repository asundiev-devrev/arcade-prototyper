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
});

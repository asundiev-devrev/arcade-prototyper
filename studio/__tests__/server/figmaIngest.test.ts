import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFigmaIngest } from "../../server/figmaIngest";
import type { IngestResult } from "../../server/figma/types";

function simpleNode() {
  return {
    id: "1:2", type: "FRAME", name: "Card",
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    children: [],
  };
}

function makeDeps(overrides: Partial<Parameters<typeof createFigmaIngest>[0]> = {}) {
  return {
    getNode: vi.fn().mockResolvedValue({ "1:2": { document: simpleNode() } }),
    getVariables: vi.fn().mockResolvedValue(null),
    exportPng: vi.fn().mockResolvedValue({ path: "/tmp/shot.png", widthPx: 1440, heightPx: 900 }),
    classify: vi.fn().mockResolvedValue({ composites: [], warnings: [] }),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe("figmaIngest", () => {
  it("composes sub-steps into an IngestResult", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const outcome = await ingest.ingest("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.source.fileKey).toBe("file");
    expect(outcome.tree.id).toBe("0");
    expect(deps.getNode).toHaveBeenCalledTimes(1);
    expect(deps.classify).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent ingest calls for the same key", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const url = "https://figma.com/design/file?node-id=1-2";
    const [a, b] = await Promise.all([
      ingest.ingest("file", "1:2", url),
      ingest.ingest("file", "1:2", url),
    ]);
    expect(a).toStrictEqual(b);
    expect(deps.getNode).toHaveBeenCalledTimes(1);
  });

  it("serves hits from the cache without re-fetching", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    await ingest.ingest("file", "1:2", url);
    await ingest.ingest("file", "1:2", url);
    expect(deps.getNode).toHaveBeenCalledTimes(1);
  });

  it("returns a failure outcome if figmanage getNode throws", async () => {
    const deps = makeDeps({ getNode: vi.fn().mockRejectedValue(new Error("not found")) });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const outcome = await ingest.ingest("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    expect(outcome.ok).toBe(false);
  });

  it("getPhase1Pending returns an in-flight phase-1 promise", async () => {
    let resolveFn!: (v: any) => void;
    const deps = makeDeps({
      getNode: vi.fn().mockImplementation(() => new Promise((r) => { resolveFn = r; })),
    });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    const p = ingest.ingestPhase1("file", "1:2", url);
    const pending = ingest.getPhase1Pending("file", "1:2");
    expect(pending).toBeDefined();
    resolveFn({ "1:2": { document: simpleNode() } });
    await p;
  });
});

describe("figmaIngest (phase split)", () => {
  it("ingestPhase1 returns before the classifier runs", async () => {
    let resolveClassify!: (v: any) => void;
    const classify = vi.fn().mockImplementation(() =>
      new Promise((r) => { resolveClassify = r; }),
    );
    const deps = makeDeps({ classify });
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const phase1 = await ingest.ingestPhase1(
      "file", "1:2", "https://figma.com/design/file?node-id=1-2",
    );
    if (!phase1.ok) throw new Error(`expected ok, got ${phase1.reason}`);
    expect(phase1.composites).toEqual([]);
    expect(classify).toHaveBeenCalledTimes(1); // kicked off in background
    // Let phase 2 resolve so the test doesn't leak an unresolved promise.
    resolveClassify({ composites: [], warnings: [] });
  });

  it("phase 2 upgrades the cached entry with composites", async () => {
    const classify = vi.fn().mockResolvedValue({
      composites: [{ composite: "AppShell", path: "0", confidence: "high", reason: "chrome" }],
      warnings: [],
    });
    const deps = makeDeps({ classify });
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    // `ingest` awaits both phases — by the time it resolves, composites must be present.
    const outcome = await ingest.ingest("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    expect(outcome.composites).toHaveLength(1);
    expect(outcome.composites[0].composite).toBe("AppShell");

    const cached = ingest.getCached("file", "1:2");
    expect(cached?.composites).toHaveLength(1);
  });

  it("ingestPhase1 hits the cache and skips re-fetch after phase 1 completes", async () => {
    const deps = makeDeps();
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    await ingest.ingestPhase1("file", "1:2", url);
    await ingest.ingestPhase1("file", "1:2", url);
    expect(deps.getNode).toHaveBeenCalledTimes(1);
  });

  it("does not start phase 2 when the composite catalog is empty", async () => {
    const classify = vi.fn();
    const deps = makeDeps({ classify });
    const ingest = createFigmaIngest(deps, { composites: [] });
    await ingest.ingestPhase1(
      "file", "1:2", "https://figma.com/design/file?node-id=1-2",
    );
    // Give any chained phase-2 promise a microtask window to run — shouldn't fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(classify).not.toHaveBeenCalled();
  });
});

describe("figmaIngest (parallel phase-1 fetch)", () => {
  it("runs getVariables and exportPng concurrently, not serially", async () => {
    const order: string[] = [];
    let varsResolve!: () => void;
    const getVariables = vi.fn().mockImplementation(() => {
      order.push("vars:start");
      return new Promise((r) => { varsResolve = () => { order.push("vars:end"); r(null); }; });
    });
    const exportPng = vi.fn().mockImplementation(() => {
      order.push("png:start");
      return Promise.resolve({ path: "/tmp/shot.png", widthPx: 1, heightPx: 1 });
    });
    const deps = makeDeps({ getVariables, exportPng });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const p = ingest.ingestPhase1("file", "1:2", "https://figma.com/design/file?node-id=1-2");
    // Both must have STARTED before vars resolves — proves they overlap.
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toContain("vars:start");
    expect(order).toContain("png:start");
    varsResolve();
    await p;
  });
});

describe("figmaIngest (disk persistence)", () => {
  it("hydrates from disk in a fresh instance (survives a restart)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const diskDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-ingest-disk-"));
    const url = "https://figma.com/design/file?node-id=1-2";

    // First instance: real PNG file on disk so the existence guard passes.
    const pngPath = path.join(diskDir, "shot.png");
    fs.writeFileSync(pngPath, "x");
    const deps1 = makeDeps({ exportPng: vi.fn().mockResolvedValue({ path: pngPath, widthPx: 1, heightPx: 1 }) });
    const ingest1 = createFigmaIngest(deps1, { composites: [], diskDir });
    await ingest1.ingest("file", "1:2", url);
    // Let the fire-and-forget disk write settle.
    await new Promise((r) => setTimeout(r, 20));

    // Fresh instance with an EMPTY in-memory cache but the same diskDir.
    const deps2 = makeDeps();
    const ingest2 = createFigmaIngest(deps2, { composites: [], diskDir });
    const hit = ingest2.getCached("file", "1:2");
    expect(hit).toBeDefined();
    expect(hit?.png?.path).toBe(pngPath);
    // The fresh instance must NOT have called figmanage — it read from disk.
    expect(deps2.getNode).not.toHaveBeenCalled();

    fs.rmSync(diskDir, { recursive: true, force: true });
  });

  it("ignores a disk entry whose PNG file is gone", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const diskDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-ingest-disk-"));
    const url = "https://figma.com/design/file?node-id=1-2";
    const pngPath = path.join(diskDir, "gone.png");
    fs.writeFileSync(pngPath, "x");
    const deps1 = makeDeps({ exportPng: vi.fn().mockResolvedValue({ path: pngPath, widthPx: 1, heightPx: 1 }) });
    const ingest1 = createFigmaIngest(deps1, { composites: [], diskDir });
    await ingest1.ingest("file", "1:2", url);
    await new Promise((r) => setTimeout(r, 20));
    fs.rmSync(pngPath, { force: true }); // PNG export deleted out from under us

    const deps2 = makeDeps();
    const ingest2 = createFigmaIngest(deps2, { composites: [], diskDir });
    const hit = ingest2.getCached("file", "1:2");
    expect(hit).toBeDefined();
    expect(hit?.png).toBeNull(); // dead path dropped, not handed to the agent

    fs.rmSync(diskDir, { recursive: true, force: true });
  });
});

describe("figmaIngest (real figmanage shape)", () => {
  it("unwraps { nodes: { <id>: { document } } } and produces a usable tree", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wrapperFixture = JSON.parse(fs.readFileSync(
      path.resolve(__dirname, "../fixtures/figma/figmanage-wrapper.json"), "utf-8"));

    const deps = {
      getNode: vi.fn().mockResolvedValue(wrapperFixture),
      getVariables: vi.fn().mockResolvedValue(null),
      exportPng: vi.fn().mockResolvedValue(null),
      classify: vi.fn().mockResolvedValue({ composites: [], warnings: [] }),
      now: () => 1_000_000,
    };
    const ingest = createFigmaIngest(deps, { composites: ["AppShell"] });
    const outcome = await ingest.ingest(
      "dHEyK3XWnLEWbTBmF7crQ8", "1448:43844",
      "https://www.figma.com/design/dHEyK3XWnLEWbTBmF7crQ8/x?node-id=1448-43844",
    );

    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
    // The tree should NOT be the empty fallback — it should have the vertical
    // layout and one child from our fixture.
    expect(outcome.tree.layout?.direction).toBe("col");
    expect(outcome.tree.children).toBeDefined();
    expect(outcome.tree.children!.length).toBeGreaterThan(0);
    expect(outcome.diagnostics.warnings).not.toContain("root node was empty");
  });
});

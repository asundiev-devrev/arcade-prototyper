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

  it("getPending returns an in-flight promise", async () => {
    let resolveFn!: (v: any) => void;
    const deps = makeDeps({
      getNode: vi.fn().mockImplementation(() => new Promise((r) => { resolveFn = r; })),
    });
    const ingest = createFigmaIngest(deps, { composites: [] });
    const url = "https://figma.com/design/file?node-id=1-2";
    const p = ingest.ingest("file", "1:2", url);
    const pending = ingest.getPending("file", "1:2");
    expect(pending).toBeDefined();
    resolveFn({ "1:2": { document: simpleNode() } });
    await p;
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runFigmaKitEmitBranch,
  assetFileName,
  pickNodeEntry,
  assetCacheVersion,
  assetCacheDir,
  formatCoverage,
} from "../../../server/figma/kitEmitBranch";

vi.mock("../../../server/paths", () => ({
  frameDir: (slug: string, frame: string) =>
    path.join(tmpRoot, slug, "frames", frame),
  // Point the ingest/asset-cache scratch root at the per-test tmp dir so the
  // real ~/Library scratch dir is never touched and the standalone raw reader
  // (readPrefetchedRawNode) sees an empty dir → clean miss → live fetch.
  figmaIngestRoot: () => path.join(tmpRoot, ".figma-ingest"),
}));
vi.mock("../../../server/projects", () => ({
  appendHistory: vi.fn(async () => {}),
  nextFramePrefix: () => "01",
}));

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "kitemit-"));
});
afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const bbox = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h });

function payload() {
  return {
    nodes: {
      "1:1": {
        document: {
          id: "1:1", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
          children: [
            { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
          ],
        },
        components: {},
        componentSets: {},
      },
    },
  };
}

/** Same as payload() but carries a top-level lastModified so the A2 asset
 *  cache is enabled (without one, the cache is disabled by design). */
function versionedPayload(lastModified = "2026-06-14T00:00:00Z") {
  return { ...payload(), lastModified };
}

function makeDeps(overrides: any = {}) {
  return {
    getNode: vi.fn(async () => payload()),
    // Inject a no-variables stub so tests stay hermetic — without it the branch
    // would fall through to the real figmanage getVariables subprocess.
    getVariables: vi.fn(async () => null),
    exportUrls: vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    ),
    download: vi.fn(async () => Buffer.from("<svg/>")),
    ...overrides,
  };
}

function makeInput(deps: any) {
  const events: any[] = [];
  return {
    input: {
      emit: (ev: any) => events.push(ev),
      slug: "proj",
      fileKey: "FILE",
      nodeId: "1:1",
      project: { frames: [] },
      signal: new AbortController().signal,
      deps,
    },
    events,
  };
}

describe("assetFileName", () => {
  it("sanitizes : and ; out of node ids", () => {
    expect(assetFileName("I10:3299;9:20400", "svg")).toBe("I10-3299_9-20400.svg");
  });
});

describe("pickNodeEntry", () => {
  it("reads the figmanage nodes wrapper", () => {
    const e = pickNodeEntry(payload(), "1:1");
    expect(e?.document.id).toBe("1:1");
  });
  it("tolerates dash-form node ids", () => {
    const e = pickNodeEntry(payload(), "1-1" as any);
    expect(e?.document.id).toBe("1:1");
  });
  it("returns null for junk", () => {
    expect(pickNodeEntry({}, "1:1")).toBeNull();
    expect(pickNodeEntry(null, "1:1")).toBeNull();
  });
});

describe("runFigmaKitEmitBranch", () => {
  it("writes index.tsx + assets and reports ok", async () => {
    const deps = makeDeps();
    const { input, events } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);

    const fdir = path.join(tmpRoot, "proj", "frames", "01-figma-1-1");
    const src = await fs.readFile(path.join(fdir, "index.tsx"), "utf-8");
    expect(src).toContain("export default function FigmaImport");
    expect(src).toContain('import a_v1 from "./assets/v1.svg";');
    await expect(fs.access(path.join(fdir, "assets", "v1.svg"))).resolves.toBeUndefined();

    const narrations = events.filter((e) => e.kind === "narration").map((e) => e.text);
    expect(narrations.some((t: string) => t.includes("Importing the Figma design"))).toBe(true);
  });

  it("re-plans past nodes whose export URL is null (broken)", async () => {
    const doc = {
      nodes: {
        "1:1": {
          document: {
            id: "1:1", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
            children: [{
              id: "g1", type: "GROUP", absoluteBoundingBox: bbox(0, 0, 16, 16),
              children: [
                { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 8, 8) },
                { id: "v2", type: "VECTOR", absoluteBoundingBox: bbox(8, 8, 8, 8) },
              ],
            }],
          },
          components: {}, componentSets: {},
        },
      },
    };
    const deps = makeDeps({
      getNode: vi.fn(async () => doc),
      exportUrls: vi.fn(async (_f: string, ids: string[]) =>
        ids.map((nodeId) => ({
          nodeId,
          url: nodeId === "g1" ? null : `https://cdn/${nodeId}`,
        })),
      ),
    });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    const fdir = path.join(tmpRoot, "proj", "frames", "01-figma-1-1");
    const src = await fs.readFile(path.join(fdir, "index.tsx"), "utf-8");
    expect(src).toContain("v1.svg");
    expect(src).toContain("v2.svg");
  });

  it("fails honestly when figmanage can't read the file", async () => {
    const deps = makeDeps({
      getNode: vi.fn(async () => { throw new Error("PAT expired"); }),
    });
    const { input, events } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("PAT expired");
    const narrations = events.filter((e) => e.kind === "narration").map((e) => e.text);
    expect(narrations.some((t: string) => t.includes("Couldn't read the Figma file"))).toBe(true);
  });

  it("survives individual asset download failures (degrades, still ok)", async () => {
    const deps = makeDeps({
      download: vi.fn(async () => { throw new Error("403"); }),
    });
    const { input, events } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    const narrations = events.filter((e) => e.kind === "narration").map((e) => e.text);
    expect(narrations.some((t: string) => t.includes("couldn't be downloaded"))).toBe(true);
  });

  it("fetches variables and emits a kit token for a bound fill (B1)", async () => {
    // A frame whose background fill is bound to a Figma variable that maps to a
    // real kit token (--bg-neutral-soft). The branch must fetch getVariables and
    // pass it into the emitter, which then emits var(--bg-neutral-soft).
    const boundDoc = {
      nodes: {
        "1:1": {
          document: {
            id: "1:1", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
            children: [{
              id: "panel", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
              fills: [{
                type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                boundVariables: { color: { id: "VariableID:bgsoft" } },
              }],
              children: [],
            }],
          },
          components: {}, componentSets: {},
        },
      },
    };
    const getVariables = vi.fn(async () => ({
      variables: { "VariableID:bgsoft": { name: "bg/neutral/soft" } },
    }));
    const deps = makeDeps({
      getNode: vi.fn(async () => boundDoc),
      getVariables,
    });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    expect(getVariables).toHaveBeenCalledWith("FILE");

    const fdir = path.join(tmpRoot, "proj", "frames", "01-figma-1-1");
    const src = await fs.readFile(path.join(fdir, "index.tsx"), "utf-8");
    expect(src).toContain("var(--bg-neutral-soft)");
    expect(src).not.toContain("#1a1a1a"); // the baked hex was replaced by the token
  });

  it("emits raw hex (not a wrong color) when getVariables returns null", async () => {
    // figmanage variable fetch failed (null) → token resolution off → the
    // bound fill keeps its honest baked hex; the turn still succeeds.
    const boundDoc = {
      nodes: {
        "1:1": {
          document: {
            id: "1:1", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
            children: [{
              id: "panel", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 200, 100),
              fills: [{
                type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                boundVariables: { color: { id: "VariableID:bgsoft" } },
              }],
              children: [],
            }],
          },
          components: {}, componentSets: {},
        },
      },
    };
    const deps = makeDeps({
      getNode: vi.fn(async () => boundDoc),
      getVariables: vi.fn(async () => null),
    });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    const fdir = path.join(tmpRoot, "proj", "frames", "01-figma-1-1");
    const src = await fs.readFile(path.join(fdir, "index.tsx"), "utf-8");
    expect(src).not.toContain("var(--");
    expect(src).toContain("#1a1a1a");
  });

  it("does not fail the turn when getVariables throws", async () => {
    // A thrown getVariables must be swallowed (best-effort), not crash the turn.
    const deps = makeDeps({
      getVariables: vi.fn(async () => { throw new Error("variables boom"); }),
    });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
  });

  it("respects the abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const deps = makeDeps();
    const { input } = makeInput(deps);
    (input as any).signal = ac.signal;
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("cancelled");
  });
});

describe("formatCoverage (C3)", () => {
  it("renders matched/total + pct and the top unmatched sets by count", () => {
    const line = formatCoverage({
      totalInstances: 10,
      matchedInstances: 4,
      unmatchedSets: { Cell: 3, Row: 2, Footer: 1 },
    });
    expect(line).toBe(
      "4/10 instances are real kit components (40%) — top unmatched: Cell ×3, Row ×2, Footer ×1",
    );
  });

  it("caps the backlog list at topN, highest count first", () => {
    const line = formatCoverage(
      {
        totalInstances: 20,
        matchedInstances: 0,
        unmatchedSets: { A: 1, B: 5, C: 4, D: 3, E: 2, F: 6 },
      },
      3,
    );
    // F(6), B(5), C(4) — only the top 3 by count.
    expect(line).toContain("top unmatched: F ×6, B ×5, C ×4");
    expect(line).not.toContain("D ×");
    expect(line).not.toContain("E ×");
  });

  it("handles a fully-matched import (no backlog) and avoids divide-by-zero", () => {
    expect(formatCoverage({ totalInstances: 3, matchedInstances: 3, unmatchedSets: {} }))
      .toBe("3/3 instances are real kit components (100%)");
    // Zero instances → 0% rather than NaN.
    expect(formatCoverage({ totalInstances: 0, matchedInstances: 0, unmatchedSets: {} }))
      .toBe("0/0 instances are real kit components (0%)");
  });
});

describe("assetCacheVersion", () => {
  it("prefers lastModified", () => {
    expect(assetCacheVersion({ lastModified: "X", version: "1" })).toBe("X");
  });
  it("falls back to version (string or number)", () => {
    expect(assetCacheVersion({ version: "42" })).toBe("42");
    expect(assetCacheVersion({ version: 42 })).toBe("42");
  });
  it("returns null when neither is present (disables the cache)", () => {
    expect(assetCacheVersion({})).toBeNull();
    expect(assetCacheVersion({ lastModified: "" })).toBeNull();
    expect(assetCacheVersion(null)).toBeNull();
  });
});

describe("assetCacheDir", () => {
  it("namespaces by fileKey and version, sanitizing both", () => {
    const d = assetCacheDir("/root", "FILE", "2026-06-14T00:00:00Z");
    expect(d).toBe(path.join("/root", "asset-cache", "FILE", "2026-06-14T00_00_00Z"));
  });
  it("returns null with no version (cache disabled)", () => {
    expect(assetCacheDir("/root", "FILE", null)).toBeNull();
  });
  it("puts a different version in a different folder (invalidation)", () => {
    const a = assetCacheDir("/root", "FILE", "v1");
    const b = assetCacheDir("/root", "FILE", "v2");
    expect(a).not.toBe(b);
  });
});

describe("runFigmaKitEmitBranch — A1 prefetch reuse", () => {
  it("uses an injected getRaw HIT and skips the live getNode entirely", async () => {
    const getNode = vi.fn(async () => payload());
    const getRaw = vi.fn(() => payload()); // prefetched dict present
    const deps = makeDeps({ getNode, getRaw });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    // The whole point: the ~2s figmanage round-trip is NOT paid.
    expect(getRaw).toHaveBeenCalledWith("FILE", "1:1");
    expect(getNode).not.toHaveBeenCalled();
    // Frame still written correctly from the cached dict.
    const fdir = path.join(tmpRoot, "proj", "frames", "01-figma-1-1");
    const src = await fs.readFile(path.join(fdir, "index.tsx"), "utf-8");
    expect(src).toContain("export default function FigmaImport");
  });

  it("falls through to the live getNode on a getRaw MISS", async () => {
    const getNode = vi.fn(async () => payload());
    const getRaw = vi.fn(() => undefined); // nothing prefetched
    const deps = makeDeps({ getNode, getRaw });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    expect(getNode).toHaveBeenCalledTimes(1);
  });

  it("falls through to the live getNode when the prefetched dict lacks the node (stale/corrupt)", async () => {
    const getNode = vi.fn(async () => payload());
    // Prefetched dict has MULTIPLE nodes, none of them "1:1" — pickNodeEntry
    // can't resolve the requested node (the single-key fallback doesn't apply),
    // so the branch must fall through to a live fetch rather than error.
    const getRaw = vi.fn(() => ({
      nodes: {
        "9:9": { document: { id: "9:9", type: "FRAME" } },
        "8:8": { document: { id: "8:8", type: "FRAME" } },
      },
    }));
    const deps = makeDeps({ getNode, getRaw });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    // The cache could not satisfy the node → live fetch ran, no error.
    expect(getNode).toHaveBeenCalledTimes(1);
  });
});

describe("runFigmaKitEmitBranch — A2 asset cache", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "kitemit-cache-"));
  });
  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("cold import populates the cache; second import HITS it (no export, no download)", async () => {
    // Cold import: versioned payload enables the cache.
    const exportUrls1 = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const download1 = vi.fn(async () => Buffer.from("<svg>real</svg>"));
    const deps1 = makeDeps({
      getNode: vi.fn(async () => versionedPayload()),
      exportUrls: exportUrls1,
      download: download1,
      cacheDir,
    });
    const { input: input1 } = makeInput(deps1);
    const r1 = await runFigmaKitEmitBranch(input1 as any);
    expect(r1.ok).toBe(true);
    expect(exportUrls1).toHaveBeenCalled();
    expect(download1).toHaveBeenCalled();

    // The cache folder for this fileKey+version now holds the asset bytes.
    const verDir = assetCacheDir(cacheDir, "FILE", "2026-06-14T00:00:00Z")!;
    const cached = await fs.readFile(path.join(verDir, "v1.svg"), "utf-8");
    expect(cached).toBe("<svg>real</svg>");

    // Second import (new project so a fresh frame dir), SAME version.
    const exportUrls2 = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const download2 = vi.fn(async () => Buffer.from("SHOULD-NOT-BE-CALLED"));
    const deps2 = makeDeps({
      getNode: vi.fn(async () => versionedPayload()),
      exportUrls: exportUrls2,
      download: download2,
      cacheDir,
    });
    const { input: input2 } = makeInput(deps2);
    (input2 as any).slug = "proj2";
    const r2 = await runFigmaKitEmitBranch(input2 as any);
    expect(r2.ok).toBe(true);
    // The HIT: neither Figma export nor download were called.
    expect(exportUrls2).not.toHaveBeenCalled();
    expect(download2).not.toHaveBeenCalled();

    // Fidelity guard: the cached bytes were copied into the new frame verbatim.
    const fdir2 = path.join(tmpRoot, "proj2", "frames", "01-figma-1-1");
    const copied = await fs.readFile(path.join(fdir2, "assets", "v1.svg"), "utf-8");
    expect(copied).toBe("<svg>real</svg>");
    // And the emitted index.tsx still references the asset.
    const src2 = await fs.readFile(path.join(fdir2, "index.tsx"), "utf-8");
    expect(src2).toContain('import a_v1 from "./assets/v1.svg";');
  });

  it("does NOT cache when the payload carries no version token (export every time)", async () => {
    // payload() has no lastModified/version → cache disabled.
    const exportUrls1 = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const deps1 = makeDeps({ exportUrls: exportUrls1, cacheDir });
    const { input: input1 } = makeInput(deps1);
    await runFigmaKitEmitBranch(input1 as any);
    expect(exportUrls1).toHaveBeenCalled();

    // No asset-cache folder should have been created.
    await expect(fs.access(path.join(cacheDir, "asset-cache"))).rejects.toBeTruthy();

    // Second import with no version → exports again (no hit possible).
    const exportUrls2 = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const deps2 = makeDeps({ exportUrls: exportUrls2, cacheDir });
    const { input: input2 } = makeInput(deps2);
    (input2 as any).slug = "proj2";
    await runFigmaKitEmitBranch(input2 as any);
    expect(exportUrls2).toHaveBeenCalled();
  });

  it("re-exports when the file version changes (invalidation is a new folder)", async () => {
    // First import at version A.
    const deps1 = makeDeps({
      getNode: vi.fn(async () => versionedPayload("A")),
      cacheDir,
    });
    const { input: input1 } = makeInput(deps1);
    await runFigmaKitEmitBranch(input1 as any);

    // Second import at version B — different folder → cache MISS → re-export.
    const exportUrls2 = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const download2 = vi.fn(async () => Buffer.from("<svg>v2</svg>"));
    const deps2 = makeDeps({
      getNode: vi.fn(async () => versionedPayload("B")),
      exportUrls: exportUrls2,
      download: download2,
      cacheDir,
    });
    const { input: input2 } = makeInput(deps2);
    (input2 as any).slug = "proj2";
    await runFigmaKitEmitBranch(input2 as any);
    // Edited file = fresh export, never a stale cached asset.
    expect(exportUrls2).toHaveBeenCalled();
    expect(download2).toHaveBeenCalled();
  });

  it("ignores an empty/corrupt cache file and re-exports", async () => {
    // Seed the version cache with a zero-byte (corrupt) file.
    const verDir = assetCacheDir(cacheDir, "FILE", "2026-06-14T00:00:00Z")!;
    await fs.mkdir(verDir, { recursive: true });
    await fs.writeFile(path.join(verDir, "v1.svg"), "");

    const exportUrls = vi.fn(async (_f: string, ids: string[]) =>
      ids.map((nodeId) => ({ nodeId, url: `https://cdn/${nodeId}` })),
    );
    const download = vi.fn(async () => Buffer.from("<svg>fresh</svg>"));
    const deps = makeDeps({
      getNode: vi.fn(async () => versionedPayload()),
      exportUrls,
      download,
      cacheDir,
    });
    const { input } = makeInput(deps);
    const r = await runFigmaKitEmitBranch(input as any);
    expect(r.ok).toBe(true);
    // The empty file was NOT trusted — a fresh export ran.
    expect(exportUrls).toHaveBeenCalled();
    expect(download).toHaveBeenCalled();
    // And the corrupt entry got overwritten with the real bytes.
    const fixed = await fs.readFile(path.join(verDir, "v1.svg"), "utf-8");
    expect(fixed).toBe("<svg>fresh</svg>");
  });
});

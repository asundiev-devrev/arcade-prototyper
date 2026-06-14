import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runFigmaKitEmitBranch,
  assetFileName,
  pickNodeEntry,
} from "../../../server/figma/kitEmitBranch";

vi.mock("../../../server/paths", () => ({
  frameDir: (slug: string, frame: string) =>
    path.join(tmpRoot, slug, "frames", frame),
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

function makeDeps(overrides: any = {}) {
  return {
    getNode: vi.fn(async () => payload()),
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

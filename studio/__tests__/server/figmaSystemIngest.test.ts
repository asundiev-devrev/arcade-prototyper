import { describe, it, expect, vi } from "vitest";
import { createFigmaSystemIngest } from "../../server/figmaSystemIngest";
import type { SynthesizedSections } from "../../server/figma/types";
import type { SystemSources } from "../../server/figma/systemSources";

function dummySections(): SynthesizedSections {
  return {
    identity: "i",
    colors: { entries: [], warnings: [] },
    typography: { entries: [], warnings: [] },
    spacing: { scale: [] },
    radii: { scale: [] },
    shadows: { items: [] },
    components: [],
    warnings: [],
  };
}

function dummySources(): SystemSources {
  return {
    styles: { paint: [], text: [], effect: [] },
    variables: { color: [], number: [] },
    components: [],
    sampleFrames: [],
    warnings: [],
  };
}

function makeDeps(overrides: any = {}) {
  let t = 1_000_000;
  return {
    fetchSources: vi.fn().mockResolvedValue(dummySources()),
    synthesize: vi.fn().mockResolvedValue(dummySections()),
    now: () => t,
    advance: (ms: number) => { t += ms; },
    ...overrides,
  };
}

describe("createFigmaSystemIngest", () => {
  it("returns ok outcome with synthesized sections on first call", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    const out = await ing.ingest("fk");
    if (!out.ok) throw new Error(`expected ok, got ${out.reason}`);
    expect(out.source.fileKey).toBe("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
    expect(deps.synthesize).toHaveBeenCalledTimes(1);
  });

  it("serves cache hits without re-fetching", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    await ing.ingest("fk");
    await ing.ingest("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent calls via pending promise", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps);
    const [a, b] = await Promise.all([ing.ingest("fk"), ing.ingest("fk")]);
    expect(deps.fetchSources).toHaveBeenCalledTimes(1);
    expect(a).toStrictEqual(b);
  });

  it("expires cache after TTL", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps, { ttlMs: 1000 });
    await ing.ingest("fk");
    deps.advance(1500);
    await ing.ingest("fk");
    expect(deps.fetchSources).toHaveBeenCalledTimes(2);
  });

  it("caches negative results for shorter TTL", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(dummySources());
    const deps = makeDeps({ fetchSources: fetch });
    const ing = createFigmaSystemIngest(deps, { ttlMs: 60_000, negativeTtlMs: 5000 });
    const first = await ing.ingest("fk");
    expect(first.ok).toBe(false);
    // Before negative TTL expires, same failure is served from cache
    const second = await ing.ingest("fk");
    expect(second.ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    // After negative TTL, retry happens
    deps.advance(6000);
    const third = await ing.ingest("fk");
    expect(third.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("LRU-evicts when over capacity", async () => {
    const deps = makeDeps();
    const ing = createFigmaSystemIngest(deps, { capacity: 2 });
    await ing.ingest("a");
    await ing.ingest("b");
    await ing.ingest("c"); // evicts "a"
    expect(ing.getCached("a")).toBeUndefined();
    expect(ing.getCached("b")).toBeDefined();
    expect(ing.getCached("c")).toBeDefined();
  });

  it("returns failure outcome when synthesize throws", async () => {
    const synth = vi.fn().mockRejectedValue(new Error("bad schema"));
    const deps = makeDeps({ synthesize: synth });
    const ing = createFigmaSystemIngest(deps);
    const out = await ing.ingest("fk");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/bad schema/);
  });
});

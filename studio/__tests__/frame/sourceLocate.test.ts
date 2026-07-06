import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseMappings,
  originalPositionFor,
  toSourcePosition,
  mapUrlFor,
} from "../../src/frame/sourceLocate";

/**
 * Ground-truth map (v3). Encodes, for a hypothetical transformed file:
 *   generated line 1 col 0  → source line 1 col 0
 *   generated line 3 col 2  → source line 1 col 10   (JSX expanded across lines)
 *   generated line 4 col 4  → source line 2 col 0
 * Built by hand with known VLQ so the decoder is checked against exact values.
 *
 * VLQ quick-encode of the segments (base64-VLQ, sign in low bit):
 *   line1: [0,0,0,0]      → "AAAA"
 *   line2: (empty)
 *   line3: [2,0,0,10]     → genCol 2, srcFile 0, srcLine +0, srcCol +10 → "EAAU"
 *   line4: [4,0,1,-10]    → genCol 4, srcFile 0, srcLine +1, srcCol -10 → "IACV"
 *   (-10 encodes as (10<<1)|1 = 21 = base64 'V')
 */
const MAP_MAPPINGS = "AAAA;;EAAU;IACV";

describe("parseMappings", () => {
  it("decodes per-line segments with delta accumulation", () => {
    const perLine = parseMappings(MAP_MAPPINGS);
    expect(perLine.length).toBe(4);
    // line 1
    expect(perLine[0]).toEqual([{ genColumn: 0, srcLine: 0, srcColumn: 0 }]);
    // line 2 empty
    expect(perLine[1]).toEqual([]);
    // line 3: srcCol accumulated 0 + 10
    expect(perLine[2]).toEqual([{ genColumn: 2, srcLine: 0, srcColumn: 10 }]);
    // line 4: srcLine 0 + 1, srcCol 10 - 10 = 0
    expect(perLine[3]).toEqual([{ genColumn: 4, srcLine: 1, srcColumn: 0 }]);
  });
});

describe("originalPositionFor", () => {
  const perLine = parseMappings(MAP_MAPPINGS);

  it("maps an exact generated position to source (1-based in/out)", () => {
    // generated line 4 col 5 (1-based) → segment genCol 4 (0-based) → src line 2 col 1
    expect(originalPositionFor(perLine, 4, 5)).toEqual({ line: 2, column: 1 });
  });

  it("maps line 3 to the expanded source column", () => {
    // generated line 3 col 3 (1-based, col0=2) → src line 1 col 11
    expect(originalPositionFor(perLine, 3, 3)).toEqual({ line: 1, column: 11 });
  });

  it("falls back to the nearest preceding mapped line when a line has no segments", () => {
    // generated line 2 has no segments → walk up to line 1's mapping.
    expect(originalPositionFor(perLine, 2, 1)).toEqual({ line: 1, column: 1 });
  });

  it("returns null when nothing precedes (no mapping at all)", () => {
    expect(originalPositionFor([[], []], 2, 1)).toBeNull();
  });
});

describe("mapUrlFor", () => {
  it("inserts .map BEFORE the query (Vite 500s on query-then-.map)", () => {
    // The exact bug this guards: `index.tsx?t=123.map` fails; `.map?t=123` works.
    expect(mapUrlFor("/@fs/x/index.tsx?t=123")).toBe("/@fs/x/index.tsx.map?t=123");
  });
  it("handles a URL with no query", () => {
    expect(mapUrlFor("/@fs/x/index.tsx")).toBe("/@fs/x/index.tsx.map");
  });
  it("preserves origin on an absolute URL", () => {
    expect(mapUrlFor("http://localhost:5556/@fs/x/index.tsx?v=abc"))
      .toBe("http://localhost:5556/@fs/x/index.tsx.map?v=abc");
  });
});

describe("toSourcePosition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches <moduleUrl>.map and translates the coordinate", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // .map goes BEFORE the query.
      expect(url).toBe("http://host/frames/x/index.tsx.map?v=1");
      return {
        ok: true,
        json: async () => ({ version: 3, sources: ["index.tsx"], mappings: MAP_MAPPINGS }),
      } as any;
    });
    vi.stubGlobal("fetch", fetchMock);
    // generated line 4 col 5 → source line 2 col 1
    const pos = await toSourcePosition("http://host/frames/x/index.tsx?v=1", 4, 5);
    expect(pos).toEqual({ line: 2, column: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the input coords unchanged when the map fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as any));
    // Use a distinct URL so the module-level cache doesn't serve a prior result.
    const pos = await toSourcePosition("http://host/frames/x/nomap.tsx?v=9", 2295, 34);
    expect(pos).toEqual({ line: 2295, column: 34 });
  });

  it("returns the input coords when fetch throws (offline / no global)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const pos = await toSourcePosition("http://host/frames/x/throws.tsx?v=9", 100, 5);
    expect(pos).toEqual({ line: 100, column: 5 });
  });
});

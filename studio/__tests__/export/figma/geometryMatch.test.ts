// studio/__tests__/export/figma/geometryMatch.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { matchByGeometry, type Rect } from "../../../src/export/figma/geometryMatch";

const cand = (id: string, x: number, y: number, w: number, h: number): Rect & { id: string } =>
  ({ id, x, y, width: w, height: h });

describe("matchByGeometry", () => {
  it("matches an exact box (score 0)", () => {
    const target = { x: 8, y: 148, width: 239, height: 36 };
    const cands = [cand("a", 8, 148, 239, 36), cand("b", 0, 0, 100, 100)];
    expect(matchByGeometry(target, cands)?.id).toBe("a");
  });

  it("matches within the 8px threshold", () => {
    const target = { x: 132, y: 52, width: 40, height: 40 };
    const cands = [cand("hist", 133, 52, 40, 40)];   // edge-distance sum = 2
    expect(matchByGeometry(target, cands)?.id).toBe("hist");
  });

  it("rejects when best score is over threshold (the bubble case)", () => {
    const target = { x: 272, y: 64, width: 400, height: 409 };
    const cands = [cand("container", 272, 150, 400, 590)]; // huge edge distance
    expect(matchByGeometry(target, cands)).toBeNull();
  });

  it("rejects an area-mismatched candidate even if positioned nearby", () => {
    const target = { x: 100, y: 100, width: 400, height: 400 };
    const cands = [cand("dot", 100, 100, 12, 12)]; // area far outside ±25%
    expect(matchByGeometry(target, cands)).toBeNull();
  });

  it("rejects on ambiguity (two candidates within the gap)", () => {
    const target = { x: 10, y: 10, width: 100, height: 100 };
    const cands = [cand("x", 10, 10, 100, 100), cand("y", 11, 10, 100, 100)]; // scores 0 and 2, gap < 4
    expect(matchByGeometry(target, cands)).toBeNull();
  });
});

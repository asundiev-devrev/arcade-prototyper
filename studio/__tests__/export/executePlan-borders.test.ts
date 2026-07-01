// studio/__tests__/export/executePlan-borders.test.ts
// @vitest-environment node
// Bug 1 + 2 passthrough: borders, corners, rotation flow SLJ → PlanFrame.
import { describe, it, expect } from "vitest";
import { sljToExecutePlan } from "../../src/export/figma/executePlan";
import type { SljDocument } from "../../src/export/slj";

const MAPS = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

function doc(root: any): SljDocument {
  return { slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" }, root };
}

describe("executePlan — borders passthrough", () => {
  it("passes per-side borders map to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 100 },
      layout: null, style: { borders: { bottom: { color: "rgb(230, 230, 230)", width: 1 } } },
      children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).borders).toEqual({ bottom: { color: "rgb(230, 230, 230)", width: 1 } });
  });

  it("omits borders when not present", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 100 },
      layout: null, style: {}, children: [],
    }), MAPS as any);
    expect((plan.root as any).borders).toBeUndefined();
  });

  it("does NOT collapse a single-child frame that has borders (it is visual)", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 200 },
      layout: null, style: {},
      children: [{
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 100 },
        layout: null, style: { borders: { top: { color: "rgb(1,2,3)", width: 2 } } },
        children: [{
          kind: "element", tag: "text", box: { x: 5, y: 5, width: 60, height: 16 },
          layout: null, style: { characters: "X" }, children: [],
        }],
      }],
    }), MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).borders).toBeDefined();
  });
});

describe("executePlan — per-corner radius passthrough", () => {
  it("passes corners map to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 100 },
      layout: null, style: { corners: { tl: 12, tr: 12, br: 0, bl: 0 } }, children: [],
    }), MAPS as any);
    expect((plan.root as any).corners).toEqual({ tl: 12, tr: 12, br: 0, bl: 0 });
  });

  it("still passes uniform cornerRadius", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 100 },
      layout: null, style: { cornerRadius: 8 }, children: [],
    }), MAPS as any);
    expect((plan.root as any).cornerRadius).toBe(8);
  });
});

describe("executePlan — rotation passthrough", () => {
  it("passes rotation degrees to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 10, y: 10, width: 120, height: 80 },
      layout: null, style: { rotation: 6, fill: "#fff" }, children: [],
    }), MAPS as any);
    expect((plan.root as any).rotation).toBeCloseTo(6, 0);
  });

  it("omits rotation when absent", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 },
      layout: null, style: {}, children: [],
    }), MAPS as any);
    expect((plan.root as any).rotation).toBeUndefined();
  });
});

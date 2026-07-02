// studio/__tests__/export/figma/buildExecuteScript-borders.test.ts
// @vitest-environment node
// Bug 1 + 2 runtime: per-side stroke weights, per-corner radius, rotation apply.
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";

const MAPS: ExecutePlanMaps = {
  findComponentMapping: () => null,
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

function runRuntime(code: string, figma: any): Promise<any> {
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

function makeFigmaMock() {
  let pageRoot: any = null;
  let createCount = 0;
  function frameNode() {
    const f: any = {
      type: "FRAME", name: "frame", fills: [] as any[], strokes: [] as any[],
      strokeWeight: 0, strokeTopWeight: 0, strokeRightWeight: 0, strokeBottomWeight: 0, strokeLeftWeight: 0,
      clipsContent: true, effects: [] as any[], opacity: 1,
      layoutMode: "NONE", itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      counterAxisAlignItems: "MIN", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
      x: 0, y: 0, width: 0, height: 0, rotation: 0,
      cornerRadius: 0, topLeftRadius: 0, topRightRadius: 0, bottomRightRadius: 0, bottomLeftRadius: 0,
      children: [] as any[],
      appendChild(n: any) { this.children.push(n); },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      resize(w: number, h: number) { this.width = w; this.height = h; },
    };
    return f;
  }
  const figma: any = {
    createFrame() {
      const f = frameNode();
      if (createCount === 0) pageRoot = f;
      createCount++;
      return f;
    },
    createText() { return { type: "TEXT", x: 0, y: 0, fontName: { family: "Inter", style: "Regular" }, fills: [], characters: "", resize() {} }; },
    createImage() { return { hash: "h" }; },
    createNodeFromSvg() { return null; },
    currentPage: { appendChild() {}, selection: [] as any[] },
    viewport: { scrollAndZoomIntoView() {} },
    root: { findAllWithCriteria: () => [] },
    async importComponentSetByKeyAsync() { return null; },
    async importComponentByKeyAsync() { return null; },
    async loadFontAsync() {},
    variables: { async importVariableByKeyAsync() { return null; }, setBoundVariableForPaint: (b: any) => b },
  };
  return { figma, get pageRoot() { return pageRoot; } };
}

describe("buildExecuteScript — per-side borders", () => {
  it("applies a bottom-only border via strokes + strokeBottomWeight, 0 on other sides", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 60 }, layout: null,
          style: { borders: { bottom: { color: "rgb(230, 230, 230)", width: 1 } } }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.strokes).toHaveLength(1);
    expect(child.strokes[0].type).toBe("SOLID");
    expect(child.strokeBottomWeight).toBe(1);
    expect(child.strokeTopWeight).toBe(0);
    expect(child.strokeLeftWeight).toBe(0);
    expect(child.strokeRightWeight).toBe(0);
  });

  it("applies a uniform border on all four sides", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 200 }, layout: null,
          style: { borders: {
            top: { color: "rgb(10,10,10)", width: 2 }, right: { color: "rgb(10,10,10)", width: 2 },
            bottom: { color: "rgb(10,10,10)", width: 2 }, left: { color: "rgb(10,10,10)", width: 2 },
          } }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.strokes).toHaveLength(1);
    expect(child.strokeTopWeight).toBe(2);
    expect(child.strokeRightWeight).toBe(2);
    expect(child.strokeBottomWeight).toBe(2);
    expect(child.strokeLeftWeight).toBe(2);
  });

  it("does not set strokes when no borders", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 200 }, layout: null,
          style: { fill: "#fff" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.strokes).toHaveLength(0);
  });
});

describe("buildExecuteScript — border color variable binding (bug class: black-defaulted tokens)", () => {
  const TOKEN_MAPS: ExecutePlanMaps = {
    findComponentMapping: () => null,
    findIconSetKey: () => null,
    findIconSetName: () => null,
    tokenNameToVariableKey: (t: string) => (t === "--stroke-neutral-subtle" ? "VarKey:stroke" : null),
  };

  function makeBindingMock() {
    const base = makeFigmaMock();
    let bound = false;
    base.figma.variables = {
      async importVariableByKeyAsync(key: string) { return { id: "id:" + key, key, resolvedType: "COLOR" }; },
      setBoundVariableForPaint: (paint: any, _field: string, v: any) => { bound = true; return { ...paint, boundVariables: { color: { id: v.id } } }; },
    };
    // NOTE: base.pageRoot is a getter — spreading base would lose it. Return
    // an object that forwards figma + a live pageRoot getter.
    return {
      figma: base.figma,
      get pageRoot() { return base.pageRoot; },
      wasBound: () => bound,
    };
  }

  // SLJ carrying the token→raw dict so the plan emits a raw floor + key.
  const tokSlj = (): SljDocument => ({
    slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
    tokens: { "--stroke-neutral-subtle": "rgb(230, 230, 230)" },
    root: {
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 900 }, layout: null, style: {},
      children: [{
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 900 }, layout: null,
        style: { borders: { right: { color: "--stroke-neutral-subtle", width: 1 } } }, children: [],
      }],
    },
  });

  it("binds a stroke to the color variable when import succeeds", async () => {
    const mock = makeBindingMock();
    await runRuntime(buildExecuteScript(tokSlj(), TOKEN_MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.strokes).toHaveLength(1);
    expect(child.strokes[0].boundVariables?.color?.id).toBe("id:VarKey:stroke");
    expect(mock.wasBound()).toBe(true);
    expect(child.strokeRightWeight).toBe(1);
  });

  it("FLOOR: when the variable import FAILS, the stroke keeps its true raw color (never black)", async () => {
    const mock = makeFigmaMock();
    // Variables API unavailable / import returns null (e.g. non-Enterprise plan).
    mock.figma.variables = { async importVariableByKeyAsync() { return null; }, setBoundVariableForPaint: (p: any) => p };
    await runRuntime(buildExecuteScript(tokSlj(), TOKEN_MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.strokes).toHaveLength(1);
    const c = child.strokes[0].color;
    // rgb(230,230,230) → ~0.902, NOT black (0).
    expect(c.r).toBeCloseTo(230 / 255, 2);
    expect(c.g).toBeCloseTo(230 / 255, 2);
    expect(c.b).toBeCloseTo(230 / 255, 2);
    expect(child.strokes[0].boundVariables).toBeUndefined();
  });
});

describe("buildExecuteScript — per-corner radius", () => {
  it("applies individual corner radii", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 100 }, layout: null,
          style: { corners: { tl: 12, tr: 12, br: 0, bl: 0 } }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.topLeftRadius).toBe(12);
    expect(child.topRightRadius).toBe(12);
    expect(child.bottomRightRadius).toBe(0);
    expect(child.bottomLeftRadius).toBe(0);
  });
});

describe("buildExecuteScript — rotation", () => {
  it("applies frame.rotation for a rotated node", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 100, y: 100, width: 120, height: 80 }, layout: null,
          style: { rotation: 6, fill: "#fff" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    // Figma rotation is CCW-positive; CSS clockwise-positive → runtime negates.
    expect(child.rotation).toBeCloseTo(-6, 0);
  });

  it("leaves rotation at 0 for un-rotated nodes", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null,
          style: { fill: "#fff" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    await runRuntime(buildExecuteScript(slj, MAPS), mock.figma);
    const child = mock.pageRoot.children[0];
    expect(child.rotation).toBe(0);
  });
});

describe("buildExecuteScript — emitted script patterns", () => {
  it("emits strokeBottomWeight and topLeftRadius and rotation references", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null,
        style: { borders: { bottom: { color: "rgb(1,2,3)", width: 1 } }, corners: { tl: 4, tr: 4, br: 0, bl: 0 }, rotation: 6 }, children: [] },
    };
    const code = buildExecuteScript(slj, MAPS);
    expect(code).toContain("strokeBottomWeight");
    expect(code).toContain("topLeftRadius");
    expect(code).toContain("rotation");
  });
});

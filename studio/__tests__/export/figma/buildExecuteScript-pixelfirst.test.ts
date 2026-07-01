// studio/__tests__/export/figma/buildExecuteScript-pixelfirst.test.ts
// @vitest-environment node
// Tests for pixel-first runtime: clipsContent gate, DROP_SHADOW, opacity, createImage + base64 decoder.
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

/** Run the sandbox script (top-level await + return) against a figma mock. */
function runRuntime(code: string, figma: any): Promise<any> {
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

function makeFigmaMock() {
  let pageRoot: any = null;
  let createCount = 0;
  const allFrames: any[] = [];
  const allImages: any[] = [];

  function frameNode() {
    const f = {
      type: "FRAME", name: "frame", fills: [] as any[], clipsContent: true,
      effects: [] as any[], opacity: 1,
      layoutMode: "NONE", itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      counterAxisAlignItems: "MIN", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
      x: 0, y: 0, width: 0, height: 0, cornerRadius: 0, children: [] as any[],
      appendChild(n: any) { this.children.push(n); },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      resize(w: number, h: number) { this.width = w; this.height = h; },
    };
    allFrames.push(f);
    return f;
  }

  const figma: any = {
    createFrame() {
      const f = frameNode();
      if (createCount === 0) pageRoot = f;
      createCount++;
      return f;
    },
    createText() {
      return { type: "TEXT", x: 0, y: 0, fontName: { family: "Inter", style: "Regular" }, fills: [], characters: "", fontSize: 14, lineHeight: { value: 20, unit: "PIXELS" }, textAutoResize: "NONE", resize(w: number, h: number) { this.width = w; this.height = h; } };
    },
    createImage(bytes: Uint8Array) {
      const img = { hash: "img_hash_" + allImages.length, bytes };
      allImages.push(img);
      return img;
    },
    createNodeFromSvg() { return null; },
    currentPage: { appendChild() {}, selection: [] as any[] },
    viewport: { scrollAndZoomIntoView() {} },
    root: { findAllWithCriteria: () => [] },
    async importComponentSetByKeyAsync() { return null; },
    async importComponentByKeyAsync() { return null; },
    async loadFontAsync() {},
    variables: {
      async importVariableByKeyAsync() { return null; },
      setBoundVariableForPaint: (base: any) => base,
    },
  };
  return { figma, get pageRoot() { return pageRoot; }, allFrames, allImages };
}

describe("buildExecuteScript pixel-first: clipsContent gate", () => {
  it("sets clipsContent=true on frame with clip flag", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 10, y: 10, width: 380, height: 380 },
          layout: null, style: { clip: true, fill: "#eee" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);
    // Second frame (first is the pageRoot wrapper); find the child frame
    const childFrame = mock.pageRoot.children[0];
    expect(childFrame.clipsContent).toBe(true);
  });

  it("sets clipsContent=false on frame without clip flag", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 10, y: 10, width: 200, height: 200 },
          layout: null, style: { fill: "#eee" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);
    const childFrame = mock.pageRoot.children[0];
    expect(childFrame.clipsContent).toBe(false);
  });
});

describe("buildExecuteScript pixel-first: DROP_SHADOW", () => {
  it("applies drop shadow effect on frame with shadow", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 10, y: 10, width: 200, height: 100 },
          layout: null, style: { shadow: { color: "rgba(0, 0, 0, 0.1)", x: 0, y: 4, blur: 12, spread: 0 } },
          children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);
    const childFrame = mock.pageRoot.children[0];
    expect(childFrame.effects).toHaveLength(1);
    const effect = childFrame.effects[0];
    expect(effect.type).toBe("DROP_SHADOW");
    expect(effect.offset).toEqual({ x: 0, y: 4 });
    expect(effect.radius).toBe(12);
    expect(effect.spread).toBe(0);
    expect(effect.visible).toBe(true);
    expect(effect.blendMode).toBe("NORMAL");
    // color should be parsed rgba
    expect(effect.color.r).toBeCloseTo(0, 2);
    expect(effect.color.g).toBeCloseTo(0, 2);
    expect(effect.color.b).toBeCloseTo(0, 2);
    expect(effect.color.a).toBeCloseTo(0.1, 2);
  });

  it("does not apply effects when no shadow", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 10, y: 10, width: 200, height: 100 },
          layout: null, style: { fill: "#fff" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);
    const childFrame = mock.pageRoot.children[0];
    expect(childFrame.effects).toHaveLength(0);
  });
});

describe("buildExecuteScript pixel-first: opacity", () => {
  it("applies opacity on frame", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "div", box: { x: 10, y: 10, width: 200, height: 100 },
          layout: null, style: { opacity: 0.6 }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);
    const childFrame = mock.pageRoot.children[0];
    expect(childFrame.opacity).toBe(0.6);
  });
});

describe("buildExecuteScript pixel-first: image node", () => {
  it("creates an image rectangle from base64 data", async () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "img", box: { x: 10, y: 10, width: 48, height: 48 },
          layout: null, style: { imageData: "AQID", cornerRadius: 24 }, // AQID = [1,2,3] in base64
          children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);

    // Should have created an image
    expect(mock.allImages.length).toBeGreaterThanOrEqual(1);
    // The frame acting as the image container should have IMAGE fill
    const imgFrame = mock.pageRoot.children[0];
    expect(imgFrame).toBeDefined();
    expect(imgFrame.fills).toHaveLength(1);
    expect(imgFrame.fills[0].type).toBe("IMAGE");
    expect(imgFrame.fills[0].imageHash).toBe("img_hash_0");
    expect(imgFrame.fills[0].scaleMode).toBe("FILL");
    // corner radius applied
    expect(imgFrame.cornerRadius).toBe(24);
    // positioned
    expect(imgFrame.x).toBe(10);
    expect(imgFrame.y).toBe(10);
    expect(imgFrame.width).toBe(48);
    expect(imgFrame.height).toBe(48);
  });

  it("the base64 decoder correctly decodes known values", async () => {
    // "SGVsbG8=" → "Hello" (72,101,108,108,111)
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "img", box: { x: 0, y: 0, width: 50, height: 50 },
          layout: null, style: { imageData: "SGVsbG8=" }, children: [],
        }],
      },
    };
    const mock = makeFigmaMock();
    const code = buildExecuteScript(slj, MAPS);
    await runRuntime(code, mock.figma);

    expect(mock.allImages.length).toBe(1);
    const bytes = mock.allImages[0].bytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });
});

describe("buildExecuteScript pixel-first: emitted script patterns", () => {
  it("contains clipsContent assignment", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {}, children: [] },
    };
    const code = buildExecuteScript(slj, MAPS);
    expect(code).toContain("clipsContent");
  });

  it("contains DROP_SHADOW effect construction", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: { shadow: { color: "rgba(0,0,0,0.1)", x: 0, y: 4, blur: 12, spread: 0 } }, children: [] },
    };
    const code = buildExecuteScript(slj, MAPS);
    expect(code).toContain("DROP_SHADOW");
  });

  it("contains createImage call", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {},
        children: [{ kind: "element", tag: "img", box: { x: 0, y: 0, width: 50, height: 50 }, layout: null, style: { imageData: "abc" }, children: [] }] },
    };
    const code = buildExecuteScript(slj, MAPS);
    expect(code).toContain("createImage");
  });

  it("contains base64 decoder function", () => {
    const slj: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {},
        children: [{ kind: "element", tag: "img", box: { x: 0, y: 0, width: 50, height: 50 }, layout: null, style: { imageData: "abc" }, children: [] }] },
    };
    const code = buildExecuteScript(slj, MAPS);
    expect(code).toContain("b64decode");
  });
});

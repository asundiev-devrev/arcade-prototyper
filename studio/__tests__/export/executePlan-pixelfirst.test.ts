// studio/__tests__/export/executePlan-pixelfirst.test.ts
// @vitest-environment node
// Tests for the pixel-first architecture: layout always null, clip passthrough,
// shadow/opacity passthrough, image node emission.
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

describe("pixel-first: layout always null", () => {
  it("sets layout null on PlanFrame even when SLJ element has non-null layout", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 600 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" },
      style: { fill: "#fff" }, children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).layout).toBeNull();
  });

  it("sets layout null on PlanFrame from unmapped component with layout", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "UnmappedWidget", source: "arcade-prototypes",
      props: {}, box: { x: 0, y: 0, width: 100, height: 100 },
      layout: { mode: "horizontal", gap: 4, padding: [8, 8, 8, 8], align: "center" },
      children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).layout).toBeNull();
  });

  it("collapses all single-child styleless wrappers (since everything is absolute context)", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" },
      style: {},
      children: [{
        kind: "element", tag: "div", box: { x: 10, y: 10, width: 80, height: 30 },
        layout: null, style: {},
        children: [{
          kind: "element", tag: "text", box: { x: 15, y: 15, width: 60, height: 16 },
          layout: null, style: { characters: "Label" }, children: [],
        }],
      }],
    }), MAPS as any);
    // Parent's layout was non-null in SLJ, but pixel-first forces null → everything
    // is absolute context → styleless wrapper collapses.
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("text");
  });
});

describe("pixel-first: clip passthrough", () => {
  it("passes clip:true from ElementStyle to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 400 },
      layout: null, style: { fill: "#333", clip: true }, children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).clip).toBe(true);
  });

  it("omits clip when not set in style", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 400 },
      layout: null, style: { fill: "#333" }, children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).clip).toBeUndefined();
  });

  it("does NOT collapse a frame with clip:true (it has visual purpose)", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 200 },
      layout: null, style: {},
      children: [{
        kind: "element", tag: "div", box: { x: 10, y: 10, width: 180, height: 180 },
        layout: null, style: { clip: true },
        children: [{
          kind: "element", tag: "text", box: { x: 15, y: 15, width: 160, height: 16 },
          layout: null, style: { characters: "Clipped content" }, children: [],
        }],
      }],
    }), MAPS as any);
    // clip:true is visual → not a pointless wrapper → must NOT collapse
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
    expect((plan.root.children[0] as any).clip).toBe(true);
  });
});

describe("pixel-first: shadow passthrough", () => {
  it("passes shadow from ElementStyle to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 100 },
      layout: null, style: { shadow: { color: "rgba(0, 0, 0, 0.1)", x: 0, y: 4, blur: 12, spread: 0 } },
      children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).shadow).toEqual({ color: "rgba(0, 0, 0, 0.1)", x: 0, y: 4, blur: 12, spread: 0 });
  });

  it("omits shadow when not present in style", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 100 },
      layout: null, style: {}, children: [],
    }), MAPS as any);
    expect((plan.root as any).shadow).toBeUndefined();
  });
});

describe("pixel-first: opacity passthrough", () => {
  it("passes opacity from ElementStyle to PlanFrame", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 100 },
      layout: null, style: { opacity: 0.5 }, children: [],
    }), MAPS as any);
    expect(plan.root.kind).toBe("frame");
    expect((plan.root as any).opacity).toBe(0.5);
  });

  it("omits opacity when 1 or absent", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 200, height: 100 },
      layout: null, style: {}, children: [],
    }), MAPS as any);
    expect((plan.root as any).opacity).toBeUndefined();
  });
});

describe("pixel-first: image node emission", () => {
  it("emits an image PlanNode for element with imageData", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 300, height: 300 },
      layout: null, style: {},
      children: [{
        kind: "element", tag: "img", box: { x: 10, y: 10, width: 48, height: 48 },
        layout: null, style: { imageData: "iVBORw0KGgoAAAANSUhEU...", cornerRadius: 24 },
        children: [],
      }],
    }), MAPS as any);
    expect(plan.root.children).toHaveLength(1);
    const img = plan.root.children[0] as any;
    expect(img.kind).toBe("image");
    expect(img.data).toBe("iVBORw0KGgoAAAANSUhEU...");
    expect(img.box).toEqual({ x: 10, y: 10, width: 48, height: 48 });
    expect(img.cornerRadius).toBe(24);
  });

  it("does NOT emit image node for elements without imageData", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 300, height: 300 },
      layout: null, style: {},
      children: [{
        kind: "element", tag: "img", box: { x: 10, y: 10, width: 48, height: 48 },
        layout: null, style: {}, children: [],
      }],
    }), MAPS as any);
    // Without imageData, img degrades to a plain frame (not an image node)
    expect(plan.root.children).toHaveLength(1);
    expect(plan.root.children[0].kind).toBe("frame");
  });
});

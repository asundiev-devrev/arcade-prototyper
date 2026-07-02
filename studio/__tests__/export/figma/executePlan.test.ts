// studio/__tests__/export/figma/executePlan.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sljToExecutePlan, type ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { SljDocument } from "../../../src/export/slj";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const bubble: FigmaComponentMapping = {
  arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "BUBBLE_KEY", setName: "Bubble" },
  variants: [{ prop: "variant", figmaProp: "Type", valueMap: { receiver: "Receiver", sender: "Sender" } }],
  textNode: { strategy: "lowest-depth" }, note: "",
};
const iconButton: FigmaComponentMapping = {
  arcadeGen: "IconButton", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
};
const maps: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "ChatBubble" ? bubble : n === "IconButton" ? iconButton : null),
  findIconSetKey: (i) => (i === "ChevronLeftSmall" ? "ICONS_CHEVRON_LEFT" : null),
  findIconSetName: (i) => (i === "ChevronLeftSmall" ? "Icons/Chevron.left" : null),
  tokenNameToVariableKey: (t) => (t === "--surface-overlay" ? "SURFACE_KEY" : null),
};
function doc(root: any): SljDocument {
  return { slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" }, root };
}

describe("sljToExecutePlan", () => {
  it("emits a frame node for an element with a token fill resolved to a variable key", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 256, height: 600 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], align: "start" },
      style: { fill: "--surface-overlay" }, children: [],
    }), maps);
    expect(plan.root.kind).toBe("frame");
    // Pixel-first: layout is always null (absolute positioning)
    expect((plan.root as any).layout).toBeNull();
    expect((plan.root as any).fillVariableKey).toBe("SURFACE_KEY");
  });

  it("emits an instance node for a mapped component with variant + text + icon", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 100, height: 100 }, layout: null, style: {},
      children: [{
        kind: "component", component: "IconButton", source: "arcade/components",
        props: { variant: "tertiary" }, box: { x: 10, y: 10, width: 20, height: 20 }, layout: null,
        children: [], icon: "ChevronLeftSmall",
      }],
    }), maps);
    const inst: any = (plan.root as any).children[0];
    expect(inst.kind).toBe("instance");
    expect(inst.componentSetKey).toBe("IB_KEY");
    expect(inst.setName).toBe("Icon Button");
    expect(inst.iconSetKey).toBe("ICONS_CHEVRON_LEFT");
    expect(inst.iconSetName).toBe("Icons/Chevron.left");
    expect(inst.box).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it("resolves variant props through the valueMap", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: { variant: "sender" }, box: { x: 0, y: 0, width: 100, height: 40 }, layout: null,
      children: [{ kind: "element", tag: "text", box: { x: 0, y: 0, width: 80, height: 16 }, layout: null, style: { characters: "Hi" }, children: [] }],
    }), maps);
    const inst: any = plan.root;
    expect(inst.kind).toBe("instance");
    expect(inst.variant).toEqual({ Type: "Sender" });
    expect(inst.text).toEqual({ characters: "Hi" });
  });

  it("emits a text node for a text element", () => {
    const plan = sljToExecutePlan(doc({
      kind: "element", tag: "text", box: { x: 0, y: 0, width: 80, height: 16 }, layout: null,
      style: { characters: "Sessions", color: "--fg-neutral-subtle" }, children: [],
    }), maps);
    expect(plan.root.kind).toBe("text");
    expect((plan.root as any).characters).toBe("Sessions");
  });

  it("attaches a pixel-floor fallback frame (box + fill + label + icon svg) to a mapped instance", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "ChatBubble", source: "arcade/components",
      props: { variant: "sender" }, box: { x: 10, y: 20, width: 120, height: 40 }, layout: null,
      children: [{ kind: "element", tag: "text", box: { x: 14, y: 24, width: 80, height: 16 }, layout: null, style: { characters: "Hi", color: "rgb(0,0,0)" }, children: [] }],
      fallbackStyle: { fill: "rgb(240, 240, 240)", cornerRadius: 12 },
      iconSvg: { markup: "<svg><path d='M0 0'/></svg>", box: { x: 90, y: 24, width: 16, height: 16 } },
    } as any), maps);
    const inst: any = plan.root;
    expect(inst.kind).toBe("instance");
    const fb = inst.fallback;
    expect(fb).toBeDefined();
    expect(fb.kind).toBe("frame");
    expect(fb.box).toEqual({ x: 10, y: 20, width: 120, height: 40 });
    expect(fb.fillColor).toBe("rgb(240, 240, 240)");
    expect(fb.cornerRadius).toBe(12);
    // label text leaf + icon svg leaf
    const kinds = fb.children.map((c: any) => c.kind).sort();
    expect(kinds).toEqual(["svg", "text"]);
    const txt = fb.children.find((c: any) => c.kind === "text");
    expect(txt.characters).toBe("Hi");
    const svg = fb.children.find((c: any) => c.kind === "svg");
    expect(svg.markup).toContain("<svg>");
  });

  it("omits the fallback when a mapped component has no paintable style, label, or icon", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 0, y: 0, width: 20, height: 20 }, layout: null, children: [],
    }), maps);
    expect((plan.root as any).fallback).toBeUndefined();
  });

  it("an unmapped component degrades to a frame (so its children still build)", () => {
    const plan = sljToExecutePlan(doc({
      kind: "component", component: "MysteryComposite", source: "arcade-prototypes",
      props: {}, box: { x: 0, y: 0, width: 50, height: 50 }, layout: null, children: [],
    }), maps);
    expect(plan.root.kind).toBe("frame");
  });
});

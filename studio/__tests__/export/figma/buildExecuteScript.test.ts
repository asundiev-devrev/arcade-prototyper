// studio/__tests__/export/figma/buildExecuteScript.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const iconButton: FigmaComponentMapping = {
  arcadeGen: "IconButton", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
};
const maps: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "IconButton" ? iconButton : null),
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};
const slj: SljDocument = {
  slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
  root: {
    kind: "element", tag: "div", box: { x: 0, y: 0, width: 1280, height: 600 }, layout: null, style: {},
    children: [{
      kind: "component", component: "IconButton", source: "arcade/components",
      props: {}, box: { x: 10, y: 10, width: 20, height: 20 }, layout: null, children: [],
    }],
  },
};

describe("buildExecuteScript", () => {
  it("returns a non-empty JS string referencing the figma API + returning a result", () => {
    const code = buildExecuteScript(slj, maps);
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(100);
    expect(code).toContain("IB_KEY");
    expect(code).toContain("figma.createFrame");
    expect(code).toContain("createInstance");
    expect(code).toMatch(/return\s+\{/);
  });

  it("embeds the plan as valid JSON (parseable substring)", () => {
    const code = buildExecuteScript(slj, maps);
    const m = code.match(/var __PLAN__\s*=\s*(\{[\s\S]*?\});/);
    expect(m).not.toBeNull();
    const plan = JSON.parse(m![1]);
    expect(plan.frame.slug).toBe("computer");
    expect(plan.root.children[0].componentSetKey).toBe("IB_KEY");
  });

  it("does not use optional chaining or TS annotations (sandbox-safe)", () => {
    const code = buildExecuteScript(slj, maps);
    expect(code).not.toContain("?.");
    expect(code).not.toContain(": string");
  });

  // Regression: the first live run produced a 1x1 wrapper (root DOM box came in
  // 0x0) and Figma frames clip by default, so all 44 instances were clipped to
  // nothing — the user saw an empty 1x1 box. The wrapper must size to its
  // CONTENT bounds and never clip.
  it("sizes the wrapper to content bounds (not the 0x0 root) and disables clipping", async () => {
    // root box is 0x0 on purpose — the exact bug condition.
    const collapsedRoot: SljDocument = {
      slj: 1, frame: { slug: "computer", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 0, height: 0 }, layout: null, style: {},
        children: [{
          kind: "component", component: "IconButton", source: "arcade/components",
          props: {}, box: { x: 100, y: 200, width: 256, height: 80 }, layout: null, children: [],
        }],
      },
    };
    const code = buildExecuteScript(collapsedRoot, maps);
    const mock = makeFigmaMock();
    await runRuntime(code, mock.figma);
    const pageRoot = mock.pageRoot;

    // wrapper grew to enclose the child at (100,200) sized 256x80 → 356x280,
    // NOT clamped to 1x1.
    expect(pageRoot.width).toBeGreaterThan(1);
    expect(pageRoot.height).toBeGreaterThan(1);
    expect(pageRoot.width).toBe(356);
    expect(pageRoot.height).toBe(280);
    // and the wrapper does not clip its content.
    expect(pageRoot.clipsContent).toBe(false);
    // the real instance was created (not silently dropped).
    expect(mock.figma.__made.instances).toBe(1);
  });

  // Regression: bubbles clipped their 2nd line because every instance was
  // force-resized to its DOM box, pinning the AUTO height axis FIXED. The fix
  // restores the hugging height axis — but ONLY for text-bearing nodes, so
  // components like Menu (also AUTO-vertical, but to a huge natural height)
  // don't balloon. This test drives both: a text instance keeps its height
  // axis AUTO; a no-text instance stays FIXED at the DOM box.
  it("restores the hugging height axis for text instances but not for text-less ones", async () => {
    const docWith = (hasText: boolean): SljDocument => ({
      slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "component", component: "IconButton", source: "arcade/components",
          props: {}, box: { x: 0, y: 0, width: 300, height: 36 }, layout: null, children: [],
          ...(hasText ? { /* text added via plan below */ } : {}),
        }],
      },
    });
    // The plan builder only attaches text when the component mapping has a
    // textNode strategy + the node has text; simplest path: inject text via a
    // mapping that carries it. We instead assert on the runtime directly by
    // building a plan whose instance has/has-not a `text` field. Reuse the
    // real builder with a text-bearing child element so firstText() picks it up.
    const withText: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "component", component: "Labeled", source: "arcade/components",
          props: {}, box: { x: 0, y: 0, width: 300, height: 36 }, layout: null,
          children: [{ kind: "element", tag: "text", box: { x: 0, y: 0, width: 50, height: 16 }, layout: null, style: { characters: "Hi there, this wraps" }, children: [] }],
        }],
      },
    };
    const withoutText: SljDocument = {
      slj: 1, frame: { slug: "f", project: "p", width: 1280, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "component", component: "Plain", source: "arcade/components",
          props: {}, box: { x: 0, y: 0, width: 300, height: 36 }, layout: null, children: [],
        }],
      },
    };
    const labeledMapping: FigmaComponentMapping = {
      arcadeGen: "Labeled", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "AL_KEY", setName: "AutoLayout" },
      variants: [], textNode: { strategy: "lowest-depth" }, note: "",
    };
    const plainMapping: FigmaComponentMapping = {
      arcadeGen: "Plain", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "AL_KEY", setName: "AutoLayout" }, variants: [], note: "",
    };
    const autoMaps: ExecutePlanMaps = {
      findComponentMapping: (n) => (n === "Labeled" ? labeledMapping : n === "Plain" ? plainMapping : null),
      findIconSetKey: () => null, findIconSetName: () => null, tokenNameToVariableKey: () => null,
    };

    // text-bearing → height axis restored to AUTO
    const m1 = makeFigmaMock({ setKey: "AL_KEY", setName: "AutoLayout", layoutMode: "VERTICAL", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED" });
    await runRuntime(buildExecuteScript(withText, autoMaps), m1.figma);
    expect(m1.lastInstance.primaryAxisSizingMode).toBe("AUTO");

    // text-less → height axis stays FIXED (set by resize), never restored
    const m2 = makeFigmaMock({ setKey: "AL_KEY", setName: "AutoLayout", layoutMode: "VERTICAL", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "FIXED" });
    await runRuntime(buildExecuteScript(withoutText, autoMaps), m2.figma);
    expect(m2.lastInstance.primaryAxisSizingMode).toBe("FIXED");
    void docWith;
  });
});

/** Run the sandbox script (top-level await + return) against a figma mock. */
function runRuntime(code: string, figma: any): Promise<any> {
  // eslint-disable-next-line no-new-func
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

/** Minimal Figma plugin-API mock. Defaults serve the wrapper-sizing path with a
 *  single "Icon Button" set. Pass opts to model an auto-layout instance (its
 *  sizing modes + layout) so the hug-height rule can be exercised. */
function makeFigmaMock(opts?: {
  setKey?: string; setName?: string;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisSizingMode?: "AUTO" | "FIXED";
  counterAxisSizingMode?: "AUTO" | "FIXED";
}) {
  const made = { instances: 0 };
  const setKey = opts?.setKey ?? "IB_KEY";
  const setName = opts?.setName ?? "Icon Button";
  function frameNode() {
    return {
      type: "FRAME", name: "", fills: [] as any[], clipsContent: true,
      layoutMode: "NONE", itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      counterAxisAlignItems: "MIN", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
      x: 0, y: 0, width: 0, height: 0, children: [] as any[],
      appendChild(n: any) { this.children.push(n); },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
      resize(w: number, h: number) { this.width = w; this.height = h; },
    };
  }
  // a single shared TEXT node so setLabel finds something to write to.
  function makeInstance() {
    const textNode = { type: "TEXT", name: "label", width: 50, height: 16, fontName: { family: "Inter", style: "Regular" }, characters: "" };
    return {
      type: "INSTANCE", x: 0, y: 0, width: 0, height: 0, componentProperties: {},
      layoutMode: opts?.layoutMode ?? "NONE",
      primaryAxisSizingMode: opts?.primaryAxisSizingMode ?? "FIXED",
      counterAxisSizingMode: opts?.counterAxisSizingMode ?? "FIXED",
      // resize pins BOTH axes FIXED, like the real API.
      resize(w: number, h: number) { (this as any).width = w; (this as any).height = h; (this as any).primaryAxisSizingMode = "FIXED"; (this as any).counterAxisSizingMode = "FIXED"; },
      findAll(pred: (n: any) => boolean) { return [textNode].filter(pred); },
      findOne() { return null; },
    };
  }
  let lastInstance: any = null;
  const comp = {
    type: "COMPONENT", variantProperties: {},
    createInstance() { made.instances++; lastInstance = makeInstance(); return lastInstance; },
  };
  const componentSet = { type: "COMPONENT_SET", key: setKey, name: setName, children: [comp], defaultVariant: comp };

  let pageRoot: any = null;
  let createCount = 0;
  const figma: any = {
    __made: made,
    createFrame() {
      const f = frameNode();
      // the first frame created is the wrapper (pageRoot).
      if (createCount === 0) pageRoot = f;
      createCount++;
      return f;
    },
    createText() {
      return { type: "TEXT", x: 0, y: 0, fontName: { family: "Inter", style: "Regular" }, fills: [] as any[], characters: "" };
    },
    currentPage: { appendChild() {}, selection: [] as any[] },
    viewport: { scrollAndZoomIntoView() {} },
    root: { findAllWithCriteria: () => [componentSet] },
    async importComponentSetByKeyAsync() { throw new Error("no remote import"); },
    async loadFontAsync() {},
  };
  // pageRoot + lastInstance are assigned during the run; read after via getters.
  return { figma, get pageRoot() { return pageRoot; }, get lastInstance() { return lastInstance; } };
}

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
});

/** Run the sandbox script (top-level await + return) against a figma mock. */
function runRuntime(code: string, figma: any): Promise<any> {
  // eslint-disable-next-line no-new-func
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

/** Minimal Figma plugin-API mock — enough for the wrapper-sizing path + one
 *  IconButton instance. Records the created pageRoot + a made summary. */
function makeFigmaMock() {
  const made = { instances: 0 };
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
  const instanceProto = {
    type: "INSTANCE", x: 0, y: 0, width: 0, height: 0, componentProperties: {},
    resize(w: number, h: number) { (this as any).width = w; (this as any).height = h; },
    findAll() { return []; }, findOne() { return null; },
  };
  const comp = {
    type: "COMPONENT", variantProperties: {},
    createInstance() { made.instances++; return Object.assign({}, instanceProto); },
  };
  const componentSet = { type: "COMPONENT_SET", key: "IB_KEY", name: "Icon Button", children: [comp], defaultVariant: comp };

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
  // pageRoot is assigned during the run; read it after via the getter.
  return { figma, get pageRoot() { return pageRoot; } };
}

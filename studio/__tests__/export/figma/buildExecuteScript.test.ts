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

  it("emits runtime that applies text fontSize/color and frame cornerRadius", () => {
    const slj: any = {
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x:0,y:0,width:100,height:40 }, layout: null,
        style: { fill: "#fff", cornerRadius: 8 },
        children: [{ kind: "element", tag: "text", box: {x:0,y:0,width:40,height:16},
          layout: null, children: [], style: { characters: "Hi", color: "#141a1a", fontSize: 13, fontWeight: 500, fontFamily: "Inter" } }] },
    };
    const MAPS = { findComponentMapping:()=>null, findIconSetKey:()=>null, findIconSetName:()=>null, tokenNameToVariableKey:()=>null };
    const script = buildExecuteScript(slj, MAPS as any);
    expect(script).toMatch(/t\.fontSize\s*=/);        // runtime sets text.fontSize
    expect(script).toMatch(/f\.cornerRadius\s*=/);    // runtime applies frame.cornerRadius
  });

  it("guards against whitespace-only fontFamily by falling back to Inter", () => {
    const slj: any = {
      frame: { slug: "f", project: "p", width: 100, mode: "light" },
      root: { kind: "element", tag: "div", box: { x:0,y:0,width:100,height:40 }, layout: null, style: {},
        children: [{ kind: "element", tag: "text", box: {x:0,y:0,width:40,height:16},
          layout: null, children: [], style: { characters: "Hi", fontFamily: "   " } }] },
    };
    const MAPS = { findComponentMapping:()=>null, findIconSetKey:()=>null, findIconSetName:()=>null, tokenNameToVariableKey:()=>null };
    const script = buildExecuteScript(slj, MAPS as any);
    // Verify the runtime contains the fallback pattern: famRaw || "Inter"
    expect(script).toContain('var famRaw = node.fontFamily ? String(node.fontFamily).split(",")[0].replace(/["\']/g,"").trim() : "";');
    expect(script).toContain('var fam = famRaw || "Inter";');
  });

  it("completes within bounded time when library imports never settle", async () => {
    // When the Arcade library is not enabled in a file, importComponentSetByKeyAsync
    // and importVariableByKeyAsync never resolve or reject — they just hang. This
    // test models that: mocks return promises that never settle, then asserts the
    // runtime completes with failures counted (not an infinite hang).
    const slj: SljDocument = {
      slj: 1, frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 300 }, layout: null,
        style: { fill: "--color-bg-primary" },
        children: [
          {
            kind: "component", component: "IconButton", source: "arcade/components",
            props: {}, box: { x: 10, y: 10, width: 48, height: 48 }, layout: null, children: [],
          },
          {
            kind: "element", tag: "div", box: { x: 10, y: 70, width: 100, height: 40 }, layout: null, style: {},
            children: [{
              kind: "element", tag: "text", box: { x: 10, y: 70, width: 100, height: 20 },
              layout: null, style: { characters: "Hi", color: "--color-text" }, children: [],
            }],
          },
        ],
      },
    };
    const mapping: FigmaComponentMapping = {
      arcadeGen: "IconButton", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "NEVER_KEY", setName: "Never Set" }, variants: [], note: "",
    };
    const mapsWithToken: ExecutePlanMaps = {
      findComponentMapping: (n) => (n === "IconButton" ? mapping : null),
      findIconSetKey: () => null, findIconSetName: () => null,
      tokenNameToVariableKey: (n) => (n === "--color-bg-primary" ? "BG_VAR_KEY" : n === "--color-text" ? "TXT_VAR_KEY" : null),
    };

    const code = buildExecuteScript(slj, mapsWithToken);
    const mock = makeFigmaMock();
    // Mock the import calls to return promises that NEVER settle (the exact bug condition).
    mock.figma.importComponentSetByKeyAsync = () => new Promise(() => {});
    mock.figma.importComponentByKeyAsync = () => new Promise(() => {});
    mock.figma.variables = {
      importVariableByKeyAsync: () => new Promise(() => {}),
      setBoundVariableForPaint: (base: any) => base,
    };

    const start = Date.now();
    const result = await runRuntime(code, mock.figma);
    const elapsed = Date.now() - start;

    // The runtime must complete in bounded time (well under the 90s bridge budget).
    // With pre-warm, all unique keys import in parallel with 20s timeout each.
    // 1 set key + 2 variable keys → single 20s wave, not sequential 60s.
    // Allow 30s ceiling (generous margin for async overhead + build phase).
    expect(elapsed).toBeLessThan(30000);
    // The instance and text node failed to resolve (counted as fail/error).
    expect(result.made.fail).toBeGreaterThanOrEqual(1);
    // But the wrapper frame was still built (not a full hang).
    expect(result.made.frames).toBeGreaterThan(0);
  }, 35000); // vitest timeout: 35s (greater than the 30s assertion ceiling)

  it("falls back to bare COMPONENT when importComponentSetByKeyAsync hangs", async () => {
    // Bare COMPONENTs (Tabs ee83…, Breadcrumb 0ecf…) exist in componentEntries but
    // importComponentSetByKeyAsync on a COMPONENT key never settles. The runtime
    // must race against importComponentByKeyAsync (which resolves) and win.
    const slj: SljDocument = {
      slj: 1, frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null, style: {},
        children: [{
          kind: "component", component: "BareComponent", source: "arcade/components",
          props: {}, box: { x: 10, y: 10, width: 100, height: 40 }, layout: null, children: [],
        }],
      },
    };
    const mapping: FigmaComponentMapping = {
      arcadeGen: "BareComponent", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "BARE_KEY", setName: "Bare" }, variants: [], note: "",
    };
    const mapsWithKey: ExecutePlanMaps = {
      findComponentMapping: (n) => (n === "BareComponent" ? mapping : null),
      findIconSetKey: () => null, findIconSetName: () => null, tokenNameToVariableKey: () => null,
    };

    const code = buildExecuteScript(slj, mapsWithKey);
    // Lower the timeout constant from 20000 → 100 so the test completes quickly.
    const fastCode = code.replace(/var IMPORT_TIMEOUT_MS = 20000;/, "var IMPORT_TIMEOUT_MS = 100;");

    const mock = makeFigmaMock();
    // importComponentSetByKeyAsync hangs forever (the real bug).
    mock.figma.importComponentSetByKeyAsync = () => new Promise(() => {});
    // importComponentByKeyAsync resolves a bare COMPONENT (with createInstance, no children).
    const bareComp = {
      type: "COMPONENT", variantProperties: {},
      createInstance() {
        mock.figma.__made.instances++;
        return {
          type: "INSTANCE", x: 0, y: 0, width: 0, height: 0, componentProperties: {},
          layoutMode: "NONE", primaryAxisSizingMode: "FIXED", counterAxisSizingMode: "FIXED",
          resize(w: number, h: number) { (this as any).width = w; (this as any).height = h; },
          findAll() { return []; }, findOne() { return null; },
        };
      },
    };
    mock.figma.importComponentByKeyAsync = () => Promise.resolve(bareComp);

    const start = Date.now();
    const result = await runRuntime(fastCode, mock.figma);
    const elapsed = Date.now() - start;

    // Must complete within ~200ms (100ms timeout + overhead), not hang.
    expect(elapsed).toBeLessThan(1000);
    // The instance was successfully created (bare COMPONENT fallback worked).
    expect(result.made.instances).toBe(1);
    expect(result.made.fail).toBe(0);
  }, 5000);

  it("pre-warms all unique keys exactly once, caching prevents re-import during build", async () => {
    // Plan with 2 instances of the SAME set key + 1 variable → pre-warm imports
    // each unique key exactly once; subsequent build calls hit warm cache.
    const slj: SljDocument = {
      slj: 1, frame: { slug: "test", project: "p", width: 400, mode: "light" },
      root: {
        kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 400 }, layout: null,
        style: { fill: "--color-bg-primary" },
        children: [
          {
            kind: "component", component: "IconButton", source: "arcade/components",
            props: {}, box: { x: 10, y: 10, width: 48, height: 48 }, layout: null, children: [],
          },
          {
            kind: "component", component: "IconButton", source: "arcade/components",
            props: {}, box: { x: 10, y: 70, width: 48, height: 48 }, layout: null, children: [],
          },
        ],
      },
    };
    const mapping: FigmaComponentMapping = {
      arcadeGen: "IconButton", status: "mapped", generation: "0.3",
      figma: { componentSetKey: "IB_KEY", setName: "Icon Button" }, variants: [], note: "",
    };
    const mapsWithToken: ExecutePlanMaps = {
      findComponentMapping: (n) => (n === "IconButton" ? mapping : null),
      findIconSetKey: () => null, findIconSetName: () => null,
      tokenNameToVariableKey: (n) => (n === "--color-bg-primary" ? "BG_VAR_KEY" : null),
    };

    const code = buildExecuteScript(slj, mapsWithToken);
    const mock = makeFigmaMock({ setKey: "IB_KEY", setName: "Icon Button" });

    let setImportCount = 0;
    let compImportCount = 0;
    let varImportCount = 0;
    const componentSet = mock.figma.root.findAllWithCriteria()[0];
    mock.figma.importComponentSetByKeyAsync = (key: string) => {
      setImportCount++;
      return Promise.resolve(key === "IB_KEY" ? componentSet : null);
    };
    mock.figma.importComponentByKeyAsync = (key: string) => {
      compImportCount++;
      return Promise.resolve(null);
    };
    const bgVar = { id: "v1", resolvedType: "COLOR" };
    mock.figma.variables = {
      importVariableByKeyAsync: (key: string) => {
        varImportCount++;
        return Promise.resolve(key === "BG_VAR_KEY" ? bgVar : null);
      },
      setBoundVariableForPaint: (base: any) => base,
    };

    const result = await runRuntime(code, mock.figma);

    // Pre-warm phase imports 1 unique set key (IB_KEY) + 1 variable key (BG_VAR_KEY).
    // importSetByKey races set+comp APIs concurrently → 1 set call + 1 comp call per key.
    expect(setImportCount).toBe(1);
    expect(compImportCount).toBe(1);
    expect(varImportCount).toBe(1);
    // Both instances were created (build phase hit warm cache, no re-import).
    expect(result.made.instances).toBe(2);
    expect(result.made.fail).toBe(0);
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
    async importComponentSetByKeyAsync(key: string) {
      return key === setKey ? componentSet : null;
    },
    async importComponentByKeyAsync() { return null; },
    async loadFontAsync() {},
  };
  // pageRoot + lastInstance are assigned during the run; read after via getters.
  return { figma, get pageRoot() { return pageRoot; }, get lastInstance() { return lastInstance; } };
}

// studio/__tests__/export/figma/buildExecuteScript-instance-fallback.test.ts
// @vitest-environment node
// The pixel FLOOR for mapped components: when the component set can't be
// imported (the cold-import wall), the runtime renders a faithful fallback box
// (fill + label + icon) INSTEAD of drawing nothing. A component never vanishes.
import { describe, it, expect } from "vitest";
import { buildExecuteScript } from "../../../src/export/figma/buildExecuteScript";
import type { SljDocument } from "../../../src/export/slj";
import type { ExecutePlanMaps } from "../../../src/export/figma/executePlan";
import type { FigmaComponentMapping } from "../../../src/export/figma/types";

const bubble: FigmaComponentMapping = {
  arcadeGen: "ChatBubble", status: "mapped", generation: "0.3",
  figma: { componentSetKey: "BUBBLE_KEY", setName: "Bubble" },
  variants: [], textNode: { strategy: "lowest-depth" }, note: "",
};
const MAPS: ExecutePlanMaps = {
  findComponentMapping: (n) => (n === "ChatBubble" ? bubble : null),
  findIconSetKey: () => null,
  findIconSetName: () => null,
  tokenNameToVariableKey: () => null,
};

function runRuntime(code: string, figma: any): Promise<any> {
  const fn = new Function("figma", `return (async () => {\n${code}\n})();`);
  return fn(figma);
}

/** Mock whose component-set imports ALWAYS fail (simulates the cold-import wall).
 *  Records every created node so we can assert the fallback was built. */
function makeFailingImportMock() {
  const nodes: any[] = [];
  let pageRoot: any = null;
  let cc = 0;
  function frameNode() {
    const f: any = {
      type: "FRAME", name: "frame", fills: [], strokes: [], effects: [], opacity: 1,
      clipsContent: true, layoutMode: "NONE", itemSpacing: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      counterAxisAlignItems: "MIN", primaryAxisSizingMode: "AUTO", counterAxisSizingMode: "AUTO",
      x: 0, y: 0, width: 0, height: 0, rotation: 0, cornerRadius: 0,
      strokeTopWeight: 0, strokeRightWeight: 0, strokeBottomWeight: 0, strokeLeftWeight: 0,
      children: [],
      appendChild(n: any) { this.children.push(n); },
      resize(w: number, h: number) { this.width = w; this.height = h; },
      resizeWithoutConstraints(w: number, h: number) { this.width = w; this.height = h; },
    };
    nodes.push(f);
    return f;
  }
  const figma: any = {
    createFrame() { const f = frameNode(); if (cc === 0) pageRoot = f; cc++; return f; },
    createText() { const t: any = { type: "TEXT", x: 0, y: 0, fontName: { family: "Inter", style: "Regular" }, fills: [], characters: "", fontSize: 14, lineHeight: { value: 20, unit: "PIXELS" }, textAutoResize: "NONE", resize() {} }; nodes.push(t); return t; },
    createNodeFromSvg(markup: string) { const s: any = { type: "FRAME", name: "svg", __svg: markup, x: 0, y: 0, width: 0, height: 0, children: [], appendChild() {}, resize(w: number, h: number) { this.width = w; this.height = h; } }; nodes.push(s); return s; },
    createImage() { return { hash: "h" }; },
    currentPage: { appendChild() {}, selection: [] as any[] },
    viewport: { scrollAndZoomIntoView() {} },
    root: { findAllWithCriteria: () => [] },
    // The wall: every set/component import fails.
    async importComponentSetByKeyAsync() { return null; },
    async importComponentByKeyAsync() { return null; },
    async loadFontAsync() {},
    variables: { async importVariableByKeyAsync() { return null; }, setBoundVariableForPaint: (b: any) => b },
  };
  return { figma, nodes, get pageRoot() { return pageRoot; } };
}

describe("buildExecuteScript — instance pixel floor (cold-import wall)", () => {
  const slj = (): SljDocument => ({
    slj: 1, frame: { slug: "f", project: "p", width: 400, mode: "light" },
    root: {
      kind: "element", tag: "div", box: { x: 0, y: 0, width: 400, height: 200 }, layout: null, style: {},
      children: [{
        kind: "component", component: "ChatBubble", source: "arcade/components",
        props: {}, box: { x: 10, y: 20, width: 120, height: 40 }, layout: null,
        children: [{ kind: "element", tag: "text", box: { x: 14, y: 24, width: 80, height: 16 }, layout: null, style: { characters: "Hello", color: "rgb(0,0,0)" }, children: [] }],
        fallbackStyle: { fill: "rgb(240, 240, 240)", cornerRadius: 12 },
        iconSvg: { markup: "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0h4v4H0z'/></svg>", box: { x: 90, y: 24, width: 16, height: 16 } },
      } as any],
    },
  });

  it("renders a faithful fallback box (not nothing) when the set fails to import", async () => {
    const mock = makeFailingImportMock();
    const summary = await runRuntime(buildExecuteScript(slj(), MAPS), mock.figma);
    // The instance was NOT created; it counts as a fail, but pixels were drawn.
    expect(summary.made.instances).toBe(0);
    expect(summary.made.fail).toBe(1);
    // A fallback frame with the captured fill + radius exists.
    const fbFrame = mock.nodes.find((n) => n.type === "FRAME" && n.name === "ChatBubble");
    expect(fbFrame).toBeDefined();
    expect(fbFrame.fills[0]?.type).toBe("SOLID");
    expect(fbFrame.fills[0].color.r).toBeCloseTo(240 / 255, 2);
    expect(fbFrame.cornerRadius).toBe(12);
    // The label text was rendered.
    const txt = mock.nodes.find((n) => n.type === "TEXT" && n.characters === "Hello");
    expect(txt).toBeDefined();
    // The glyph SVG was rendered.
    const svg = mock.nodes.find((n) => n.__svg && n.__svg.indexOf("path") >= 0);
    expect(svg).toBeDefined();
  });

  it("does NOT render both an instance and a fallback (no double-render) — set fail path only builds fallback", async () => {
    const mock = makeFailingImportMock();
    await runRuntime(buildExecuteScript(slj(), MAPS), mock.figma);
    // No INSTANCE-typed node ever created (import always fails).
    const anyInstance = mock.nodes.find((n) => n.type === "INSTANCE");
    expect(anyInstance).toBeUndefined();
    // Exactly one fallback frame named for the component.
    const fbFrames = mock.nodes.filter((n) => n.type === "FRAME" && n.name === "ChatBubble");
    expect(fbFrames).toHaveLength(1);
  });
});

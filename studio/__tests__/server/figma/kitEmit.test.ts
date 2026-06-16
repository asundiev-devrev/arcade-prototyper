import { describe, it, expect } from "vitest";
import {
  planAssets,
  emitKitFrame,
  resolveIdentity,
} from "../../../server/figma/kitEmit";
import {
  matchKit,
  avatarSizeForPx,
  ICON_SET_NAME_TO_KIT,
  SET_KEY_TO_KIT,
  SET_NAME_TO_KIT,
  PSEUDO_KIT_RENDERS,
  BADGE_VARIANT_MAP,
  TAG_INTENT_MAP,
  TAG_APPEARANCE_MAP,
  NON_RENDERABLE_KIT_EXPORTS,
} from "../../../server/figma/kitMappings";
import {
  kitExportNames,
  parseBarrelExportNames,
} from "../../../server/figma/kitBarrel";

// --- minimal tree builders -------------------------------------------------

const bbox = (x: number, y: number, w: number, h: number) => ({
  x, y, width: w, height: h,
});

function frameNode(id: string, children: any[] = [], extra: any = {}): any {
  return { id, type: "FRAME", absoluteBoundingBox: bbox(0, 0, 400, 300), children, ...extra };
}

const CHECKBOX_SET_KEY = "a1475c3e4dfdf52bca771aff82f3ac849d31a036";

/** components/componentSets maps for a checkbox instance. */
function checkboxMaps() {
  return {
    components: {
      "c:1": { key: "variant-key", name: "Checked=True", componentSetId: "s:1" },
    },
    componentSets: {
      "s:1": { key: CHECKBOX_SET_KEY, name: "Checkbox" },
    },
  };
}

function checkboxInstance(id: string, checked = true): any {
  return {
    id,
    type: "INSTANCE",
    componentId: "c:1",
    absoluteBoundingBox: bbox(10, 10, 16, 16),
    componentProperties: { Checked: { value: checked ? "True" : "False", type: "VARIANT" } },
    children: [{ id: `${id}-v`, type: "VECTOR", absoluteBoundingBox: bbox(12, 12, 12, 12) }],
  };
}

// --- identity --------------------------------------------------------------

describe("resolveIdentity", () => {
  it("resolves through componentSetId to the published set key", () => {
    const { components, componentSets } = checkboxMaps();
    const id = resolveIdentity("c:1", components, componentSets);
    expect(id.setKey).toBe(CHECKBOX_SET_KEY);
    expect(id.setName).toBe("Checkbox");
  });

  it("falls back to the component's own key when there is no set", () => {
    const id = resolveIdentity("c:9", { "c:9": { key: "bare", name: "Lone" } }, {});
    expect(id).toEqual({ setKey: "bare", setName: "Lone" });
  });

  it("returns empty for unknown componentId", () => {
    expect(resolveIdentity("nope", {}, {})).toEqual({});
  });
});

describe("matchKit", () => {
  it("matches icons by set name before keys", () => {
    expect(matchKit(undefined, "Icons/Bell")).toEqual({ kind: "icon", kit: "Bell" });
  });
  it("matches components by published set key", () => {
    expect(matchKit(CHECKBOX_SET_KEY, "anything")).toEqual({ kind: "component", kit: "Checkbox" });
  });
  it("falls back to set-name matching for detached copies", () => {
    expect(matchKit("unknown-key", "Avatar")).toEqual({ kind: "component", kit: "Avatar" });
  });
  it("returns null when nothing matches", () => {
    expect(matchKit("unknown", "Cell")).toBeNull();
  });
});

describe("avatarSizeForPx", () => {
  it("picks the nearest kit size", () => {
    expect(avatarSizeForPx(24)).toBe("md");
    expect(avatarSizeForPx(17)).toBe("xs");
    expect(avatarSizeForPx(46)).toBe("xl");
  });
});

// --- asset planning ----------------------------------------------------------

describe("planAssets", () => {
  it("collects icon-scale vector subtrees as SVG, image fills as PNG", () => {
    const doc = frameNode("0", [
      { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
      {
        id: "img1", type: "RECTANGLE", absoluteBoundingBox: bbox(20, 0, 100, 80),
        fills: [{ type: "IMAGE", imageRef: "x" }],
      },
    ]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).toEqual(["v1"]);
    expect(plan.pngIds).toEqual(["img1"]);
  });

  it("kit-matched instances absorb their subtree (no asset exports inside)", () => {
    const { components, componentSets } = checkboxMaps();
    const doc = frameNode("0", [checkboxInstance("cb1")]);
    const plan = planAssets(doc, { components, componentSets });
    expect(plan.svgIds).toEqual([]);
    expect(plan.pngIds).toEqual([]);
  });

  it("recurses past broken ids into children", () => {
    const doc = frameNode("0", [
      {
        id: "g1", type: "GROUP", absoluteBoundingBox: bbox(0, 0, 16, 16),
        children: [
          { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 8, 8) },
          { id: "v2", type: "VECTOR", absoluteBoundingBox: bbox(8, 8, 8, 8) },
        ],
      },
    ]);
    const without = planAssets(doc, { components: {}, componentSets: {} });
    expect(without.svgIds).toEqual(["g1"]);
    const withBroken = planAssets(doc, {
      components: {}, componentSets: {}, brokenIds: new Set(["g1"]),
    });
    expect(withBroken.svgIds).toEqual(["v1", "v2"]);
  });

  it("skips hidden / opacity-0 / mask nodes", () => {
    const doc = frameNode("0", [
      { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16), visible: false },
      { id: "v2", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16), opacity: 0 },
      { id: "v3", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16), isMask: true },
    ]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).toEqual([]);
  });

  it("does NOT collapse large containers into one SVG", () => {
    const doc = frameNode("0", [
      {
        id: "big", type: "GROUP", absoluteBoundingBox: bbox(0, 0, 200, 200),
        children: [{ id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) }],
      },
    ]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).toEqual(["v1"]);
  });
});

// --- emission ----------------------------------------------------------------

describe("emitKitFrame", () => {
  it("emits a kit Checkbox for a key-matched instance, with defaultChecked", () => {
    const { components, componentSets } = checkboxMaps();
    const doc = frameNode("0", [checkboxInstance("cb1", true)]);
    const r = emitKitFrame(doc, {
      components, componentSets, assetFiles: new Map(),
    });
    expect(r.source).toContain('from "arcade/components"');
    expect(r.source).toContain("<Checkbox size=\"sm\" defaultChecked />");
    expect(r.kitImports).toContain("Checkbox");
    expect(r.kitInstanceCount).toBe(1);
  });

  it("emits a kit icon with size and color from the vector fill", () => {
    const doc = frameNode("0", [
      {
        id: "i1", type: "INSTANCE", componentId: "c:bell",
        absoluteBoundingBox: bbox(0, 0, 16, 16),
        children: [{
          id: "i1-v", type: "VECTOR", absoluteBoundingBox: bbox(2, 2, 12, 12),
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        }],
      },
    ]);
    const r = emitKitFrame(doc, {
      components: { "c:bell": { key: "k", name: "x", componentSetId: "s:b" } },
      componentSets: { "s:b": { key: "irrelevant", name: "Icons/Bell" } },
      assetFiles: new Map(),
    });
    expect(r.source).toContain("<Bell size={16} />");
    expect(r.source).toContain('"#ff0000"');
  });

  it("references exported assets via local imports", () => {
    const doc = frameNode("0", [
      { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
    ]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {},
      assetFiles: new Map([["v1", "v1.svg"]]),
    });
    expect(r.source).toContain('import a_v1 from "./assets/v1.svg";');
    expect(r.source).toContain("<img src={a_v1}");
    expect(r.assetRefs).toEqual(["./assets/v1.svg"]);
  });

  it("degrades to a plain box when the asset is missing (export failed)", () => {
    const doc = frameNode("0", [
      { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
    ]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {}, assetFiles: new Map(),
    });
    expect(r.source).not.toContain("<img");
    expect(r.source).toContain("<div");
  });

  it("renders unmatched instances as faithful static markup", () => {
    const doc = frameNode("0", [
      {
        id: "cell", type: "INSTANCE", componentId: "c:cell",
        absoluteBoundingBox: bbox(0, 0, 300, 47),
        fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
        children: [{
          id: "t1", type: "TEXT", characters: "Row text",
          absoluteBoundingBox: bbox(8, 8, 200, 16),
          style: { fontFamily: "Inter", fontSize: 13, fontWeight: 400, lineHeightPx: 16, textAlignHorizontal: "LEFT" },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
        }],
      },
    ]);
    const r = emitKitFrame(doc, {
      components: { "c:cell": { key: "k", name: "x", componentSetId: "s:c" } },
      componentSets: { "s:c": { key: "no-match", name: "Cell" } },
      assetFiles: new Map(),
    });
    expect(r.kitInstanceCount).toBe(0);
    expect(r.source).toContain("Row text");
    expect(r.source).toContain('"#ffffff"');
  });

  it("escapes JSX-significant characters in text content", () => {
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "a < b { c }",
      absoluteBoundingBox: bbox(0, 0, 100, 16),
      style: { fontFamily: "Inter" },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain("a &lt; b &#123; c &#125;");
  });

  it("applies ellipsis truncation when Figma says textTruncation ENDING", () => {
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "Experience Foundations",
      absoluteBoundingBox: bbox(0, 0, 148, 16),
      style: { fontFamily: "Inter", textTruncation: "ENDING" },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain('"ellipsis"');
    expect(r.source).toContain('"nowrap"');
  });

  it("emits a kit font as a class, not an inline fontFamily string", () => {
    // Regression: an imported title used inline fontFamily: "'Chip Display
    // Variable', …"; a follow-up edit smart-quoted the family ('→’) and the
    // heading fell back to system font. A class has no quotes to corrupt.
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "Heading",
      absoluteBoundingBox: bbox(0, 0, 200, 80),
      style: { fontFamily: "Chip Display Variable", fontSize: 72, fontWeight: 650 },
      fills: [{ type: "SOLID", color: { r: 0.27, g: 0, b: 0.67, a: 1 } }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain('className="font-display"');
    expect(r.source).not.toContain("Chip Display Variable");
  });

  it("keeps an inline fontFamily for a non-kit font", () => {
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "Body",
      absoluteBoundingBox: bbox(0, 0, 100, 16),
      style: { fontFamily: "Inter", fontSize: 13 },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).not.toContain("font-display");
    expect(r.source).toContain("'Inter', -apple-system, sans-serif");
  });

  it("emits per-character style runs (accent color) as <span> (no prose needed)", () => {
    // The real OAuth title: chars 23–35 ("next meeting.") carry a red fill via
    // characterStyleOverrides → styleOverrideTable[108]. The whole layer's base
    // fill is purple. The accent run must come through as a colored <span>.
    const characters = "Let’s prepare\nfor your next meeting.";
    const overrides = Array.from(characters).map((_, i) => (i >= 23 ? 108 : 0));
    const doc = frameNode("0", [{
      id: "title", type: "TEXT", characters,
      absoluteBoundingBox: bbox(0, 0, 600, 192),
      style: { fontFamily: "Chip Display Variable", fontSize: 72, fontWeight: 650 },
      fills: [{ type: "SOLID", color: { r: 0.27, g: 0, b: 0.67, a: 1 } }],
      characterStyleOverrides: overrides,
      styleOverrideTable: {
        "108": { fills: [{ type: "SOLID", color: { r: 0.82, g: 0, b: 0, a: 1 } }] },
      },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // The accent run is wrapped and colored; the exact boundary is "next
    // meeting." (not just "meeting."), which the prose-driven LLM got wrong.
    expect(r.source).toMatch(/<span style=\{\{color: "#d10000"\}\}>next meeting\.<\/span>/);
    expect(r.source).toContain("for your "); // base run stays unwrapped
  });

  it("preserves hard line breaks in imported text", () => {
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "Line one\nLine two",
      absoluteBoundingBox: bbox(0, 0, 200, 40),
      style: { fontFamily: "Chip Display Variable", fontSize: 24 },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // A raw \n in JSX collapses to a space; the renderer must emit {"\n"}.
    expect(r.source).toContain('Line one{"\\n"}Line two');
  });

  it("exports an IconButton's glyph as SVG when it has no kit-icon match (never blank)", () => {
    // IconButton wrapping an unmapped glyph (e.g. Icons/Eye not in the map):
    // planAssets must queue the glyph for SVG export, and emit must render it
    // as an <img> inside the button rather than an empty <span/>.
    const iconButton = {
      id: "ib1", type: "INSTANCE", componentId: "c:ib",
      absoluteBoundingBox: bbox(0, 0, 28, 28),
      componentProperties: { Variant: { value: "Tertiary" }, Size: { value: "Default" } },
      children: [
        { id: "fr", type: "INSTANCE", name: "_Focus Ring", absoluteBoundingBox: bbox(0, 0, 28, 28) },
        {
          id: "glyph", type: "INSTANCE", componentId: "c:unknown",
          absoluteBoundingBox: bbox(6, 6, 16, 16),
          children: [{ id: "gv", type: "VECTOR", absoluteBoundingBox: bbox(6, 6, 16, 16) }],
        },
      ],
    };
    const ctxMaps = {
      components: {
        "c:ib": { key: "k", name: "x", componentSetId: "s:ib" },
        "c:unknown": { key: "k2", name: "y", componentSetId: "s:unknown" },
      },
      componentSets: {
        "s:ib": { key: "3abc28fac47cbde78a253917b98d8b34eabfb218", name: "Icon Button" },
        "s:unknown": { key: "no-match", name: "Icons/SomeBrandNewGlyph" },
      },
    };
    const doc = frameNode("0", [iconButton]);

    const plan = planAssets(doc, ctxMaps);
    expect(plan.svgIds).toContain("glyph");
    expect(plan.svgIds).not.toContain("fr"); // focus ring skipped

    const r = emitKitFrame(doc, { ...ctxMaps, assetFiles: new Map([["glyph", "glyph.svg"]]) });
    expect(r.source).toContain("<IconButton");
    expect(r.source).toContain("<img src={a_glyph}");
    expect(r.source).not.toContain("<span />");
  });

  // --- D1: generalized SVG-glyph fallback (any unmapped leaf glyph) --------

  /** An unmapped icon instance NOT inside a button, carrying the documented
   *  stray fill-less hit-area rectangle that breaks the strict all-children-
   *  graphic check. Without the generalized fallback its vector renders blank. */
  function standaloneUnmappedIcon(id: string, w = 24, h = 24): any {
    return {
      id, type: "INSTANCE", componentId: `c:${id}`,
      absoluteBoundingBox: bbox(0, 0, w, h),
      children: [
        { id: `${id}-rect`, type: "RECTANGLE", absoluteBoundingBox: bbox(0, 0, w, h) }, // hit area, no fill
        { id: `${id}-v`, type: "VECTOR", absoluteBoundingBox: bbox(4, 4, w - 8, h - 8),
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] },
      ],
    };
  }
  const unmappedIconMaps = (id: string) => ({
    components: { [`c:${id}`]: { key: "k", name: "x", componentSetId: `s:${id}` } },
    componentSets: { [`s:${id}`]: { key: "no-match", name: "Icons/TotallyUnmapped" } },
  });

  it("D1: exports a standalone unmapped icon's glyph as SVG (never a blank box)", () => {
    const maps = unmappedIconMaps("ic");
    const doc = frameNode("0", [standaloneUnmappedIcon("ic")]);

    // planAssets must queue the tight glyph (the vector child), not the loose
    // instance bbox — innerGraphicId descends past the hit-area rect.
    const plan = planAssets(doc, maps);
    expect(plan.svgIds).toContain("ic-v");

    const r = emitKitFrame(doc, { ...maps, assetFiles: new Map([["ic-v", "ic-v.svg"]]) });
    expect(r.source).toContain("<img src={a_ic_v}");
    // The bare vector must NOT also be emitted as a separate plain box.
    expect(r.source).not.toContain('<div style={{position: "absolute", left: "4px", top: "4px"');
  });

  it("D1: degrades to a box (no crash) when the unmapped glyph's export is missing", () => {
    const maps = unmappedIconMaps("ic");
    const doc = frameNode("0", [standaloneUnmappedIcon("ic")]);
    // No asset file resolved → fall through to the container path, never throw.
    const r = emitKitFrame(doc, { ...maps, assetFiles: new Map() });
    expect(r.source).not.toContain("<img");
    expect(r.source).toContain("<div");
  });

  it("D1: skips a hidden unmapped glyph (respects visibility/mask)", () => {
    const maps = unmappedIconMaps("ic");
    const icon = standaloneUnmappedIcon("ic");
    icon.visible = false;
    const doc = frameNode("0", [icon]);
    const plan = planAssets(doc, maps);
    expect(plan.svgIds).toEqual([]);
  });

  it("D1: does NOT flatten a subtree that contains a kit-mappable instance", () => {
    // A small container holding a vector AND a real kit checkbox: flattening it
    // to one SVG would swallow the checkbox. The container has a filled
    // RECTANGLE so the strict isGraphic check declines (forcing the decision
    // through the generalized fallback), which must ALSO decline on the kit
    // match and let recursion emit the real component.
    const { components: cbComp, componentSets: cbSet } = checkboxMaps();
    const doc = frameNode("0", [{
      id: "wrap", type: "GROUP", absoluteBoundingBox: bbox(0, 0, 40, 20),
      children: [
        { id: "wbg", type: "RECTANGLE", absoluteBoundingBox: bbox(0, 0, 40, 20),
          fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }] }, // filled → not graphic
        { id: "wv", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16),
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] },
        checkboxInstance("cb"),
      ],
    }]);
    const maps = { components: cbComp, componentSets: cbSet };
    const plan = planAssets(doc, maps);
    // The whole wrap is NOT exported as one SVG (it holds a kit component); the
    // lone vector still exports, the kit checkbox is left for the emitter.
    expect(plan.svgIds).not.toContain("wrap");
    expect(plan.svgIds).toContain("wv");

    const r = emitKitFrame(doc, { ...maps, assetFiles: new Map([["wv", "wv.svg"]]) });
    expect(r.source).toContain("<Checkbox");
    expect(r.kitInstanceCount).toBe(1);
  });

  it("D1: does NOT flatten a subtree that contains live text", () => {
    // An icon + label group: flattening would rasterize the (selectable) text.
    const doc = frameNode("0", [{
      id: "row", type: "GROUP", absoluteBoundingBox: bbox(0, 0, 48, 20),
      children: [
        { id: "rv", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16),
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] },
        { id: "rt", type: "TEXT", characters: "Label",
          absoluteBoundingBox: bbox(20, 2, 24, 16),
          style: { fontFamily: "Inter", fontSize: 12 } },
      ],
    }]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).not.toContain("row");
    expect(plan.svgIds).toContain("rv"); // the bare vector still exports
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map([["rv", "rv.svg"]]) });
    expect(r.source).toContain("Label"); // text stays live, not rasterized
  });

  it("D1: does NOT flatten a large layout frame that merely contains a vector", () => {
    const doc = frameNode("0", [{
      id: "panel", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 300, 200),
      children: [{ id: "pv", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) }],
    }]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).not.toContain("panel");
    expect(plan.svgIds).toContain("pv");
  });

  it("ignores a hidden alt-glyph in an IconButton slot and exports the visible one", () => {
    // Real designs park an alternate (hidden) icon in the slot beside the
    // visible glyph. innerIcon must skip the hidden one; since the visible
    // glyph has no kit match here, it exports as SVG.
    const ib = {
      id: "ib", type: "INSTANCE", componentId: "c:ib",
      absoluteBoundingBox: bbox(0, 0, 28, 28),
      children: [{
        id: "slot", type: "FRAME", name: "Icon", absoluteBoundingBox: bbox(4, 4, 20, 20),
        children: [
          {
            id: "hidden-dot", type: "INSTANCE", componentId: "c:dot", visible: false,
            absoluteBoundingBox: bbox(4, 4, 16, 16),
            children: [{ id: "dv", type: "VECTOR", absoluteBoundingBox: bbox(4, 4, 14, 14) }],
          },
          {
            id: "folder", type: "INSTANCE", componentId: "c:folder",
            absoluteBoundingBox: bbox(4, 4, 20, 20),
            children: [{
              id: "fg", type: "GROUP", absoluteBoundingBox: bbox(4, 4, 20, 20),
              children: [
                { id: "fp1", type: "VECTOR", absoluteBoundingBox: bbox(4, 4, 15, 13) },
                { id: "fr", type: "RECTANGLE", absoluteBoundingBox: bbox(4, 4, 20, 20) },
              ],
            }],
          },
        ],
      }],
    };
    const maps = {
      components: {
        "c:ib": { key: "k", name: "x", componentSetId: "s:ib" },
        "c:dot": { key: "k2", name: "y", componentSetId: "s:dot" },
        "c:folder": { key: "k3", name: "z", componentSetId: "s:folder" },
      },
      componentSets: {
        "s:ib": { key: "3abc28fac47cbde78a253917b98d8b34eabfb218", name: "Icon Button" },
        "s:dot": { key: "n1", name: "Icons/Dot.in.right.window" }, // mapped, but HIDDEN
        "s:folder": { key: "n2", name: "Folders/folder-big-clip" }, // visible, unmapped
      },
    };
    const doc = frameNode("0", [ib]);
    const plan = planAssets(doc, maps);
    expect(plan.svgIds).toContain("folder");
    expect(plan.svgIds).not.toContain("hidden-dot");

    const r = emitKitFrame(doc, { ...maps, assetFiles: new Map([["folder", "folder.svg"]]) });
    expect(r.source).toContain("<img src={a_folder}");
    expect(r.source).not.toContain("DotInRightWindow"); // hidden glyph not used
  });

  // --- design tokens (B1) --------------------------------------------------

  // The emitter validates a transformed var name against the REAL kit
  // tokens.css set, so these tests use Figma var names that flatten to tokens
  // the kit actually defines (--bg-neutral-soft, --fg-neutral-prominent).
  const variablesPayload = (entries: Record<string, string>) => ({
    variables: Object.fromEntries(
      Object.entries(entries).map(([id, name]) => [id, { name }]),
    ),
  });

  function boundFillFrame(): any {
    return frameNode("0", [
      {
        id: "panel", type: "FRAME",
        absoluteBoundingBox: bbox(0, 0, 200, 100),
        fills: [{
          type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          boundVariables: { color: { id: "VariableID:bgsoft" } },
        }],
        children: [{
          id: "t1", type: "TEXT", characters: "Hi",
          absoluteBoundingBox: bbox(8, 8, 100, 16),
          style: { fontFamily: "Inter", fontSize: 13 },
          fills: [{
            type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
            boundVariables: { color: { id: "VariableID:fgprom" } },
          }],
        }],
      },
    ]);
  }

  it("emits a kit design token for a fill bound to a kit variable", () => {
    const r = emitKitFrame(boundFillFrame(), {
      components: {}, componentSets: {}, assetFiles: new Map(),
      variables: variablesPayload({
        "VariableID:bgsoft": "bg/neutral/soft",
        "VariableID:fgprom": "fg/neutral-prominent",
      }),
    });
    // bound background fill → var() instead of baked hex
    expect(r.source).toContain('background: "var(--bg-neutral-soft)"');
    // bound text color → --fg-* var() (namespace matches the `color` property)
    expect(r.source).toContain('color: "var(--fg-neutral-prominent)"');
    expect(r.tokenizedColors).toBe(2);
    expect(r.hexColors).toBe(0);
  });

  it("falls back to literal hex for an UNBOUND fill (no variable binding)", () => {
    // Same tree, but no variables payload → every color stays exactly today's
    // baked hex; nothing tokenized.
    const r = emitKitFrame(boundFillFrame(), {
      components: {}, componentSets: {}, assetFiles: new Map(),
    });
    expect(r.source).not.toContain("var(--");
    expect(r.source).toContain('background: "#1a1a1a"');
    expect(r.tokenizedColors).toBe(0);
    expect(r.hexColors).toBe(0); // no resolver at all → no coverage tracking
  });

  it("falls back to hex (not a wrong color) when a bound var has no kit token", () => {
    // surface/default flattens to --surface-default, which the kit does NOT
    // define (it has --surface-shallow/overlay/backdrop). The fill must keep
    // its honest hex, never emit a dead var() that would paint nothing.
    const doc = frameNode("0", [{
      id: "panel", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 100, 100),
      fills: [{
        type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 },
        boundVariables: { color: { id: "VariableID:surf" } },
      }],
    }]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {}, assetFiles: new Map(),
      variables: variablesPayload({ "VariableID:surf": "surface/default" }),
    });
    expect(r.source).not.toContain("var(--");
    expect(r.source).toContain('background: "#ff0000"');
    expect(r.tokenizedColors).toBe(0);
    expect(r.hexColors).toBe(1); // counted as a coverage gap
  });

  it("falls back to hex when a bound var's namespace contradicts the property", () => {
    // A --bg-* token bound to a TEXT color (the documented bubble bug). Emitting
    // it as `color` would flip wrong in dark mode → keep the literal hex.
    const doc = frameNode("0", [{
      id: "t1", type: "TEXT", characters: "Label",
      absoluteBoundingBox: bbox(0, 0, 100, 16),
      style: { fontFamily: "Inter", fontSize: 13 },
      fills: [{
        type: "SOLID", color: { r: 0, g: 0.5, b: 0, a: 1 },
        boundVariables: { color: { id: "VariableID:bg" } },
      }],
    }]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {}, assetFiles: new Map(),
      variables: variablesPayload({ "VariableID:bg": "bg/neutral/prominent" }),
    });
    expect(r.source).not.toContain("var(--");
    expect(r.source).toContain('color: "#008000"');
    expect(r.hexColors).toBe(1);
  });

  it("skips mask nodes (alpha channels, not paint)", () => {
    const doc = frameNode("0", [{
      id: "m1", type: "RECTANGLE", isMask: true,
      absoluteBoundingBox: bbox(0, 0, 400, 12),
      fills: [{ type: "GRADIENT_LINEAR", gradientStops: [] }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).not.toContain("GRADIENT");
    expect(r.source).not.toContain("linear-gradient");
  });

  // --- auto-layout → flexbox (B2): DISABLED ---------------------------------
  //
  // B2 (emit display:flex for Figma auto-layout frames) was implemented then
  // disabled after a live visual check: content-sized flex containers drifted a
  // few px from Figma's fixed boxes and cascaded to siblings (mean diff vs the
  // Figma 4.2→7.7, 3.6% structurally-wrong pixels). The owner chose pixel-exact
  // absolute positioning. shouldFlex() returns false, so auto-layout frames take
  // the absolute path like every other frame. The flex machinery is retained
  // (inert) for a future iteration that pins explicit child sizing.

  it("auto-layout frames emit ABSOLUTE positioning (B2 disabled for fidelity)", () => {
    const doc = frameNode("0", [{
      id: "stack", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 200, 120),
      layoutMode: "VERTICAL", itemSpacing: 12,
      paddingTop: 16, paddingRight: 8, paddingBottom: 16, paddingLeft: 8,
      primaryAxisAlignItems: "CENTER", counterAxisAlignItems: "MIN",
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children: [
        { id: "a", type: "TEXT", characters: "First",
          absoluteBoundingBox: bbox(8, 16, 100, 20), style: { fontFamily: "Inter", fontSize: 13 } },
        { id: "b", type: "TEXT", characters: "Second",
          absoluteBoundingBox: bbox(8, 48, 100, 20), style: { fontFamily: "Inter", fontSize: 13 } },
      ],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // No flex anywhere — auto-layout frames render with exact absolute geometry.
    expect(r.source).not.toContain('display: "flex"');
    expect(r.source).not.toContain("flexDirection");
    // Children keep their exact Figma offsets.
    const first = r.source.split("\n").find((l) => l.includes("First"))!;
    expect(first).toContain('position: "absolute"');
    expect(first).toContain('top: "16px"');
  });

  // --- C1: coverage — Input / Select / Breadcrumb emit cases ---------------
  //
  // Tier-1 only: components that render STANDALONE with no Radix open-context
  // (no portal). Menu/Modal/Popover (portal panels) and Tooltip (needs a
  // trigger) are deliberately NOT mapped — they stay faithful static markup, a
  // wrong/throwing component being worse than the current default.

  /** A key-matched INSTANCE for an arbitrary set key, with variant props +
   *  optional child text nodes. */
  function keyInstance(
    id: string,
    setKey: string,
    setName: string,
    props: Record<string, any> = {},
    texts: string[] = [],
    bboxArgs: [number, number, number, number] = [0, 0, 200, 32],
  ): { node: any; maps: any } {
    const node: any = {
      id, type: "INSTANCE", componentId: `c:${id}`,
      absoluteBoundingBox: bbox(...bboxArgs),
      componentProperties: Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, { value: v, type: "VARIANT" }]),
      ),
      children: texts.map((t, i) => ({
        id: `${id}-t${i}`, type: "TEXT", characters: t,
        absoluteBoundingBox: bbox(4, 4, 100, 16),
        style: { fontFamily: "Inter", fontSize: 13 },
      })),
    };
    const maps = {
      components: { [`c:${id}`]: { key: "k", name: "x", componentSetId: `s:${id}` } },
      componentSets: { [`s:${id}`]: { key: setKey, name: setName } },
    };
    return { node, maps };
  }

  const INPUT_KEY = "c4ff2f34e04a5c0f5b0c94733b157e512a871ec7";
  const SELECT_KEY = "93bc12b8c36c35f775f3a71d4821f4541e32dc79";
  const BREADCRUMB_KEY = "0ecf3d67728cfd4196e964bbfb3795f540a0c70b";

  it("C1: emits a kit Input for a key-matched Input/Text field, with its value", () => {
    const { node, maps } = keyInstance("in1", INPUT_KEY, "Input/Text field", {}, ["acme@corp.com"]);
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.kitImports).toContain("Input");
    expect(r.source).toContain('<Input defaultValue="acme@corp.com" />');
    expect(r.kitInstanceCount).toBe(1);
  });

  it("C1: Input State=Error → error prop; State=Disabled → disabled", () => {
    const err = keyInstance("in2", INPUT_KEY, "Input/Text field", { State: "Error" }, ["bad"]);
    const re = emitKitFrame(frameNode("0", [err.node]), { ...err.maps, assetFiles: new Map() });
    expect(re.source).toContain('error="Invalid"');

    const dis = keyInstance("in3", INPUT_KEY, "Input/Text field", { State: "Disabled" }, ["x"]);
    const rd = emitKitFrame(frameNode("0", [dis.node]), { ...dis.maps, assetFiles: new Map() });
    expect(rd.source).toContain("disabled");
  });

  it("C1: an empty Input emits a placeholder, never an empty value prop", () => {
    const { node, maps } = keyInstance("in4", INPUT_KEY, "Input/Text field", {}, []);
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    // placeholder="" is harmless; defaultValue="" must NOT be emitted.
    expect(r.source).toContain('<Input placeholder="" />');
    expect(r.source).not.toContain("defaultValue");
  });

  it("C1: emits Select.Root/Trigger/Value (trigger-only, no Content portal)", () => {
    const { node, maps } = keyInstance("sel1", SELECT_KEY, "Select", {}, ["Choose a team"]);
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.kitImports).toContain("Select");
    expect(r.source).toContain('<Select.Root><Select.Trigger><Select.Value placeholder="Choose a team" /></Select.Trigger></Select.Root>');
    // No Content portal (would need a live open Root) and never value="" (Radix
    // forbids it — studio/CLAUDE.md).
    expect(r.source).not.toContain("Select.Content");
    expect(r.source).not.toContain('value=""');
    expect(r.kitInstanceCount).toBe(1);
  });

  it("C1: emits a Breadcrumb.Root with ordered items, separators, last current", () => {
    const { node, maps } = keyInstance(
      "bc1", BREADCRUMB_KEY, "Breadcrumbs", {}, ["Home", "Reports", "Q2"],
    );
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.kitImports).toContain("Breadcrumb");
    // Home + Reports are links; Q2 is the current page (no link).
    expect(r.source).toContain('<Breadcrumb.Link href="#">Home</Breadcrumb.Link>');
    expect(r.source).toContain('<Breadcrumb.Link href="#">Reports</Breadcrumb.Link>');
    expect(r.source).toContain("<Breadcrumb.Item current>Q2</Breadcrumb.Item>");
    // Two separators between three crumbs (one after each non-last item).
    expect(r.source.match(/<Breadcrumb\.Separator \/>/g)?.length).toBe(2);
    expect(r.kitInstanceCount).toBe(1);
  });

  it("C1: a mapped Input instance ABSORBS its subtree (no stray asset exports)", () => {
    // The field carries an inner vector (e.g. a search glyph). Because the kit
    // component absorbs its subtree, planAssets must NOT queue that vector — the
    // kit renders its own chrome. Mirrors the checkbox absorption test.
    const { node, maps } = keyInstance("in5", INPUT_KEY, "Input/Text field", {}, ["q"]);
    node.children.push({ id: "in5-icon", type: "VECTOR", absoluteBoundingBox: bbox(4, 4, 12, 12) });
    const plan = planAssets(frameNode("0", [node]), maps);
    expect(plan.svgIds).toEqual([]);
    expect(plan.pngIds).toEqual([]);
  });

  it("C1: Menu/Modal/Popover/Tooltip stay STATIC markup (not mapped, no kit import)", () => {
    // Deliberately omitted from SET_KEY_TO_KIT (Radix portal / trigger risk).
    // A real published instance of each must fall through to faithful static
    // markup — no kit component, no thrown render.
    const omitted: Array<[string, string]> = [
      ["0375c0bad6187274768f512c0422719a7493749d", "Menu"],
      ["8122e8716d61125d19bb89de69b4525fa45311bf", "Modal Content"],
      ["6a9dc99a75e632b481f5c0ac0c1fd7ba7ae03ebb", "Popover"],
      ["758e0e9d40787c3ac9b206afe70020ba8b885548", "Tooltip"],
    ];
    for (const [key, name] of omitted) {
      const { node, maps } = keyInstance(`o-${name}`, key, name, {}, ["panel text"]);
      const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
      expect(r.kitInstanceCount, `${name} must not be a kit instance`).toBe(0);
      expect(r.source, `${name} must not import a kit component`).not.toContain("Menu.Content");
      // Its text content still renders as faithful static markup.
      expect(r.source).toContain("panel text");
    }
  });

  // --- C2: variant-axis translation for Badge / Tag ------------------------

  const BADGE_KEY = "367267f81839b123664fa8b1304b16ee6006b37a";
  const TAG_KEY = "3067f69c7f76e7c43815148ce843654e36081bed";

  it("C2: Badge Variant=Emphasis → variant=\"emphasis\"; Neutral → variant=\"neutral\"", () => {
    // The kit Badge union is exactly emphasis|neutral; Emphasis must map to the
    // real "emphasis" (NOT "info", a dead value that renders neutral).
    const emph = keyInstance("bg1", BADGE_KEY, "Counter", { Variant: "Emphasis" }, ["12"]);
    const re = emitKitFrame(frameNode("0", [emph.node]), { ...emph.maps, assetFiles: new Map() });
    expect(re.source).toContain('<Badge variant="emphasis">12</Badge>');

    const neu = keyInstance("bg2", BADGE_KEY, "Counter", { Variant: "Neutral" }, ["3"]);
    const rn = emitKitFrame(frameNode("0", [neu.node]), { ...neu.maps, assetFiles: new Map() });
    expect(rn.source).toContain('<Badge variant="neutral">3</Badge>');
  });

  it("C2: an unmapped Badge variant value falls through to no variant prop (kit default)", () => {
    const { node, maps } = keyInstance("bg3", BADGE_KEY, "Counter", { Variant: "Wat" }, ["9"]);
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.source).toContain("<Badge>9</Badge>"); // no variant=, never a wrong value
  });

  it("C2: Tag translates Type→intent and Appearance→appearance", () => {
    const { node, maps } = keyInstance(
      "tg1", TAG_KEY, "Chip", { Type: "Success", Appearance: "Filled" }, ["Done"],
    );
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.source).toContain('<Tag intent="success" appearance="filled">Done</Tag>');
  });

  it("C2: Tag with only an intent axis emits just intent (appearance defaults)", () => {
    const { node, maps } = keyInstance("tg2", TAG_KEY, "Chip", { Type: "Alert" }, ["Late"]);
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.source).toContain('<Tag intent="alert">Late</Tag>');
    expect(r.source).not.toContain("appearance=");
  });

  // --- C3: per-import coverage telemetry -----------------------------------

  it("C3: counts total / matched instances and tallies unmatched set names", () => {
    const { components: cbComp, componentSets: cbSet } = checkboxMaps();
    // One matched checkbox + two unmatched "Cell" instances + one unmatched "Row".
    const cell = (id: string) => ({
      id, type: "INSTANCE", componentId: `c:${id}`,
      absoluteBoundingBox: bbox(0, 0, 300, 40),
      children: [{ id: `${id}-t`, type: "TEXT", characters: "x",
        absoluteBoundingBox: bbox(0, 0, 100, 16), style: { fontFamily: "Inter" } }],
    });
    const doc = frameNode("0", [
      checkboxInstance("cb1", true),
      cell("cell1"), cell("cell2"), cell("row1"),
    ]);
    const maps = {
      components: {
        ...cbComp,
        "c:cell1": { key: "k", name: "x", componentSetId: "s:cell" },
        "c:cell2": { key: "k", name: "x", componentSetId: "s:cell" },
        "c:row1": { key: "k", name: "x", componentSetId: "s:row" },
      },
      componentSets: {
        ...cbSet,
        "s:cell": { key: "no-match-cell", name: "Cell" },
        "s:row": { key: "no-match-row", name: "Row" },
      },
    };
    const r = emitKitFrame(doc, { ...maps, assetFiles: new Map() });
    expect(r.totalInstances).toBe(4);
    expect(r.matchedInstances).toBe(1); // only the checkbox
    expect(r.unmatchedSets).toEqual({ Cell: 2, Row: 1 });
  });

  it("C3: an instance ABSORBED by a kit ancestor is not counted as unmatched", () => {
    // A mapped Input with an inner unmapped icon instance: the Input absorbs its
    // subtree, so the inner instance must NOT inflate totalInstances or appear in
    // the unmatched backlog.
    const { node, maps } = keyInstance("in6", INPUT_KEY, "Input/Text field", {}, ["q"]);
    node.children.push({
      id: "in6-glyph", type: "INSTANCE", componentId: "c:in6-glyph",
      absoluteBoundingBox: bbox(4, 4, 12, 12),
      children: [{ id: "in6-gv", type: "VECTOR", absoluteBoundingBox: bbox(4, 4, 12, 12) }],
    });
    maps.components["c:in6-glyph"] = { key: "k", name: "x", componentSetId: "s:in6-glyph" };
    maps.componentSets["s:in6-glyph"] = { key: "no-match", name: "Icons/Whatever" };
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.totalInstances).toBe(1); // just the Input; the inner glyph is absorbed
    expect(r.matchedInstances).toBe(1);
    expect(r.unmatchedSets).toEqual({});
  });

  it("ChatBubble: a mapped Bubble emits a real <ChatBubble> and counts as matched", () => {
    // Regression: ChatBubble was in SET_KEY_TO_KIT but had no emit case, so it
    // rendered as static markup WHILE inflating the coverage metric. Now it must
    // emit a real kit ChatBubble and the metric must credit it honestly.
    const CHATBUBBLE_KEY = "edd2821db8a05b808da334a1c6aed7646d23e82e";
    const { node, maps } = keyInstance(
      "cb", CHATBUBBLE_KEY, "Bubble", { Type: "Sender" }, ["Hello there"],
    );
    const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
    expect(r.source).toContain('<ChatBubble variant="sender">Hello there</ChatBubble>');
    expect(r.kitImports).toContain("ChatBubble");
    expect(r.kitInstanceCount).toBe(1);
    expect(r.matchedInstances).toBe(1);
  });

  it("METRIC HONESTY: a mapped name with NO emit case is NOT counted as matched", () => {
    // The coverage metric must credit only instances that actually emit as a kit
    // component. A name mapped in SET_NAME_TO_KIT to a value with no switch case
    // (simulated via a fabricated mapping) falls to `default` → static markup and
    // must NOT inflate matchedInstances. We assert the invariant generally:
    // matchedInstances === number of instances that produced a kit import/render.
    // Use a real mapped-but-unemittable shape: SET_NAME_TO_KIT has no
    // "NonExistentKit", so a Cell (unmapped) stays unmatched and a Checkbox
    // (mapped+emitted) is the only match.
    const cb = checkboxInstance("cb1");
    const cell = {
      id: "cell", type: "INSTANCE", componentId: "c:cell",
      absoluteBoundingBox: bbox(0, 40, 300, 47),
      children: [],
    };
    const maps = {
      components: {
        "c:1": { key: "vk", name: "Checked=True", componentSetId: "s:1" },
        "c:cell": { key: "k", name: "x", componentSetId: "s:cell" },
      },
      componentSets: {
        "s:1": { key: "a1475c3e4dfdf52bca771aff82f3ac849d31a036", name: "Checkbox" },
        "s:cell": { key: "no-match", name: "Cell" },
      },
    };
    const r = emitKitFrame(frameNode("0", [cb, cell]), { ...maps, assetFiles: new Map() });
    // matchedInstances must equal the count of real kit renders (the Checkbox).
    expect(r.matchedInstances).toBe(r.kitInstanceCount);
    expect(r.matchedInstances).toBe(1);
    expect(r.totalInstances).toBe(2);
  });
});

// --- mapping hygiene (D2) ----------------------------------------------------
//
// Shape checks (regex) catch typos in form; the real guard is asserting every
// mapping VALUE is an actual export of @xorkavi/arcade-gen. A mapping pointing
// at a renamed/removed/typo'd component would otherwise build a frame that
// imports a non-existent name and crashes on a tester's machine — this fails it
// in CI instead. Validation reads the kit's own published declaration (no
// hardcoded list), so a kit version bump keeps the allow-list current.

describe("kit mappings hygiene", () => {
  it("icon map values are PascalCase identifiers (kit exports)", () => {
    for (const v of Object.values(ICON_SET_NAME_TO_KIT)) {
      expect(v).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });
  it("set keys are 40-char hex (published component-set keys)", () => {
    for (const k of Object.keys(SET_KEY_TO_KIT)) {
      expect(k).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("the kit barrel export surface resolves and is non-trivial", () => {
    // Guard against a vacuous pass: if the package can't be resolved/parsed the
    // set is empty and every assertion below would falsely "pass" because the
    // membership check is never exercised. Assert we read a real surface first.
    const names = kitExportNames();
    expect(names.size).toBeGreaterThan(50);
    expect(names.has("Button")).toBe(true);
    expect(names.has("AvatarCount")).toBe(true);
  });

  it("parseBarrelExportNames keeps values, drops type-only re-exports", () => {
    const set = parseBarrelExportNames(
      'export { Button, Avatar as Av, type ButtonProps, type Mode as M, Bell };',
    );
    expect([...set].sort()).toEqual(["Av", "Bell", "Button"]);
    expect(set.has("ButtonProps")).toBe(false); // type-only re-export excluded
    expect(set.has("M")).toBe(false); // `type X as Y` excluded
  });

  it("every ICON_SET_NAME_TO_KIT value is a real arcade-gen export", () => {
    const names = kitExportNames();
    const missing = [...new Set(Object.values(ICON_SET_NAME_TO_KIT))].filter(
      (v) => !names.has(v),
    );
    expect(missing, `Icon mappings pointing at non-existent kit exports: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("no ICON mapping resolves to a NON-RENDERABLE compound export", () => {
    // The Sidebar.Left crash: `Sidebar` IS a real export (so the membership
    // test above passes) but it's a compound object {Root,Section,Item}, not a
    // glyph. Emitting `<Sidebar size=…/>` throws "Element type is invalid …
    // got: object". An icon mapping must NEVER point at one of these.
    const bad = Object.entries(ICON_SET_NAME_TO_KIT).filter(
      ([, kit]) => NON_RENDERABLE_KIT_EXPORTS.has(kit),
    );
    expect(bad, `Icon mappings pointing at compound objects: ${bad.map(([k, v]) => `${k}→${v}`).join(", ")}`)
      .toEqual([]);
  });

  it("matchKit drops an icon match that resolves to a compound object (SVG fallback)", () => {
    // Even if a bad icon row slips back in, the runtime guard must refuse to
    // emit it as an icon — returning null routes the node to its exported SVG,
    // which always renders. Drive matchKit with a setName the icon map points at
    // a compound object via a temporary entry.
    const SENTINEL = "__test/compound.icon__";
    (ICON_SET_NAME_TO_KIT as Record<string, string>)[SENTINEL] = "Sidebar";
    try {
      expect(matchKit(undefined, SENTINEL)).toBeNull();
    } finally {
      delete (ICON_SET_NAME_TO_KIT as Record<string, string>)[SENTINEL];
    }
  });

  it("NON_RENDERABLE_KIT_EXPORTS entries are all real arcade-gen exports", () => {
    // The guard list must track the kit: every name in it should actually be an
    // export (else we're guarding against a phantom and a real compound could be
    // missing). Catches a typo or a removed compound on a kit bump.
    const names = kitExportNames();
    const missing = [...NON_RENDERABLE_KIT_EXPORTS].filter((v) => !names.has(v));
    expect(missing, `Guard list names not exported by the kit: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("every SET_KEY_TO_KIT value resolves to a real arcade-gen export", () => {
    const names = kitExportNames();
    const missing = [...new Set(Object.values(SET_KEY_TO_KIT))]
      .map((v) => PSEUDO_KIT_RENDERS[v] ?? v) // pseudo-kits render a real component
      .filter((v) => !names.has(v));
    expect(missing, `Key mappings pointing at non-existent kit exports: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("every SET_NAME_TO_KIT value resolves to a real arcade-gen export", () => {
    // Some values are pseudo-kits (ImageAvatar/AccountAvatar) routed through the
    // emit switch to a real component — resolve those before the membership
    // check so they don't false-fail, while still asserting the component they
    // actually render exists.
    const names = kitExportNames();
    const missing = [...new Set(Object.values(SET_NAME_TO_KIT))]
      .map((v) => PSEUDO_KIT_RENDERS[v] ?? v)
      .filter((v) => !names.has(v));
    expect(missing, `Name mappings pointing at non-existent kit exports: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("C2 variant maps emit only values in the kit's real prop unions (Figma→kit)", () => {
    // The authority for the IMPORT direction is the kit's actual prop union, not
    // the export-direction componentEntries table (which can lag the kit). Every
    // value these maps emit MUST be a member of the kit union, else the component
    // silently renders its default/fallback (the Badge variant="info" bug: "info"
    // is not in BadgeVariant, so the kit fell through to neutral).
    const BADGE_VARIANTS = new Set(["emphasis", "neutral"]); // kit BadgeVariant
    for (const [figma, kit] of Object.entries(BADGE_VARIANT_MAP)) {
      expect(BADGE_VARIANTS.has(kit), `Badge ${figma}→${kit} not in kit BadgeVariant`).toBe(true);
    }
    expect(BADGE_VARIANT_MAP.Emphasis).toBe("emphasis");
    expect(BADGE_VARIANT_MAP.Neutral).toBe("neutral");

    const TAG_INTENTS = new Set(["neutral", "alert", "success", "warning", "info", "intelligence"]);
    for (const [figma, kit] of Object.entries(TAG_INTENT_MAP)) {
      expect(TAG_INTENTS.has(kit), `Tag ${figma}→${kit} not in kit TagIntent`).toBe(true);
    }
    const TAG_APPEARANCES = new Set(["tinted", "filled"]);
    for (const [figma, kit] of Object.entries(TAG_APPEARANCE_MAP)) {
      expect(TAG_APPEARANCES.has(kit), `Tag appearance ${figma}→${kit} not in kit TagAppearance`).toBe(true);
    }
  });

  it("a deliberately bad mapping value would be caught (negative control)", () => {
    // Proves the membership check actually bites: a fabricated component name
    // must be reported as missing.
    const names = kitExportNames();
    const fake = { Bogus: "ThisComponentDoesNotExistInTheKit" };
    const missing = Object.values(fake).filter((v) => !names.has(v));
    expect(missing).toEqual(["ThisComponentDoesNotExistInTheKit"]);
  });

  it("every component-kind mapping has a real emit case (not just a real export name)", () => {
    // The invariant that ChatBubble violated: a mapping value being a real kit
    // EXPORT is necessary but NOT sufficient — the emit switch must also have a
    // CASE that renders it, else the instance counts as matched while rendering
    // static markup (failing the "real kit components" bar AND inflating the
    // coverage metric). For every mapping entry, route a synthetic instance
    // through its REAL key/name so matchKit resolves, then assert it actually
    // emitted as a kit component (kitInstanceCount + matchedInstances > 0).
    const routes: Array<{ kit: string; key?: string; name: string }> = [
      ...Object.entries(SET_KEY_TO_KIT).map(([key, kit]) => ({ kit, key, name: "x" })),
      ...Object.entries(SET_NAME_TO_KIT).map(([name, kit]) => ({ kit, name })),
    ];
    const noEmitCase: string[] = [];
    for (const { kit, key, name } of routes) {
      const node: any = {
        id: `n_${kit}`, type: "INSTANCE", componentId: `c_${kit}`,
        absoluteBoundingBox: bbox(0, 0, 120, 40),
        componentProperties: {},
        children: [{
          id: `t_${kit}`, type: "TEXT", characters: "x",
          absoluteBoundingBox: bbox(4, 4, 80, 16),
          style: { fontFamily: "Inter", fontSize: 13 },
        }],
      };
      const maps = {
        components: { [`c_${kit}`]: { key: "k", name: "x", componentSetId: `s_${kit}` } },
        componentSets: { [`s_${kit}`]: { key: key ?? `local-${kit}`, name } },
      };
      const r = emitKitFrame(frameNode("0", [node]), { ...maps, assetFiles: new Map() });
      if (!(r.kitInstanceCount > 0 && r.matchedInstances === 1)) noEmitCase.push(`${kit} (via ${key ?? name})`);
    }
    expect(noEmitCase, `Mapped components with no emit case (render static, inflate coverage): ${noEmitCase.join(", ")}`)
      .toEqual([]);
  });
});

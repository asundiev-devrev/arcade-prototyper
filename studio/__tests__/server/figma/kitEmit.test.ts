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

  it("a deliberately bad mapping value would be caught (negative control)", () => {
    // Proves the membership check actually bites: a fabricated component name
    // must be reported as missing.
    const names = kitExportNames();
    const fake = { Bogus: "ThisComponentDoesNotExistInTheKit" };
    const missing = Object.values(fake).filter((v) => !names.has(v));
    expect(missing).toEqual(["ThisComponentDoesNotExistInTheKit"]);
  });
});

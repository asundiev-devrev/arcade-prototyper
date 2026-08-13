import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  planAssets,
  emitKitFrame,
  resolveIdentity,
  blurStyle,
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
    expect(matchKit("unknown-key", "Icon Button")).toEqual({ kind: "component", kit: "IconButton" });
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

  // A CHECKED checkbox is an all-vector subtree (its glyph is a checkmark
  // VECTOR), wrapped in a plain "Container" frame — exactly the shape isGraphic
  // greedily flattened to one SVG before the walk could reach the mappable
  // Checkbox INSTANCE inside. (An UNCHECKED box has a RECTANGLE stroke, so it
  // wasn't all-vector and dodged this path — hence "unchecked worked, checked
  // became a static asset".) isGraphic must decline via containsKitMatch and
  // let recursion reach the component.
  it("does NOT flatten a Container that wraps a kit Checkbox whose glyph is a vector (checked state)", () => {
    const { components, componentSets } = checkboxMaps();
    const doc = frameNode("0", [{
      id: "container", type: "FRAME", absoluteBoundingBox: bbox(0, 0, 16, 16),
      children: [checkboxInstance("cb-checked", true)],
    }]);
    const plan = planAssets(doc, { components, componentSets });
    // The Container is NOT rasterized (it holds a mappable Checkbox); nothing
    // inside exports as an asset.
    expect(plan.svgIds).not.toContain("container");
    expect(plan.svgIds).toEqual([]);

    const r = emitKitFrame(doc, {
      components, componentSets, assetFiles: new Map(),
    });
    expect(r.source).toContain("<Checkbox size=\"sm\" defaultChecked />");
    expect(r.kitInstanceCount).toBe(1);
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
});

// --- Banner / TextArea coverage -----------------------------------------------

/** Helper for text-containing kit components. */
function kitTextInstance(id: string, setKey: string, setName: string, label: string) {
  const doc = frameNode("0", [{
    id, type: "INSTANCE", componentId: `c:${id}`,
    absoluteBoundingBox: bbox(10, 10, 200, 40),
    children: [{ id: `${id}-t`, type: "TEXT", characters: label, absoluteBoundingBox: bbox(12, 12, 180, 20) }],
  }]);
  const maps = {
    components: { [`c:${id}`]: { key: "v", name: `${setName} variant`, componentSetId: `s:${id}` } },
    componentSets: { [`s:${id}`]: { key: setKey, name: setName } },
    assetFiles: new Map(),
  };
  return emitKitFrame(doc, maps);
}

describe("emit — Banner/TextArea", () => {
  const BANNER_SET_KEY = "edf96535be2abc8d0b836f54d450d60683a896ab";
  const TEXTAREA_SET_KEY = "d43e5c28c7a26c01ebdbb7123751565a8955b52e";

  it("emits a Banner with the text as CHILDREN (inline layout ignores title)", () => {
    const r = kitTextInstance("b1", BANNER_SET_KEY, "Inline Banner", "Heads up: SLA at risk");
    expect(r.source).toContain("<Banner");
    // C2 guard: text must be the child, NOT in a title="" prop (inline drops title)
    expect(r.source).toContain(">Heads up: SLA at risk</Banner>");
    expect(r.source).not.toMatch(/title="Heads up/);
    expect(r.kitImports).toContain("Banner");
  });

  it("emits a TextArea with defaultValue", () => {
    const r = kitTextInstance("t1", TEXTAREA_SET_KEY, "Text Area", "Notes");
    expect(r.source).toContain("<TextArea");
    expect(r.source).toContain('defaultValue="Notes"');
    expect(r.kitImports).toContain("TextArea");
  });
});

describe("emit — KeyboardShortcut/SplitButton", () => {
  const SHORTCUT_SET_KEY = "4bd8ce6785fee3244a829595d70e612350b5ecbd";
  const SPLITBUTTON_SET_KEY = "8ba9681b10fd5324ac7e381013e727ff8836e9d2";

  it("emits KeyboardShortcut with a keys={[]} prop (NEVER children — children crash it)", () => {
    const r = kitTextInstance("k1", SHORTCUT_SET_KEY, "Shortcut", "⌘K");
    expect(r.source).toContain("<KeyboardShortcut keys={");
    // C1 guard: bare opening tag must never appear (only self-closing or with keys prop)
    expect(r.source).not.toContain("<KeyboardShortcut>");
    expect(r.kitImports).toContain("KeyboardShortcut");
  });
  it("emits a SplitButton wrapping a SplitButtonItem label", () => {
    const r = kitTextInstance("sb1", SPLITBUTTON_SET_KEY, "Split Button", "Save");
    expect(r.source).toContain("<SplitButton>");
    expect(r.source).toContain("<SplitButtonItem>Save</SplitButtonItem>");
    expect(r.kitImports).toContain("SplitButton");
    expect(r.kitImports).toContain("SplitButtonItem");
  });
});

describe("emit — Banner/TextArea (asset tests)", () => {
  it("references exported assets via local imports", () => {
    const doc = frameNode("0", [
      { id: "v1", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
    ]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {},
      assetFiles: new Map([["v1", "v1.svg"]]),
    });
    expect(r.source).toContain('import a_v1 from "./assets/v1.svg";');
    expect(r.source).toMatch(/<img[^>]+src=\{a_v1\}/);
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
    expect(r.source).toMatch(/<img[^>]+src=\{a_glyph\}/);
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
    expect(r.source).toMatch(/<img[^>]+src=\{a_ic_v\}/);
    // The bare vector must NOT also be emitted as a separate plain box.
    expect(r.source).not.toContain('<div data-figma-id="ic-v" style={{position: "absolute", left: "4px", top: "4px"');
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

  it("FIX 2: unmatched ICON instances are excluded from the unmatchedSets notice", () => {
    // An unmapped icon instance is still a real ADS component (renders as faithful
    // SVG) and shouldn't appear in the "static pixels that won't transfer" list.
    // Only non-icon unmatched instances go into unmatchedSets.
    const iconInst = {
      id: "icon1", type: "INSTANCE", componentId: "c:icon1",
      absoluteBoundingBox: bbox(0, 0, 16, 16),
      children: [{ id: "v", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) }],
    };
    const cellInst = {
      id: "cell1", type: "INSTANCE", componentId: "c:cell1",
      absoluteBoundingBox: bbox(0, 20, 300, 40),
      children: [],
    };
    const maps = {
      components: {
        "c:icon1": { key: "k", name: "x", componentSetId: "s:icon1" },
        "c:cell1": { key: "k", name: "x", componentSetId: "s:cell1" },
      },
      componentSets: {
        "s:icon1": { key: "no-match", name: "Icons/UnmappedGlyph" },
        "s:cell1": { key: "no-match", name: "Cell" },
      },
    };
    const r = emitKitFrame(frameNode("0", [iconInst, cellInst]), { ...maps, assetFiles: new Map() });
    expect(r.totalInstances).toBe(2);
    expect(r.matchedInstances).toBe(0);
    // Only Cell appears in the unmatched notice; the icon does not.
    expect(r.unmatchedSets).toEqual({ Cell: 1 });
    expect(r.unmatchedSets["Icons/UnmappedGlyph"]).toBeUndefined();
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
    // Mappings whose emit case is STRUCTURE-DEPENDENT: they deliberately fall
    // back to faithful markup when the instance doesn't carry the shape they
    // model, so a synthetic one-TEXT-child probe can't satisfy them. That is the
    // pixel-floor rule (never lose a painted visual to a guessed skeleton), not
    // the bug this test hunts. Each is covered by its own positive test below.
    const STRUCTURE_DEPENDENT = new Set(["Sidebar"]);
    const noEmitCase: string[] = [];
    for (const { kit, key, name } of routes) {
      if (STRUCTURE_DEPENDENT.has(kit)) continue;
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

// --- data-figma-id traceability stamping -------------------------------------

describe("data-figma-id stamping", () => {
  it("emits data-figma-id on a mapped component's wrapper div", () => {
    const { components, componentSets } = checkboxMaps();
    const doc = frameNode("0", [checkboxInstance("cb-123", true)]);
    const r = emitKitFrame(doc, { components, componentSets, assetFiles: new Map() });
    // The checkbox's outer centering wrapper <div> carries the node id.
    expect(r.source).toMatch(/data-figma-id="cb-123"/);
    // It's on the outer div, NOT immediately before the <Checkbox tag.
    expect(r.source).not.toMatch(/data-figma-id="[^"]*"\s*><Checkbox/);
  });

  it("emits data-figma-id on a hand-rolled div (unmapped element)", () => {
    const doc = frameNode("panel-456", [{
      id: "child-789", type: "FRAME",
      absoluteBoundingBox: bbox(10, 10, 100, 50),
      fills: [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toMatch(/data-figma-id="child-789"/);
  });

  it("emits data-figma-id on an icon element", () => {
    const doc = frameNode("0", [{
      id: "icon-999", type: "INSTANCE", componentId: "c:bell",
      absoluteBoundingBox: bbox(0, 0, 16, 16),
      children: [{
        id: "icon-v", type: "VECTOR", absoluteBoundingBox: bbox(2, 2, 12, 12),
        fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      }],
    }]);
    const r = emitKitFrame(doc, {
      components: { "c:bell": { key: "k", name: "x", componentSetId: "s:b" } },
      componentSets: { "s:b": { key: "irrelevant", name: "Icons/Bell" } },
      assetFiles: new Map(),
    });
    expect(r.source).toMatch(/data-figma-id="icon-999"/);
  });

  it("emits data-figma-id on an img element (exported asset)", () => {
    const doc = frameNode("0", [
      { id: "vec-111", type: "VECTOR", absoluteBoundingBox: bbox(0, 0, 16, 16) },
    ]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {},
      assetFiles: new Map([["vec-111", "vec-111.svg"]]),
    });
    expect(r.source).toMatch(/<img data-figma-id="vec-111"/);
  });

  it("emits data-figma-id on a TEXT element", () => {
    const doc = frameNode("0", [{
      id: "text-222", type: "TEXT", characters: "Label",
      absoluteBoundingBox: bbox(0, 0, 100, 20),
      style: { fontFamily: "Inter", fontSize: 14 },
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toMatch(/data-figma-id="text-222"/);
  });

  it("omits data-figma-id when the node has no .id (defensive, no crash)", () => {
    const doc = frameNode("0", [{
      type: "FRAME", absoluteBoundingBox: bbox(0, 0, 100, 50),
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).not.toMatch(/data-figma-id=""/);
    expect(r.source).not.toMatch(/data-figma-id="undefined"/);
  });

  it("inertness: data-figma-id is on the outer positioned wrapper, NOT inside kit components", () => {
    const { components, componentSets } = checkboxMaps();
    const doc = frameNode("0", [checkboxInstance("cb-inert", true)]);
    const r = emitKitFrame(doc, { components, componentSets, assetFiles: new Map() });
    // The attribute must be on the outer <div>, not on the <Checkbox> tag itself.
    // Assert the pattern: <div data-figma-id="..." ...><Checkbox ... /></div>
    expect(r.source).toMatch(/<div data-figma-id="cb-inert"[^>]*><Checkbox/);
    // The <Checkbox tag itself must NOT carry data-figma-id.
    expect(r.source).not.toMatch(/<Checkbox[^>]*data-figma-id/);
  });

  it("handles realistic colon-form Figma node IDs", () => {
    const doc = frameNode("0", [{
      id: "191:19683", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 100, 50),
      fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.6, a: 1 } }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // The colon must be preserved exactly, and the attribute must be properly quoted.
    expect(r.source).toMatch(/data-figma-id="191:19683"/);
    // Ensure it's not malformed (missing quotes, broken tag).
    expect(r.source).not.toMatch(/data-figma-id=191/);
  });
});

describe("stroke fidelity — per-side borders + hairline dividers", () => {
  const GRAY = { r: 0.925, g: 0.918, b: 0.922, a: 1 }; // ~#eceaeb

  it("renders a bottom-only Figma border (individualStrokeWeights) as a single bottom inset, not a 4-side box", () => {
    // Regression: a simplified table's header/rows carry
    // individualStrokeWeights {top:0,right:0,bottom:1,left:0} — a bottom rule.
    // The old code read only the uniform strokeWeight and boxed all four sides.
    const doc = frameNode("0", [{
      id: "row", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 680, 52),
      strokeWeight: 1,
      individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
      strokeAlign: "INSIDE",
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // Bottom edge only: inset 0 -1px 0 0. Never the full-box inset 0 0 0 1px.
    expect(r.source).toContain("inset 0 -1px 0 0");
    expect(r.source).not.toContain("inset 0 0 0 1px");
  });

  it("still renders a uniform border as the single 4-side inset (unchanged)", () => {
    const doc = frameNode("0", [{
      id: "card", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 200, 100),
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain("inset 0 0 0 1px");
  });

  it("emits every non-zero side when weights differ per edge", () => {
    const doc = frameNode("0", [{
      id: "box", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 100, 100),
      strokeWeight: 1,
      individualStrokeWeights: { top: 2, right: 0, bottom: 1, left: 3 },
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain("inset 0 2px 0 0");   // top
    expect(r.source).toContain("inset 0 -1px 0 0");  // bottom
    expect(r.source).toContain("inset 3px 0 0 0");   // left
    expect(r.source).not.toContain("inset -");       // right weight is 0
  });

  it("paints NO border for an all-zero individualStrokeWeights, even with a stroke paint (adv-2, kept by design)", () => {
    // A stroke weight of 0 on every edge is INVISIBLE in Figma even though a
    // stroke color is present. The emitter must paint nothing — NOT default to a
    // 1px line, which would invent a border the design doesn't have. Pinned so a
    // future "add a fallback border" refactor can't silently reintroduce it.
    const doc = frameNode("0", [{
      id: "nostroke", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 100, 100),
      strokeWeight: 0,
      individualStrokeWeights: { top: 0, right: 0, bottom: 0, left: 0 },
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).not.toContain("inset 0 0 0 0px");
    expect(r.source).not.toMatch(/inset [^,;"]*#eceaeb/);
  });

  it("paints NO border for a uniform strokeWeight of 0 (invisible stroke)", () => {
    // Same rule on the uniform path: an explicit 0 weight → no shadow. (A NULLISH
    // weight still defaults to 1px — that's the hairline-divider case above.)
    const doc = frameNode("0", [{
      id: "zerobox", type: "FRAME",
      absoluteBoundingBox: bbox(0, 0, 200, 100),
      strokeWeight: 0,
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).not.toContain("inset 0 0 0 0px");
  });

  it("does NOT export a zero-height divider VECTOR as an SVG asset (planAssets)", () => {
    // A Figma rule/separator is a VECTOR sized WxH = 648x0 whose paint is a
    // stroke. Exporting it produces a 0-px, invisible <img>. planAssets must
    // skip it so emit can paint it as a thin CSS box instead.
    const doc = frameNode("0", [{
      id: "divider", type: "VECTOR",
      absoluteBoundingBox: bbox(16, 6, 648, 0),
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const plan = planAssets(doc, { components: {}, componentSets: {} });
    expect(plan.svgIds).not.toContain("divider");
    expect(plan.svgIds).toEqual([]);
  });

  it("renders a zero-height divider VECTOR as a visible 1px CSS box in the stroke color", () => {
    const doc = frameNode("0", [{
      id: "divider", type: "VECTOR",
      absoluteBoundingBox: bbox(16, 6, 648, 0),
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    // A div, not an <img>, sized 648x1, painted with the stroke color.
    expect(r.source).toMatch(/<div data-figma-id="divider"[^>]*\/>/);
    expect(r.source).not.toContain("<img");
    expect(r.source).toContain('height: "1px"');
    expect(r.source).toContain('width: "648px"');
    expect(r.source).toContain('background: "#eceaeb"');
  });

  it("renders a zero-width vertical divider as a 1px-wide CSS box", () => {
    const doc = frameNode("0", [{
      id: "vrule", type: "LINE",
      absoluteBoundingBox: bbox(20, 0, 0, 400),
      strokeWeight: 1,
      strokes: [{ type: "SOLID", color: GRAY }],
    }]);
    const r = emitKitFrame(doc, { components: {}, componentSets: {}, assetFiles: new Map() });
    expect(r.source).toContain('width: "1px"');
    expect(r.source).toContain('height: "400px"');
    expect(r.source).not.toContain("<img");
  });
});

// Blur effects. Before this, paintStyle read ONLY DROP_SHADOW, so every
// LAYER_BLUR / BACKGROUND_BLUR in a design was silently dropped — a designer's
// soft purple background glow imported as a hard-edged blob (live session
// 2026-08-06, Onboarding 3.0 node 5678:118876). The radii below are the REAL
// values from that frame.
//
// radius/2 is Figma's own conversion, read off its SVG exporter rather than
// guessed: exporting those nodes emits feGaussianBlur stdDeviation="22" for
// radius 44 and stdDeviation="87" for radius 174.
describe("blurStyle", () => {
  it("maps LAYER_BLUR to filter at radius/2 (Figma's own conversion)", () => {
    expect(blurStyle({ effects: [{ type: "LAYER_BLUR", visible: true, radius: 174 }] } as any))
      .toEqual({ filter: "blur(87px)" });
    expect(blurStyle({ effects: [{ type: "LAYER_BLUR", visible: true, radius: 44 }] } as any))
      .toEqual({ filter: "blur(22px)" });
  });

  it("maps BACKGROUND_BLUR to backdropFilter (blurs what shows THROUGH)", () => {
    expect(blurStyle({ effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 52 }] } as any))
      .toEqual({ backdropFilter: "blur(26px)" });
  });

  it("keeps the two kinds separate and composes multiples", () => {
    const out = blurStyle({ effects: [
      { type: "LAYER_BLUR", visible: true, radius: 10 },
      { type: "LAYER_BLUR", visible: true, radius: 4 },
      { type: "BACKGROUND_BLUR", visible: true, radius: 8 },
    ] } as any);
    expect(out).toEqual({ filter: "blur(5px) blur(2px)", backdropFilter: "blur(4px)" });
  });

  it("ignores hidden, zero-radius, and non-blur effects", () => {
    expect(blurStyle({ effects: [{ type: "LAYER_BLUR", visible: false, radius: 40 }] } as any)).toEqual({});
    expect(blurStyle({ effects: [{ type: "LAYER_BLUR", visible: true, radius: 0 }] } as any)).toEqual({});
    expect(blurStyle({ effects: [{ type: "DROP_SHADOW", visible: true, radius: 8 }] } as any)).toEqual({});
    expect(blurStyle({} as any)).toEqual({});
  });

  it("rounds a float radius to 2dp instead of emitting CSS noise", () => {
    // Figma radii are floats; 319.78460693359375/2 must not reach the stylesheet.
    expect(blurStyle({ effects: [{ type: "LAYER_BLUR", visible: true, radius: 5.333 }] } as any))
      .toEqual({ filter: "blur(2.67px)" });
  });
});

describe("emitKitFrame — blur", () => {
  it("emits CSS blur on a container GROUP (the real dropped case)", () => {
    // Shape of the live failure: the blur sits on a parent GROUP whose child is
    // exported as a SHARP svg. Without the container's CSS blur the import shows
    // a hard-edged blob.
    const doc = frameNode("0", [{
      id: "glow", type: "GROUP",
      absoluteBoundingBox: bbox(0, 101, 600, 320),
      opacity: 0.2,
      effects: [{ type: "LAYER_BLUR", visible: true, radius: 174 }],
      children: [{
        id: "blob", type: "VECTOR",
        absoluteBoundingBox: bbox(0, 101, 600, 320),
        fills: [{ type: "SOLID", color: { r: 0.27, g: 0, b: 0.67, a: 1 } }],
      }],
    }]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {},
      assetFiles: new Map([["blob", "blob.svg"]]),
    });
    expect(r.source).toContain('filter: "blur(87px)"');
  });

  it("does NOT double-blur an exported node — Figma bakes blur into the asset", () => {
    // The blur is on the EXPORTED node itself. Its SVG/PNG already contains the
    // blur (verified live), so emitting CSS blur too would apply it twice.
    const doc = frameNode("0", [{
      id: "icon", type: "VECTOR",
      absoluteBoundingBox: bbox(10, 10, 24, 24),
      effects: [{ type: "LAYER_BLUR", visible: true, radius: 20 }],
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
    }]);
    const r = emitKitFrame(doc, {
      components: {}, componentSets: {},
      assetFiles: new Map([["icon", "icon.svg"]]),
    });
    expect(r.source).toContain("<img");
    expect(r.source).not.toContain("blur(10px)");
    expect(r.source).not.toContain("filter:");
  });
});

// --- C3: arcade-gen 2.0 additions -----------------------------------------
//
// These match on the component-set NAME (tier 3), not a published key — the
// names are the ones arcade-gen's own type declarations cite as the source
// Figma sets. Every required prop must be filled from the instance's text or
// the frame white-screens, so each case is asserted on the exact prop shape.

/** Instance matched by set NAME with several TEXT children + variant props. */
function namedInstance(
  id: string,
  setName: string,
  texts: string[],
  variants: Record<string, string> = {},
) {
  const doc = frameNode("0", [{
    id,
    type: "INSTANCE",
    componentId: `c:${id}`,
    absoluteBoundingBox: bbox(10, 10, 240, 40),
    componentProperties: Object.fromEntries(
      Object.entries(variants).map(([k, v]) => [k, { value: v, type: "VARIANT" }]),
    ),
    children: texts.map((t, i) => ({
      id: `${id}-t${i}`,
      type: "TEXT",
      characters: t,
      absoluteBoundingBox: bbox(12, 12 + i * 18, 200, 16),
    })),
  }]);
  const maps = {
    // A key that is NOT in SET_KEY_TO_KIT, so resolution must fall to the name.
    components: { [`c:${id}`]: { key: "v", name: `${setName} variant`, componentSetId: `s:${id}` } },
    componentSets: { [`s:${id}`]: { key: `unpublished-${id}`, name: setName } },
    assetFiles: new Map(),
  };
  return emitKitFrame(doc, maps);
}

describe("emit — arcade-gen 2.0 components (matched by Figma set name)", () => {
  it("emits SearchInput with the text as PLACEHOLDER by default", () => {
    // Placeholder is the set's default variant, so an unset instance is an empty
    // field. A defaultValue would render a fake already-searched state with "×".
    const r = namedInstance("s1", "Search Input", ["Search issues"]);
    expect(r.source).toContain('<SearchInput placeholder="Search issues"');
    expect(r.source).not.toContain("defaultValue");
    expect(r.kitImports).toContain("SearchInput");
  });

  it("emits SearchInput with a defaultValue when Figma Placeholder=False", () => {
    // Placeholder=False means a real query sits in the field.
    const r = namedInstance("s2", "Search Input", ["SLA breach"], { Placeholder: "False" });
    expect(r.source).toContain('defaultValue="SLA breach"');
    expect(r.source).not.toContain("placeholder=");
  });

  it("emits NumberField with size + static label from Figma Type=Small", () => {
    const r = namedInstance("n1", "Input/Number field", ["Priority", "42"], { Type: "Small" });
    expect(r.source).toContain('size="md"'); // Figma Type=Small → 28px field
    expect(r.source).toContain('labelStyle="static"');
    expect(r.source).toContain('label="Priority"');
    expect(r.source).toContain("defaultValue={42}");
    // The kit's value is `number | null` — a quoted string would break steppers.
    expect(r.source).not.toContain('defaultValue="42"');
  });

  it("maps Figma Type=Default to the 40px NumberField size", () => {
    const r = namedInstance("n2", "Input/Number field", ["Count"], { Type: "Default" });
    expect(r.source).toContain('size="lg"');
  });

  it("passes NO size for Type=Floating label — the kit ignores it in that mode", () => {
    // "Floating label" is the SET DEFAULT, so this is the common case. The kit
    // pins a 56px field in floating mode, so any size we passed would be a lie.
    const r = namedInstance("n4", "Input/Number field", ["Estimate"], { Type: "Floating label" });
    expect(r.source).toContain("<NumberField");
    expect(r.source).not.toContain("size=");
    expect(r.source).not.toContain("labelStyle=");
  });

  it("maps NumberField State to disabled / readOnly / error", () => {
    expect(namedInstance("n5", "Input/Number field", ["A"], { State: "Disabled" }).source).toContain("disabled");
    expect(namedInstance("n6", "Input/Number field", ["A"], { State: "Read only" }).source).toContain("readOnly");
    expect(namedInstance("n7", "Input/Number field", ["A"], { State: "Alert" }).source).toContain('error="Invalid"');
  });

  it("omits NumberField defaultValue when no text parses as a number", () => {
    const r = namedInstance("n3", "Input/Number field", ["Estimate"]);
    expect(r.source).toContain('label="Estimate"');
    expect(r.source).not.toContain("defaultValue");
  });

  it("reads ChipButton's pressed look from `Active / Pressed`, not `State`", () => {
    // The 0.3 set's `State` axis is only Idle | "Hover / Press" — the pressed
    // look lives on its own `Active / Pressed` axis. Keying on State silently
    // dropped every active chip.
    const r = namedInstance("c1", "Chip Button", ["Summarise"], {
      Size: "Small",
      "Active / Pressed": "True",
    });
    expect(r.source).toContain('size="sm"');
    expect(r.source).toContain("active");
    expect(r.source).toContain(">Summarise</ChipButton>");
    expect(r.kitImports).toContain("ChipButton");
  });

  it("does NOT mark a ChipButton active for State=Hover / Press", () => {
    const r = namedInstance("c2", "Chip Button", ["Summarise"], { State: "Hover / Press" });
    expect(r.source).not.toContain("active");
  });

  it("emits FilterButton with label and value from tree order", () => {
    const r = namedInstance("f1", "Filter Button", ["Owner", "Nuska"]);
    expect(r.source).toContain('label="Owner"');
    expect(r.source).toContain('value="Nuska"');
    expect(r.kitImports).toContain("FilterButton");
  });

  it("reads FilterButton's active look from `Active / Pressed` too", () => {
    const r = namedInstance("f2", "Filter Button", ["Stage"], { "Active / Pressed": "True" });
    expect(r.source).toContain("active");
  });

  it("emits AttributeItem with the REQUIRED label", () => {
    const r = namedInstance("a1", "Attribute Item", ["Stage", "In review"]);
    expect(r.source).toContain('label="Stage"');
    expect(r.source).toContain('value="In review"');
    expect(r.kitImports).toContain("AttributeItem");
  });

  it("falls back to faithful markup when AttributeItem has no text for its required label", () => {
    const r = namedInstance("a2", "Attribute Item", []);
    expect(r.source).not.toContain("<AttributeItem");
    expect(r.kitImports).not.toContain("AttributeItem");
  });

  it("prefers Figma's `Document` variant over the filename extension", () => {
    // The set states the type outright. When the two disagree (a mislabelled
    // filename), the variant is the designer's intent.
    const r = namedInstance("fa0", "File attachment", ["deck.pdf"], { Document: "PPT" });
    expect(r.source).toContain('docType="ppt"');
    expect(r.source).not.toContain('docType="pdf"');
  });

  it("maps Figma Document=Failed to the `failed` prop, not a docType", () => {
    // `Failed` is the ninth option on the Document axis but it is an error STATE,
    // not a file type — passing it as docType would render no glyph at all.
    const r = namedInstance("fa7", "File attachment", ["broken.pdf"], { Document: "Failed" });
    expect(r.source).toContain("failed");
    expect(r.source).not.toContain('docType="failed"');
    // Falls back to the extension for the glyph so the chip still looks like a PDF.
    expect(r.source).toContain('docType="pdf"');
  });

  it("emits FileAttachment with docType derived from the filename extension", () => {
    const r = namedInstance("fa1", "File attachment", ["Q3 brief.pdf", "240 KB"]);
    expect(r.source).toContain('name="Q3 brief.pdf"');
    expect(r.source).toContain('docType="pdf"');
    expect(r.source).toContain('meta="240 KB"');
    expect(r.kitImports).toContain("FileAttachment");
  });

  it("maps .docx/.pptx/.md to their doc types and omits an unknown extension", () => {
    expect(namedInstance("fa2", "File attachment", ["spec.docx"]).source).toContain('docType="doc"');
    expect(namedInstance("fa3", "File attachment", ["deck.pptx"]).source).toContain('docType="ppt"');
    expect(namedInstance("fa4", "File attachment", ["notes.md"]).source).toContain('docType="markdown"');
    const unknown = namedInstance("fa5", "File attachment", ["archive.xyz"]);
    expect(unknown.source).toContain('name="archive.xyz"');
    expect(unknown.source).not.toContain("docType=");
  });

  it("falls back to faithful markup when FileAttachment has no filename", () => {
    const r = namedInstance("fa6", "File attachment", []);
    expect(r.source).not.toContain("<FileAttachment");
  });

  it("matches the C3 components by published SET KEY, not just by name", () => {
    // The 0.3 library also publishes "[🔴DEPRECATED] Chip Button",
    // "[🔴DEPRECATED]Number Field" and "[DLS]File Attachment". Key matching is
    // what stops a deprecated twin resolving to the modern kit component, so the
    // keys must be present and must win over the name tier.
    const byKey: Array<[string, string]> = [
      ["19d5b8170133af3b1411a5be16b94621b558c816", "SearchInput"],
      ["4c4e26eb174a90e98da63a36f351946ad43498a5", "NumberField"],
      ["62304142aad2baf93fd56949820a5989f2715349", "ChipButton"],
      ["e4341909fd0d33d86b5284326349c6f2d678a70c", "FilterButton"],
      ["a11a736d2e3ef8673c0f3b57e18301cfcd0fbd37", "FileAttachment"],
    ];
    for (const [key, kit] of byKey) {
      expect(SET_KEY_TO_KIT[key], `${kit} lost its published set key`).toBe(kit);
      // A set whose NAME is unknown still resolves through the key.
      expect(matchKit(key, "Some Detached Copy")).toEqual({ kind: "component", kit });
    }
  });

  it("every C3 name maps to a real kit export with an emit case", () => {
    // Guard the pointless-mapping failure mode: a SET_NAME_TO_KIT row with no
    // emit case resolves, then falls through to static markup — silently
    // costing a kit match. Each of these must actually emit its component.
    const cases: Array<[string, string[], string]> = [
      ["Search Input", ["x"], "SearchInput"],
      ["Input/Number field", ["x"], "NumberField"],
      ["Chip Button", ["x"], "ChipButton"],
      ["Filter Button", ["x"], "FilterButton"],
      ["Attribute Item", ["x"], "AttributeItem"],
      ["File attachment", ["x.pdf"], "FileAttachment"],
    ];
    for (const [setName, texts, kit] of cases) {
      expect(SET_NAME_TO_KIT[setName], `${setName} missing from SET_NAME_TO_KIT`).toBe(kit);
      const r = namedInstance(`g-${kit}`, setName, texts);
      expect(r.source, `${setName} resolved to ${kit} but emitted no component`).toContain(`<${kit}`);
      expect(r.kitImports, `${setName} emitted ${kit} without importing it`).toContain(kit);
    }
  });
});

// --- C4: the Computer sidebar — LEAF-ONLY, by design ------------------------
//
// The sidebar set and its row set were both mapped for one day and both came
// back out. The rule they violated is the same one twice: NEVER map an instance
// whose value is the subtree inside it, because a mapped instance absorbs that
// subtree.
//
//  - 0.3 "Sidebar" is a compound. <Sidebar.Root> takes over layout, which an
//    importer built on Figma's own geometry cannot honour. Measured on a real
//    screen, "Pins" landed at y=362 against a design that puts it at 112.
//  - 0.3 "Items/Expanded" looks like a leaf and isn't: the rows carry person
//    avatars, unread dots and an avatar stack with a "+9" count. Mapping the row
//    deleted all three and repainted it in the kit's row surface — grey blocks,
//    washed-out text, no ellipsis, "More" overlapping "Messages".
//  - "Avatar Stack/Linear/Circle" and the two attachment groups are group
//    wrappers with the same failure mode (the stack lost its "+9").
//
// Left unmapped, every one of those children still maps on its own and nothing
// moves. Verified in the live host: 7/7 sampled labels pixel-exact against Figma,
// 13 real <Avatar>s, ellipsis truncation intact.
const SIDEBAR_SET_KEY = "96a5f2ff79cc6d393e32f21da6fb11bafeb76552";
const SIDEBAR_ROW_SET_KEY = "51e257d3301b2a73905778b8b4ce321d99b86f56";
const AVATAR_STACK_SET_KEY = "e539550dff09b141b8915a1faeba26c2ef441cfb";

describe("Computer sidebar stays leaf-only", () => {
  it("does not map the sidebar compound or the row/group wrappers", () => {
    for (const key of [SIDEBAR_SET_KEY, SIDEBAR_ROW_SET_KEY, AVATAR_STACK_SET_KEY]) {
      expect(SET_KEY_TO_KIT[key], `${key} must stay unmapped — see the note above`).toBeUndefined();
    }
    expect(Object.values(SET_KEY_TO_KIT)).not.toContain("Sidebar");
    expect(Object.values(SET_KEY_TO_KIT)).not.toContain("AttachmentGroup");
  });

  it("never emits a Sidebar sub-part", () => {
    // A dotted sub-part means something re-introduced the compound path.
    const src = readFileSync(join(__dirname, "../../../server/figma/kitEmit.ts"), "utf-8");
    expect(/<Sidebar\./.test(src)).toBe(false);
  });

  it("leaves a sidebar instance as faithful markup, keeping its subtree", () => {
    // The whole point: the rail's own content survives instead of being absorbed.
    const row = {
      id: "row", type: "INSTANCE", componentId: "c_row", name: "Items/Expanded",
      absoluteBoundingBox: bbox(0, 20, 240, 28),
      children: [{ id: "row-t", type: "TEXT", characters: "Sales call prep", absoluteBoundingBox: bbox(22, 26, 168, 16) }],
    };
    const node: any = {
      id: "sb", type: "INSTANCE", componentId: "c_sb",
      absoluteBoundingBox: bbox(0, 0, 240, 1146),
      children: [row],
    };
    const r = emitKitFrame(frameNode("0", [node]), {
      components: {
        c_sb: { key: "v", name: "x", componentSetId: "s_sb" },
        c_row: { key: "v", name: "x", componentSetId: "s_row" },
      },
      componentSets: {
        s_sb: { key: SIDEBAR_SET_KEY, name: "Sidebar" },
        s_row: { key: SIDEBAR_ROW_SET_KEY, name: "Items/Expanded" },
      },
      assetFiles: new Map(),
    });
    expect(r.source).not.toContain("<Sidebar");
    // the row's text is still there, at its Figma position
    expect(r.source).toContain("Sales call prep");
    expect(r.source).toContain('left: "22px"');
  });

  it("still maps the true leaves inside the rail", () => {
    // Separator/Progressive is a genuine leaf: nothing inside it to lose.
    const node: any = {
      id: "sep", type: "INSTANCE", componentId: "c_sep",
      absoluteBoundingBox: bbox(0, 0, 240, 6), children: [],
    };
    const r = emitKitFrame(frameNode("0", [node]), {
      components: { c_sep: { key: "v", name: "x", componentSetId: "s_sep" } },
      componentSets: { s_sep: { key: "5ca8c57f76581c9a3b325c9a4364fe6c0e15c75b", name: "Separator/Progressive" } },
      assetFiles: new Map(),
    });
    expect(r.source).toContain('<Separator orientation="horizontal" variant="progressive" />');
  });
});

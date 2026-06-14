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
} from "../../../server/figma/kitMappings";

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

// --- mapping hygiene ---------------------------------------------------------

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
});

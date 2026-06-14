import type { CompactComponent, CompactLayout, CompactNode, CompactStyle, CompactText, NodeType, SizeAxis } from "./types";

// Real Figma frames are routinely 9–11 deep (nested auto-layout frames + groups
// that survive compactTree's passthrough-collapse pass). 8 was too aggressive
// — the live smoke showed the sidebar hitting cap at depth 10 and dropping
// content the classifier then couldn't see.
export const DEPTH_CAP = 12;
// A full-screen precise-repro frame (e.g. the SoR nav: chrome + several
// sections + footer) runs 250–400 renderable nodes. The old 200 cap silently
// truncated those — the live SoR-nav failure warned "node cap reached" 4–5×,
// starving the sidebar because a sibling section consumed the global budget
// first. 500 fits a real full screen with headroom; it is still a backstop
// against a pathological tree blowing out the prompt, not a target.
export const MAX_NODES = 500;

interface CompactResult {
  tree: CompactNode;
  warnings: string[];
  /**
   * Maps each emitted CompactNode `id` back to the raw figmanage node whose
   * visuals it carries. Built during the same pass that assigns final ids, so
   * it stays correct across dropped zero-size siblings (which shift indices)
   * and collapsed passthrough wrappers (where the kept raw node is a
   * descendant, not the node at that path). Downstream stages — notably
   * resolveTokens — MUST use this instead of re-deriving paths over the raw
   * tree, which silently diverges and drops token bindings.
   */
  rawById: Map<string, any>;
}

export function compactTree(raw: any): CompactResult {
  const warnings: string[] = [];
  const rawById = new Map<string, any>();
  let count = 0;

  // Frame-root origin: every node's bbox is expressed relative to this so the
  // model reads a clean coordinate map instead of raw Figma canvas offsets.
  const rootBox = raw?.absoluteBoundingBox;
  const originX = typeof rootBox?.x === "number" ? rootBox.x : 0;
  const originY = typeof rootBox?.y === "number" ? rootBox.y : 0;

  function recur(n: any, pathId: string, depth: number): CompactNode | null {
    if (!n || typeof n !== "object") return null;
    if (isZeroSize(n)) return null;
    if (depth > DEPTH_CAP) {
      warnings.push(`depth cap ${DEPTH_CAP} reached at ${pathId}`);
      return null;
    }
    if (++count > MAX_NODES) {
      warnings.push(`node cap ${MAX_NODES} reached; tree truncated`);
      return null;
    }

    const type = mapType(n.type);
    const rawKids: any[] = Array.isArray(n.children) ? n.children : [];

    // Collapse passthrough wrappers: GROUP/FRAME with no own visuals and a single child.
    if (isPassthrough(n, type) && rawKids.length === 1) {
      return recur(rawKids[0], pathId, depth); // keep the same path id; effectively unwrap
    }

    const layout = readLayout(n);
    const style = readStyle(n);
    const text = readText(n, type);
    const bbox = readBbox(n, originX, originY);
    const component = readComponent(n, type);

    const kids: CompactNode[] = [];
    let childIdx = 0;
    for (const k of rawKids) {
      const compacted = recur(k, `${pathId}.${childIdx}`, depth + 1);
      if (compacted) {
        kids.push({ ...compacted, id: `${pathId}.${childIdx}` });
        childIdx++;
      }
    }

    // Record the raw node under this node's FINAL id. For a passthrough the
    // recursion above already recorded the kept descendant under `pathId`, so
    // we only reach here for nodes we actually emit.
    rawById.set(pathId, n);

    // An instance's name lives in `component.name`; keep `name` only when it's
    // meaningful AND not already captured as component identity, to avoid
    // duplicating it on every row.
    const keepName = meaningfulName(n.name) && !component;

    const node: CompactNode = {
      id: pathId,
      type,
      ...(keepName ? { name: n.name } : {}),
      ...(bbox ? { bbox } : {}),
      ...(component ? { component } : {}),
      ...(layout ? { layout } : {}),
      ...(style ? { style } : {}),
      ...(text ? { text } : {}),
      ...(kids.length ? { children: kids } : {}),
    };
    return node;
  }

  const tree = recur(raw, "0", 0);
  if (!tree) {
    // Root was unrenderable — return a minimal empty frame so callers don't crash.
    return { tree: { id: "0", type: "frame" }, warnings: warnings.concat("root node was empty"), rawById };
  }
  return { tree, warnings, rawById };
}

function mapType(t: string): NodeType {
  switch (t) {
    case "FRAME": case "RECTANGLE": case "COMPONENT": case "COMPONENT_SET": return "frame";
    case "TEXT": return "text";
    case "INSTANCE": return "instance";
    case "GROUP": return "group";
    case "VECTOR": case "LINE": case "STAR": case "ELLIPSE": case "POLYGON": return "vector";
    case "IMAGE": return "image";
    default: return "frame";
  }
}

function isZeroSize(n: any): boolean {
  const b = n.absoluteBoundingBox;
  if (!b) return false;
  return (b.width ?? 0) <= 0 || (b.height ?? 0) <= 0;
}

function isPassthrough(n: any, type: NodeType): boolean {
  if (type !== "group" && type !== "frame") return false;
  if (type === "frame") {
    // A frame with a fill / stroke / radius / auto-layout is NOT passthrough.
    if (Array.isArray(n.fills) && n.fills.length) return false;
    if (Array.isArray(n.strokes) && n.strokes.length) return false;
    if (n.cornerRadius) return false;
    if (n.layoutMode && n.layoutMode !== "NONE") return false;
  }
  return true;
}

function readBbox(n: any, originX: number, originY: number): [number, number, number, number] | undefined {
  const b = n.absoluteBoundingBox;
  if (!b || typeof b.width !== "number" || typeof b.height !== "number") return undefined;
  const x = typeof b.x === "number" ? b.x - originX : 0;
  const y = typeof b.y === "number" ? b.y - originY : 0;
  return [Math.round(x), Math.round(y), Math.round(b.width), Math.round(b.height)];
}

/**
 * Extract component identity for INSTANCE nodes. The name is the readable
 * component name; props is the resolved variant/text property map with Figma's
 * disambiguation suffixes stripped (e.g. "Label#1:0" → "Label") so the model
 * sees clean keys.
 */
function readComponent(n: any, type: NodeType): CompactComponent | undefined {
  if (type !== "instance") return undefined;
  const name = typeof n.name === "string" && n.name.trim() ? n.name.trim() : undefined;
  if (!name) return undefined;
  const comp: CompactComponent = { name };

  const cp = n.componentProperties;
  if (cp && typeof cp === "object") {
    const props: Record<string, string> = {};
    for (const [rawKey, entry] of Object.entries(cp)) {
      const value = (entry as any)?.value;
      if (value === undefined || value === null) continue;
      const key = rawKey.split("#")[0]; // strip "#1:0" disambiguation suffix
      props[key] = String(value);
    }
    if (Object.keys(props).length) comp.props = props;
  }
  return comp;
}

function readLayout(n: any): CompactLayout | undefined {
  const mode = n.layoutMode;
  if (!mode || mode === "NONE") return undefined;
  const direction = mode === "HORIZONTAL" ? "row" : mode === "VERTICAL" ? "col" : "none";
  const layout: CompactLayout = { direction };
  if (typeof n.itemSpacing === "number") layout.gap = n.itemSpacing;
  if ([n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].some((p) => typeof p === "number")) {
    layout.padding = [n.paddingTop ?? 0, n.paddingRight ?? 0, n.paddingBottom ?? 0, n.paddingLeft ?? 0];
  }
  const align = mapAlign(n.counterAxisAlignItems);
  if (align) layout.align = align;
  const justify = mapJustify(n.primaryAxisAlignItems);
  if (justify) layout.justify = justify;
  const w = mapSizing(n.layoutSizingHorizontal, n.absoluteBoundingBox?.width);
  if (w !== undefined) layout.width = w;
  const h = mapSizing(n.layoutSizingVertical, n.absoluteBoundingBox?.height);
  if (h !== undefined) layout.height = h;
  return layout;
}

function mapAlign(v: string | undefined): CompactLayout["align"] {
  switch (v) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "BASELINE": return "stretch"; // close enough for a prompt hint
    default: return undefined;
  }
}
function mapJustify(v: string | undefined): CompactLayout["justify"] {
  switch (v) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "SPACE_BETWEEN": return "space-between";
    default: return undefined;
  }
}
function mapSizing(v: string | undefined, abs: number | undefined): SizeAxis | undefined {
  if (v === "FILL") return "fill";
  if (v === "HUG") return "hug";
  if (typeof abs === "number") return Math.round(abs);
  return undefined;
}

function readStyle(n: any): CompactStyle | undefined {
  const style: CompactStyle = {};
  const fillHex = solidFillHex(n.fills);
  if (fillHex) style.fill = fillHex;
  const strokeHex = solidFillHex(n.strokes);
  if (strokeHex) style.stroke = strokeHex;
  if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) style.radius = n.cornerRadius;
  if (Array.isArray(n.effects)) {
    const shadow = n.effects.find((e: any) => e.type === "DROP_SHADOW" && e.visible !== false);
    if (shadow) style.shadow = `shadow ${shadow.offset?.x ?? 0}/${shadow.offset?.y ?? 0}/${shadow.radius ?? 0}`;
  }
  return Object.keys(style).length ? style : undefined;
}

function solidFillHex(paints: any): string | undefined {
  if (!Array.isArray(paints)) return undefined;
  const solid = paints.find((p) => p?.type === "SOLID" && p.visible !== false);
  if (!solid?.color) return undefined;
  const { r, g, b } = solid.color;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r ?? 0)}${toHex(g ?? 0)}${toHex(b ?? 0)}`;
}

function readText(n: any, type: NodeType): CompactText | undefined {
  if (type !== "text") return undefined;
  const s = n.style || {};
  const tuple = s.fontSize && s.lineHeightPx
    ? `${s.fontSize}/${s.lineHeightPx}/${s.fontWeight ?? 400}`
    : undefined;
  return {
    content: typeof n.characters === "string" ? n.characters : "",
    ...(tuple ? { style: tuple } : {}),
  };
}

const NOISE_NAME_RE = /^(rectangle|frame|group|ellipse|vector|image|line)\s*\d*$/i;
function meaningfulName(name: any): boolean {
  if (typeof name !== "string") return false;
  const n = name.trim();
  if (!n) return false;
  if (NOISE_NAME_RE.test(n)) return false;
  return n.includes(" ") || n.length > 10;
}

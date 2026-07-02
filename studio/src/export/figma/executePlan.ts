// studio/src/export/figma/executePlan.ts
import type { Box, Layout, SljDocument, SljNode, ElementNode } from "../slj";
import { isComponentNode } from "../slj";
import type { FigmaComponentMapping } from "./types";

export interface ExecutePlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  findIconSetKey: (arcadeGenIconName: string) => string | null;
  findIconSetName: (arcadeGenIconName: string) => string | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

/** One border edge in the plan. Color is either a resolved raw color (rgb/hex)
 *  OR a Figma color-variable key (token). Exactly like fill's
 *  fillColor/fillVariableKey split — the runtime binds the variable when a key
 *  is present, else paints the raw color. A bare token string is NEVER carried
 *  (it black-defaults in the runtime's parseColor). */
export interface PlanBorderSide {
  width: number;
  color?: string;
  colorVariableKey?: string;
}

export interface PlanFrame {
  kind: "frame";
  box: Box;
  layout: Layout | null;
  fillVariableKey?: string;
  fillColor?: string;
  cornerRadius?: number;
  corners?: { tl: number; tr: number; br: number; bl: number };
  borders?: { top?: PlanBorderSide; right?: PlanBorderSide; bottom?: PlanBorderSide; left?: PlanBorderSide };
  rotation?: number;
  clip?: true;
  shadow?: { color: string; x: number; y: number; blur: number; spread: number };
  opacity?: number;
  name?: string;
  children: PlanNode[];
}
export interface PlanImage {
  kind: "image";
  box: Box;
  data: string;
  cornerRadius?: number;
}
export interface PlanInstance {
  kind: "instance";
  componentSetKey: string;
  setName: string;
  variant?: Record<string, string>;
  box: Box;
  text?: { propName?: string; characters: string };
  iconSetKey?: string;
  iconSetName?: string;
  children: PlanNode[];
  /** Pixel-floor fallback: a faithful frame (box + fill/border/radius + label
   *  text + icon svg) the runtime renders INSTEAD OF the instance when the
   *  component set can't be imported (cold-import wall). Never rendered when the
   *  instance succeeds. Absent when the primitive had no paintable style. */
  fallback?: PlanFrame;
}
export interface PlanText {
  kind: "text";
  box: Box;
  characters: string;
  fillVariableKey?: string;
  fillColor?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  wrap?: true;
}
export interface PlanSvg {
  kind: "svg";
  box: Box;
  markup: string;
}
export type PlanNode = PlanFrame | PlanInstance | PlanText | PlanSvg | PlanImage;

export interface ExecutePlan {
  frame: { slug: string; project: string; width: number; mode: "light" | "dark" };
  root: PlanNode;
}

function variantFor(mapping: FigmaComponentMapping, props: Record<string, unknown>): Record<string, string> | undefined {
  const v: Record<string, string> = {};
  for (const axis of mapping.variants) {
    const raw = props[axis.prop];
    if (typeof raw === "string" && axis.valueMap[raw] !== undefined) v[axis.figmaProp] = axis.valueMap[raw];
  }
  return Object.keys(v).length ? v : undefined;
}

function firstText(node: SljNode): string | null {
  if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) return node.style.characters;
  for (const c of node.children) { const t = firstText(c); if (t !== null) return t; }
  return null;
}

/** Resolve one captured color (a token name like "--x" OR a raw rgb/hex) into
 *  BOTH a bindable Figma-variable key (when the token maps to one) AND a raw
 *  paint color (always, whenever we can recover it). This is the color pixel
 *  floor: the runtime binds the variable for fidelity but ALWAYS has a real
 *  color to paint if the bind fails — so a token never degrades to black or
 *  invisible. `tokens` is the SLJ's token→raw-value dict (absent on legacy).
 *  A bare "--token" string is never returned as a color. */
function resolveColorValue(
  maps: ExecutePlanMaps,
  tokens: Record<string, string> | undefined,
  value: string,
): { variableKey?: string; raw?: string } {
  if (value.startsWith("--")) {
    const key = maps.tokenNameToVariableKey(value) ?? undefined;
    const raw = tokens?.[value];
    return { ...(key ? { variableKey: key } : {}), ...(raw ? { raw } : {}) };
  }
  return { raw: value };
}

function fillFields(
  maps: ExecutePlanMaps,
  tokens: Record<string, string> | undefined,
  value: string | undefined,
): { fillVariableKey?: string; fillColor?: string } {
  if (!value) return {};
  const { variableKey, raw } = resolveColorValue(maps, tokens, value);
  return { ...(variableKey ? { fillVariableKey: variableKey } : {}), ...(raw ? { fillColor: raw } : {}) };
}

/** Map captured per-side borders into plan borders where each side's color is
 *  resolved to a variable key AND/OR a raw color (the color floor). */
function resolveBorders(
  maps: ExecutePlanMaps,
  tokens: Record<string, string> | undefined,
  borders: NonNullable<ElementNode["style"]["borders"]>,
): PlanFrame["borders"] {
  const out: NonNullable<PlanFrame["borders"]> = {};
  (["top", "right", "bottom", "left"] as const).forEach((side) => {
    const b = borders[side];
    if (!b) return;
    const { variableKey, raw } = resolveColorValue(maps, tokens, b.color);
    out[side] = { width: b.width, ...(variableKey ? { colorVariableKey: variableKey } : {}), ...(raw ? { color: raw } : {}) };
  });
  return out;
}

/** Build the pixel-floor fallback frame for a mapped component: a faithful box
 *  (fill/border/radius/shadow/opacity from the primitive's own style) carrying
 *  the label text and the glyph SVG as absolutely-positioned leaves. Rendered by
 *  the runtime only when the component set can't be imported. Returns null when
 *  the component has no paintable style, no label, and no icon (nothing to show).
 *  All colors go through the same token→variable+raw-floor resolution as fills. */
function buildFallbackFrame(
  maps: ExecutePlanMaps,
  tokens: Record<string, string> | undefined,
  node: import("../slj").ComponentNode,
): PlanFrame | null {
  const st = node.fallbackStyle;
  const children: PlanNode[] = [];
  // Label text leaf (the one text firstText would have used), positioned at its
  // own captured box.
  const label = node.children.find(
    (c): c is ElementNode => c.kind === "element" && c.tag === "text" && c.style.characters !== undefined,
  );
  if (label) {
    children.push({
      kind: "text",
      box: label.box,
      characters: label.style.characters!,
      ...fillFields(maps, tokens, label.style.color),
      ...(label.style.fontSize !== undefined ? { fontSize: label.style.fontSize } : {}),
      ...(label.style.fontWeight !== undefined ? { fontWeight: label.style.fontWeight } : {}),
      ...(label.style.fontFamily !== undefined ? { fontFamily: label.style.fontFamily } : {}),
      ...(label.style.lineHeight !== undefined ? { lineHeight: label.style.lineHeight } : {}),
    });
  }
  // Glyph SVG leaf at its captured box.
  if (node.iconSvg) {
    children.push({ kind: "svg", box: node.iconSvg.box, markup: node.iconSvg.markup });
  }
  const hasPaint = st && (st.fill || st.borders || st.cornerRadius !== undefined || st.corners || st.shadow);
  if (!hasPaint && children.length === 0) return null;
  return {
    kind: "frame",
    box: node.box,
    layout: null,
    ...(st ? fillFields(maps, tokens, st.fill) : {}),
    ...(st?.cornerRadius !== undefined ? { cornerRadius: st.cornerRadius } : {}),
    ...(st?.corners ? { corners: st.corners } : {}),
    ...(st?.borders ? { borders: resolveBorders(maps, tokens, st.borders) } : {}),
    ...(st?.shadow ? { shadow: st.shadow } : {}),
    ...(st?.opacity !== undefined ? { opacity: st.opacity } : {}),
    name: node.component,
    children,
  };
}

function isPointlessWrapper(frame: PlanFrame, isRoot: boolean, parentIsAbsolute: boolean): boolean {
  if (isRoot) return false; // never collapse root
  if (frame.children.length !== 1) return false; // only single-child wrappers
  // Check if it has any visual styling
  if (frame.fillVariableKey || frame.fillColor || frame.cornerRadius || frame.corners) return false;
  // Borders, shadow and rotation are visual too — never collapse those away.
  if (frame.borders || frame.shadow || frame.rotation) return false;
  // A clipping frame is visual (it clips overflow) — never collapse
  if (frame.clip) return false;
  // Only collapse inside absolute-positioned parents (layout null)
  if (!parentIsAbsolute) return false;
  // Don't collapse if wrapper itself has layout (it positions its child)
  if (frame.layout !== null) return false;
  // Don't collapse if the child is an svg node (it's already a leaf)
  if (frame.children[0].kind === "svg") return false;
  return true;
}

export function sljToExecutePlan(slj: SljDocument, maps: ExecutePlanMaps): ExecutePlan {
  const tokens = slj.tokens;
  function walk(node: SljNode, depth: number, parentLayout: Layout | null): PlanNode {
    if (isComponentNode(node)) {
      const m = maps.findComponentMapping(node.component);
      if (m && m.status === "mapped" && m.figma) {
        const text = firstText(node);
        const textPayload =
          text !== null && m.textNode
            ? m.textNode.strategy === "by-name"
              ? { propName: m.textNode.name, characters: text }
              : { characters: text }
            : undefined;
        const inst: PlanInstance = {
          kind: "instance",
          componentSetKey: m.figma.componentSetKey,
          setName: m.figma.setName,
          variant: variantFor(m, node.props),
          box: node.box,
          text: textPayload,
          children: [],
        };
        if (node.icon) {
          const k = maps.findIconSetKey(node.icon);
          if (k) { inst.iconSetKey = k; inst.iconSetName = maps.findIconSetName(node.icon) ?? undefined; }
        }
        const fb = buildFallbackFrame(maps, tokens, node);
        if (fb) inst.fallback = fb;
        return inst;
      }
      // Pixel-first: always null layout (absolute positioning for everything)
      return { kind: "frame", box: node.box, layout: null, children: node.children.map((c) => walk(c, depth + 1, null)) };
    }
    const el = node as ElementNode;
    if (el.tag === "svg" && el.style.svg !== undefined) {
      return {
        kind: "svg",
        box: el.box,
        markup: el.style.svg,
      };
    }
    // Image node: img element with captured pixel data
    if (el.style.imageData !== undefined) {
      return {
        kind: "image",
        box: el.box,
        data: el.style.imageData,
        ...(el.style.cornerRadius !== undefined ? { cornerRadius: el.style.cornerRadius } : {}),
      };
    }
    if (el.tag === "text" && el.style.characters !== undefined) {
      // Detect if text was multiline in the browser
      const isMultiline =
        (el.style.lineHeight !== undefined && el.box.height >= el.style.lineHeight * 1.8) ||
        (el.style.lineHeight === undefined && el.style.fontSize !== undefined && el.box.height >= el.style.fontSize * 2.2);

      return {
        kind: "text",
        box: el.box,
        characters: el.style.characters,
        ...fillFields(maps, tokens, el.style.color),
        ...(el.style.fontSize !== undefined ? { fontSize: el.style.fontSize } : {}),
        ...(el.style.fontWeight !== undefined ? { fontWeight: el.style.fontWeight } : {}),
        ...(el.style.fontFamily !== undefined ? { fontFamily: el.style.fontFamily } : {}),
        ...(el.style.lineHeight !== undefined ? { lineHeight: el.style.lineHeight } : {}),
        ...(isMultiline ? { wrap: true } : {}),
      };
    }
    // Derive name: from element.name if present (pixel-first: no layout-based naming)
    const derivedName = el.name ?? undefined;
    // Pixel-first: layout always null — absolute positioning for everything
    const frame: PlanFrame = {
      kind: "frame",
      box: el.box,
      layout: null,
      ...fillFields(maps, tokens, el.style.fill),
      ...(el.style.cornerRadius !== undefined ? { cornerRadius: el.style.cornerRadius } : {}),
      ...(el.style.corners ? { corners: el.style.corners } : {}),
      ...(el.style.borders ? { borders: resolveBorders(maps, tokens, el.style.borders) } : {}),
      ...(el.style.rotation !== undefined ? { rotation: el.style.rotation } : {}),
      ...(el.style.clip ? { clip: true } : {}),
      ...(el.style.shadow ? { shadow: el.style.shadow } : {}),
      ...(el.style.opacity !== undefined ? { opacity: el.style.opacity } : {}),
      ...(derivedName ? { name: derivedName } : {}),
      children: el.children.map((c) => walk(c, depth + 1, null)),
    };

    // Collapse pointless wrappers (always absolute context in pixel-first)
    const parentIsAbsolute = true; // pixel-first: everything is absolute
    if (isPointlessWrapper(frame, depth === 0, parentIsAbsolute)) {
      const child = frame.children[0];
      // Transfer name to child if child is a frame without its own name
      if (child.kind === "frame" && frame.name && !child.name) {
        child.name = frame.name;
      }
      return child;
    }

    return frame;
  }
  return { frame: slj.frame, root: walk(slj.root, 0, null) };
}

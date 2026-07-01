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

export interface PlanFrame {
  kind: "frame";
  box: Box;
  layout: Layout | null;
  fillVariableKey?: string;
  fillColor?: string;
  cornerRadius?: number;
  corners?: { tl: number; tr: number; br: number; bl: number };
  borders?: { top?: { color: string; width: number }; right?: { color: string; width: number }; bottom?: { color: string; width: number }; left?: { color: string; width: number } };
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

function fillFields(maps: ExecutePlanMaps, value: string | undefined): { fillVariableKey?: string; fillColor?: string } {
  if (!value) return {};
  if (value.startsWith("--")) { const key = maps.tokenNameToVariableKey(value); return key ? { fillVariableKey: key } : {}; }
  return { fillColor: value };
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
        ...fillFields(maps, el.style.color),
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
      ...fillFields(maps, el.style.fill),
      ...(el.style.cornerRadius !== undefined ? { cornerRadius: el.style.cornerRadius } : {}),
      ...(el.style.corners ? { corners: el.style.corners } : {}),
      ...(el.style.borders ? { borders: el.style.borders } : {}),
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

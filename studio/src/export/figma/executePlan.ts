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
  children: PlanNode[];
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
}
export type PlanNode = PlanFrame | PlanInstance | PlanText;

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

export function sljToExecutePlan(slj: SljDocument, maps: ExecutePlanMaps): ExecutePlan {
  function walk(node: SljNode): PlanNode {
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
      return { kind: "frame", box: node.box, layout: node.layout, children: node.children.map(walk) };
    }
    const el = node as ElementNode;
    if (el.tag === "text" && el.style.characters !== undefined) {
      return { kind: "text", box: el.box, characters: el.style.characters, ...fillFields(maps, el.style.color) };
    }
    return { kind: "frame", box: el.box, layout: el.layout, ...fillFields(maps, el.style.fill), children: el.children.map(walk) };
  }
  return { frame: slj.frame, root: walk(slj.root) };
}

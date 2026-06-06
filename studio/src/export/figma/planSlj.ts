// studio/src/export/figma/planSlj.ts
import type { SljDocument, SljNode, ElementNode, ComponentNode, ElementStyle } from "../slj";
import { isComponentNode } from "../slj";
import type { FigmaComponentMapping } from "./types";
import type { FigmaOp, FigmaPlan } from "./ops";

export interface PlannerMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

/** Emit fill/stroke ops for a style: bindVariable when a --token resolves to a
 *  Figma variable key, else setFill with the value as-is. */
function colorOps(maps: PlannerMaps, targetId: string, style: ElementStyle): FigmaOp[] {
  const out: FigmaOp[] = [];
  const emit = (field: "fill" | "stroke", value: string | undefined) => {
    if (!value) return;
    if (value.startsWith("--")) {
      const key = maps.tokenNameToVariableKey(value);
      if (key) { out.push({ op: "bindVariable", target: targetId, field, variableKey: key }); return; }
    }
    out.push({ op: "setFill", target: targetId, field, color: value });
  };
  // text nodes carry the foreground in `color`; elements carry bg in `fill`.
  emit("fill", style.characters !== undefined ? style.color : style.fill);
  if (style.stroke) emit("stroke", style.stroke.color);
  return out;
}

export function planFigmaOps(slj: SljDocument, maps: PlannerMaps): FigmaPlan {
  const ops: FigmaOp[] = [];
  let counter = 0;
  const nextId = () => `n${counter++}`;

  function walk(node: SljNode, parent: string | null): string {
    if (isComponentNode(node)) return walkComponent(node, parent);
    return walkElement(node, parent);
  }

  function walkElement(node: ElementNode, parent: string | null): string {
    const id = nextId();
    ops.push({ op: "createFrame", id, parent, layout: node.layout, box: node.box });
    if (node.tag === "text" && node.style.characters !== undefined) {
      ops.push({ op: "setText", target: id, textNodeHint: { strategy: "lowest-depth" }, characters: node.style.characters });
    }
    for (const c of colorOps(maps, id, node.style)) ops.push(c);
    for (const child of node.children) walk(child, id);
    return id;
  }

  function walkComponent(node: ComponentNode, parent: string | null): string {
    const mapping = maps.findComponentMapping(node.component);
    if (mapping && mapping.status === "mapped" && mapping.figma) {
      const id = nextId();
      const variant: Record<string, string> = {};
      for (const axis of mapping.variants) {
        const raw = node.props[axis.prop];
        if (typeof raw === "string" && axis.valueMap[raw] !== undefined) variant[axis.figmaProp] = axis.valueMap[raw];
      }
      const instOp: FigmaOp = { op: "createInstance", id, parent: parent ?? "", componentKey: mapping.figma.componentSetKey };
      if (Object.keys(variant).length > 0) (instOp as { variant?: Record<string, string> }).variant = variant;
      ops.push(instOp);
      if (mapping.textNode) {
        const chars = firstText(node);
        if (chars !== null) ops.push({ op: "setText", target: id, textNodeHint: mapping.textNode, characters: chars });
      }
      return id;
    }
    const id = nextId();
    ops.push({ op: "createFrame", id, parent, layout: node.layout, box: node.box });
    for (const child of node.children) walk(child, id);
    return id;
  }

  function firstText(node: SljNode): string | null {
    if (node.kind === "element" && node.tag === "text" && node.style.characters !== undefined) return node.style.characters;
    for (const c of node.children) { const r = firstText(c); if (r !== null) return r; }
    return null;
  }

  const rootId = walk(slj.root, null);
  return { rootId, ops };
}

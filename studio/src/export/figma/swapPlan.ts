// studio/src/export/figma/swapPlan.ts
import type { Box } from "../slj";
import type { FigmaComponentMapping } from "./types";
import type { ManifestComponent, SwapOp } from "./swapOps";
import type { CaptureNode } from "./captureTree";
import { matchByGeometry } from "./geometryMatch";

export interface SwapPlanMaps {
  findComponentMapping: (name: string) => FigmaComponentMapping | null;
  tokenNameToVariableKey: (cssTokenName: string) => string | null;
}

export interface SwapRegions {
  /** Box of the chat transcript container, or null when the frame has none. */
  transcriptRegion: Box | null;
}

/** Resolve the Figma variant map for a manifest component from its props. */
function resolveVariant(mapping: FigmaComponentMapping, props: Record<string, unknown>): Record<string, string> | undefined {
  const variant: Record<string, string> = {};
  for (const axis of mapping.variants) {
    const raw = props[axis.prop];
    if (typeof raw === "string" && axis.valueMap[raw] !== undefined) variant[axis.figmaProp] = axis.valueMap[raw];
  }
  return Object.keys(variant).length > 0 ? variant : undefined;
}

/** Build the text payload for an instance from the mapping's textNode hint. */
function textPayload(mapping: FigmaComponentMapping, text: string | null): { propName?: string; characters: string } | undefined {
  if (text === null || !mapping.textNode) return undefined;
  if (mapping.textNode.strategy === "by-name") return { propName: mapping.textNode.name, characters: text };
  return { characters: text };
}

/** Plan the discrete-region swaps: geometry-match each mapped component to a
 *  capture node and emit replaceWithInstance. (Transcript handled in Task 5.) */
export function planSwap(
  manifest: ManifestComponent[],
  captureNodes: CaptureNode[],
  _regions: SwapRegions,
  maps: SwapPlanMaps,
): SwapOp[] {
  const ops: SwapOp[] = [];
  const used = new Set<string>();
  for (const comp of manifest) {
    const mapping = maps.findComponentMapping(comp.component);
    if (!mapping || mapping.status !== "mapped" || !mapping.figma) continue;
    const candidates = captureNodes.filter((n) => !used.has(n.id));
    const match = matchByGeometry(comp.box, candidates);
    if (!match || match.parentId === null) continue;
    used.add(match.id);
    ops.push({
      op: "replaceWithInstance",
      targetNodeId: match.id,
      componentSetKey: mapping.figma.componentSetKey,
      variant: resolveVariant(mapping, comp.props),
      box: { x: match.x, y: match.y, width: match.width, height: match.height },
      parentNodeId: match.parentId,
      text: textPayload(mapping, comp.text),
    });
  }
  return ops;
}
